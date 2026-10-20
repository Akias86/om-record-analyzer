import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {createAuthorHandler} = await importTs(new URL('../worker/recordAuthor.ts', import.meta.url));
const {default: worker} = await importTs(new URL('../worker/index.ts', import.meta.url));
const {fetchRecordAuthor} = await importTs(new URL('../src/api/recordAuthor.ts', import.meta.url));
const {solutionReference, AUTHOR_COMMIT_URL} = await importTs(new URL('../src/lib/recordAuthor.ts', import.meta.url));
const SHA = 'b01e618e46fb9721c467d7979a74ed82328abd71';
const ID = '110g-20i-204c-41a-8h-5.5w-6b-33r-41a-8h-5.5w-6b-TL';
const solution = (sha = SHA.slice(0, 8), id = ID) => `https://zlbb.faendir.com/l/om/${sha}/P253/${id}`;
const request = (url = solution(), method = 'GET') => new Request(`https://analyzer.example/api/record-author?${new URLSearchParams({solution: url})}`, {method});
const author = {name: 'andytampan', url: `${AUTHOR_COMMIT_URL}${SHA}`};
const commit = () => ({
  sha: SHA,
  commit: {message: '[BOT] Cuprite 110g/204c/41a [Solution] by andytampan', author: {name: 'zachtronics-leaderboard-bot'}},
  files: [{filename: `JOURNAL_XII/CUPRITE/CUPRITE_${ID}.solution`, status: 'added'}],
});

class MemoryKV {
  values = new Map();
  writes = [];
  async get(key, type) {
    const value = this.values.get(key) ?? null;
    return type === 'json' && value !== null ? JSON.parse(value) : value;
  }
  async put(key, value, options) {
    this.values.set(key, value);
    this.writes.push({key, value, options});
  }
}

function mockFetch(run) {
  const previous = globalThis.fetch;
  globalThis.fetch = run;
  return () => { globalThis.fetch = previous; };
}

test('solution references accept only fixed-host immutable zlbb links', () => {
  assert.deepEqual(solutionReference(solution()), {sha: SHA.slice(0, 8), recordId: ID});
  assert.deepEqual(solutionReference(solution(SHA)), {sha: SHA, recordId: ID});
  for (const value of [null, '', 'not a URL', solution().replace('https:', 'http:'),
    solution().replace('zlbb.faendir.com', 'evil.example'), solution().replace('zlbb.faendir.com', 'zlbb.faendir.com.evil.example'),
    solution().replace('https://', 'https://user:pass@'), `${solution()}?x=1`, `${solution()}#x`,
    solution('master'), solution('abc1234'), solution('a'.repeat(41)), solution(SHA, '%2Fsecret'),
    solution(SHA, '%5Csecret'), solution(SHA, '%00'), solution(SHA, '%zz'), solution(SHA, 'a'.repeat(513))]) {
    assert.equal(solutionReference(value), null, String(value));
  }
});

test('Worker fetches only the fixed GitHub repo and permanently caches canonical SHA plus short-ref alias', async () => {
  const kv = new MemoryKV();
  let calls = 0;
  const restore = mockFetch(async (url, options) => {
    calls++;
    assert.equal(url, `https://api.github.com/repos/zachtronics-leaderboards/om-leaderboard/commits/${SHA.slice(0, 8)}?per_page=1`);
    assert.equal(options.headers.Authorization, 'Bearer server-only-token');
    assert.equal(options.redirect, 'manual'); // workerd does not support redirect: 'error'
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(commit());
  });
  try {
    const env = {AUTHOR_CACHE: kv, GITHUB_TOKEN: ' server-only-token '};
    const response = await createAuthorHandler()(request(), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {author});
    assert.equal(kv.writes.length, 2);
    assert.ok(kv.writes.every(write => write.options === undefined));
    assert.ok(kv.writes[0].key.endsWith(`commit:${SHA}`));
    assert.ok(kv.writes[1].key.endsWith(`ref:${SHA.slice(0, 8)}`));
    // A new isolate must reuse durable KV, not just the first handler's memory.
    const fresh = createAuthorHandler();
    assert.deepEqual(await (await fresh(request(), env)).json(), {author});
    assert.deepEqual(await (await fresh(request(solution(SHA)), env)).json(), {author});
    assert.equal(calls, 1);
    assert.equal(kv.writes.length, 2);
  } finally { restore(); }
});

