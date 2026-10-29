import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {default: worker} = await importTs(new URL('../worker/index.ts', import.meta.url));
const {fetchPlayerUrl} = await importTs(new URL('../src/api/config.ts', import.meta.url));
const request = () => new Request('https://analyzer.example/api/config');

function mockFetch(run) {
  const previous = globalThis.fetch;
  globalThis.fetch = run;
  return () => { globalThis.fetch = previous; };
}

test('runtime config exposes only the player origin and is never cached', async () => {
  const response = await worker.fetch(request(), {
    PLAYER_ORIGIN: ' https://player.example/ ', LEADERBOARD_API: 'https://private.example', SECRET: 'hidden',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), {playerOrigin: 'https://player.example'});
});

test('runtime config defaults to om-player and changes immediately with Worker bindings', async () => {
  assert.deepEqual(await (await worker.fetch(request(), {})).json(), {playerOrigin: 'https://om-player.pages.dev'});
  assert.deepEqual(await (await worker.fetch(request(), {PLAYER_ORIGIN: '  '})).json(), {playerOrigin: 'https://om-player.pages.dev'});
  for (const playerOrigin of ['http://127.0.0.1:4174', 'https://updated.example']) {
    assert.deepEqual(await (await worker.fetch(request(), {PLAYER_ORIGIN: playerOrigin})).json(), {playerOrigin});
  }
});

test('config rejects non-GET requests and does not shadow other routes', async () => {
  const response = await worker.fetch(new Request('https://analyzer.example/api/config', {method: 'POST'}), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await worker.fetch(new Request('https://analyzer.example/unknown'), {})).status, 404);
});

test('the leaderboard proxy still uses LEADERBOARD_API independently', async () => {
  let target;
  const restore = mockFetch(async url => {
    target = String(url);
    return new Response(null, {status: 503});
  });
  try {
    const response = await worker.fetch(new Request('https://analyzer.example/api/om/metrics?test=1', {
      headers: {'x-om-bypass-cache': '1'},
    }), {LEADERBOARD_API: 'https://upstream.example', PLAYER_ORIGIN: 'https://player.example'});
    assert.equal(response.status, 503);
    assert.equal(target, 'https://upstream.example/om/metrics?test=1');
  } finally { restore(); }
});

test('player connections read fresh runtime config at the site root and forward their AbortSignal', async () => {
  const controller = new AbortController();
  let playerOrigin = 'http://127.0.0.1:4174', calls = 0;
  const restore = mockFetch(async (url, options) => {
    calls++;
    assert.equal(url, '/api/config');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.signal, controller.signal);
    return Response.json({playerOrigin});
  });
  try {
    assert.equal(await fetchPlayerUrl(controller.signal), 'http://127.0.0.1:4174/');
    playerOrigin = 'https://updated.example';
    assert.equal(await fetchPlayerUrl(controller.signal), 'https://updated.example/');
    assert.equal(calls, 2);
  } finally { restore(); }
});

test('default Worker config resolves to the deployed standalone player root', async () => {
  const restore = mockFetch(async () => worker.fetch(request(), {}));
  try {
    assert.equal(await fetchPlayerUrl(new AbortController().signal), 'https://om-player.pages.dev/');
  } finally { restore(); }
});

test('config failures, unsafe origins and cancellation are not silently ignored', async () => {
  const controller = new AbortController();
  let restore = mockFetch(async () => new Response(null, {status: 500}));
  try {
    await assert.rejects(fetchPlayerUrl(controller.signal), /HTTP 500/);
  } finally { restore(); }
  for (const playerOrigin of [undefined, null, 3, 'javascript:alert(1)', 'file:///tmp/player', 'https://player.example/path']) {
    restore = mockFetch(async () => Response.json({playerOrigin}));
    try {
      await assert.rejects(fetchPlayerUrl(controller.signal));
    } finally { restore(); }
  }
  controller.abort();
  restore = mockFetch(async (_, {signal}) => { signal.throwIfAborted(); });
  try {
    await assert.rejects(fetchPlayerUrl(controller.signal), {name: 'AbortError'});
  } finally { restore(); }
});