test('history imports are permanently unknown, never attributed to the Git maintainer', async () => {
  const kv = new MemoryKV();
  let calls = 0;
  const restore = mockFetch(async () => {
    calls++;
    return Response.json({sha: SHA, commit: {message: '[HUMAN] Restart history', author: {name: 'Maintainer'}}}, {
      headers: {link: '<https://api.github.com/next>; rel="next"'},
    });
  });
  try {
    for (const id of [ID, '40g-6i-143c-TL']) {
      assert.deepEqual(await (await createAuthorHandler()(request(solution(undefined, id)), {AUTHOR_CACHE: kv})).json(), {author: null});
    }
    assert.equal(calls, 1);
    assert.equal(JSON.parse(kv.writes[0].value).name, null);
    assert.ok(kv.writes.every(write => write.options === undefined));
  } finally { restore(); }
});

test('cached attribution is checked against the solution ID on every request; mismatches do not poison the commit', async () => {
  const restore = mockFetch(async () => Response.json(commit()));
  try {
    const handler = createAuthorHandler();
    const env = {AUTHOR_CACHE: new MemoryKV()};
    assert.deepEqual(await (await handler(request(solution(undefined, 'wrong-record')), env)).json(), {author: null});
    assert.deepEqual(await (await handler(request(), env)).json(), {author});
  } finally { restore(); }
});

test('author parser preserves spaces and only accepts unambiguous solution-file commits', async () => {
  const cases = [
    [data => { data.commit.message = '[BOT] Orange Vitriol … [Solution] by Brother Mojo\n\nExtra details'; }, 'Brother Mojo'],
    [data => { data.files[0].status = 'modified'; }, 'andytampan'],
    [data => { data.files[0].status = 'renamed'; }, 'andytampan'],
    [data => { data.commit.message = '[BOT] Cuprite [GI] by andytampan'; }, null],
    [data => { data.commit.message = '[HUMAN] Rebuild [Solution] by maintainer'; }, null],
    [data => { data.commit.message = '[BOT] Cuprite [Solution] by    '; }, null],
    [data => { data.commit.message += '\tbad'; }, null],
    [data => { data.files[0].status = 'removed'; }, null],
    [data => { data.files[0].filename = `JOURNAL_XII/CUPRITE/CUPRITE_${ID}.json`; }, null],
    [data => { data.files.push({...data.files[0]}); }, null],
  ];
  for (const [change, expected] of cases) {
    const data = commit();
    change(data);
    const restore = mockFetch(async () => Response.json(data));
    try {
      const result = await (await createAuthorHandler()(request(), {AUTHOR_CACHE: new MemoryKV()})).json();
      assert.equal(result.author?.name ?? null, expected);
    } finally { restore(); }
  }
  const restore = mockFetch(async () => Response.json(commit(), {headers: {link: '<https://api.github.com/next>; rel="next"'}}));
  try {
    assert.deepEqual(await (await createAuthorHandler()(request(), {AUTHOR_CACHE: new MemoryKV()})).json(), {author: null});
  } finally { restore(); }
});

test('HTTP errors, timeouts and malformed replies are retryable, never permanent negative KV entries', async () => {
  const failures = [
    ...[301, 302, 403, 404, 429, 500].map(status => () => new Response(null, {status})),
    () => { throw new DOMException('Timed out', 'TimeoutError'); },
    () => Response.json({}),
    () => Response.json({...commit(), sha: 'a'.repeat(40)}),
    () => Response.json({...commit(), files: undefined}),
  ];
  for (const fail of failures) {
    let clock = 1000, calls = 0;
    const handler = createAuthorHandler(() => clock);
    const kv = new MemoryKV();
    const restore = mockFetch(async () => { calls++; return calls === 1 ? fail() : Response.json(commit()); });
    try {
      const response = await handler(request(), {AUTHOR_CACHE: kv});
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('retry-after'), '30');
      assert.deepEqual(await response.json(), {author: null});
      assert.equal(kv.writes.length, 0);
      assert.equal((await handler(request(), {AUTHOR_CACHE: kv})).status, 503);
      assert.equal(calls, 1);
      clock += 30001;
      assert.deepEqual(await (await handler(request(), {AUTHOR_CACHE: kv})).json(), {author});
      assert.equal(calls, 2);
    } finally { restore(); }
  }
});

test('concurrent lookups of the same SHA share one GitHub request and one KV write pair', async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let calls = 0;
  const restore = mockFetch(async () => { calls++; entered(); await gate; return Response.json(commit()); });
  try {
    const kv = new MemoryKV();
    const handler = createAuthorHandler();
    const requests = Array.from({length: 8}, () => handler(request(), {AUTHOR_CACHE: kv}));
    await started;
    release();
    for (const response of await Promise.all(requests)) assert.deepEqual(await response.json(), {author});
    assert.equal(calls, 1);
    assert.equal(kv.writes.length, 2);
  } finally { release(); restore(); }
});

test('uncached concurrent SHA lookups are bounded', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const restore = mockFetch(async () => { calls++; await gate; return new Response(null, {status: 503}); });
  try {
    const handler = createAuthorHandler();
    const env = {AUTHOR_CACHE: new MemoryKV()};
    const requests = [1, 2, 3, 4].map(n => handler(request(solution(String(n).repeat(40))), env));
    assert.equal((await handler(request(solution('5'.repeat(40))), env)).status, 503);
    release();
    await Promise.all(requests);
    assert.ok(calls <= 4);
    assert.equal(env.AUTHOR_CACHE.writes.length, 0);
  } finally { release(); restore(); }
});

test('invalid methods/links never contact GitHub, and the Worker routes author requests locally', async () => {
  const restore = mockFetch(() => { throw new Error('Must not fetch'); });
  try {
    const env = {AUTHOR_CACHE: new MemoryKV()};
    const handler = createAuthorHandler();
    const response = await handler(request(solution(), 'POST'), env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    assert.equal((await worker.fetch(request('https://evil.example/a'), env)).status, 400);
    assert.equal(env.AUTHOR_CACHE.writes.length, 0);
    const config = await worker.fetch(new Request('https://analyzer.example/api/config'), {...env, GITHUB_TOKEN: 'secret'});
    assert.deepEqual(await config.json(), {playerOrigin: 'https://omsim-web.pages.dev'});
  } finally { restore(); }
});

test('KV failures do not become cached unknowns', async () => {
  let calls = 0;
  const restore = mockFetch(async () => { calls++; return Response.json(commit()); });
  try {
    const handler = createAuthorHandler();
    const kv = new MemoryKV();
    kv.put = async () => { throw new Error('KV unavailable'); };
    assert.equal((await handler(request(), {AUTHOR_CACHE: kv})).status, 503);
    assert.deepEqual(await (await handler(request(), {AUTHOR_CACHE: new MemoryKV()})).json(), {author});
    assert.equal(calls, 2);
  } finally { restore(); }
});

test('frontend calls only the Worker with cancellation and validates the attribution link', async () => {
  const controller = new AbortController();
  const restore = mockFetch(async (url, options) => {
    assert.equal(url, `/api/record-author?${new URLSearchParams({solution: solution()})}`);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, 'no-store');
    return Response.json({author});
  });
  try { assert.deepEqual(await fetchRecordAuthor(solution(), controller.signal), author); }
  finally { restore(); }
  for (const invalid of [undefined, {}, {...author, name: ''}, {...author, url: 'javascript:alert(1)'},
    {...author, url: `${AUTHOR_COMMIT_URL}${'a'.repeat(40)}`}, {...author, url: `${author.url}?x=1`},
    {...author, url: 'https://github.com/another/repo/commit/' + SHA}]) {
    const restore = mockFetch(async () => Response.json({author: invalid}));
    try { await assert.rejects(fetchRecordAuthor(solution(), controller.signal)); }
    finally { restore(); }
  }
});

test('frontend skips unsupported solutions, returns confirmed unknowns, and propagates abort/failure', async () => {
  const controller = new AbortController();
  let calls = 0;
  let restore = mockFetch(async () => { calls++; return Response.json({author: null}); });
  try {
    assert.equal(await fetchRecordAuthor(null, controller.signal), null);
    assert.equal(await fetchRecordAuthor('https://elsewhere.example/file.solution', controller.signal), null);
    assert.equal(calls, 0);
    assert.equal(await fetchRecordAuthor(solution(), controller.signal), null);
    assert.equal(calls, 1);
  } finally { restore(); }
  restore = mockFetch(async () => new Response(null, {status: 503}));
  try { await assert.rejects(fetchRecordAuthor(solution(), controller.signal), /HTTP 503/); }
  finally { restore(); }
  controller.abort();
  restore = mockFetch(async (_, {signal}) => { signal.throwIfAborted(); });
  try { await assert.rejects(fetchRecordAuthor(solution(), controller.signal), {name: 'AbortError'}); }
  finally { restore(); }
});
