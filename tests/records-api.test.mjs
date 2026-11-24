import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {fetchRecords, fetchRecordsWithStatus} = await importTs(new URL('../src/api/om.ts', import.meta.url));

test('failed leaderboard requests release deduplication without an unhandled cleanup rejection', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? new Response(null, {status: 503}) : Response.json([]);
  };
  try {
    const results = await Promise.allSettled([fetchRecords('failure-test'), fetchRecords('failure-test')]);
    assert.ok(results.every(result => result.status === 'rejected' && /503/.test(result.reason.message)));
    assert.equal(calls, 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await fetchRecords('failure-test'), []);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = previous; }
});

test('concurrent fresh and cached requests keep separate in-flight results', async () => {
  const previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const nth = seen.push(options?.headers?.['X-OM-Bypass-Cache'] ?? null);
    await new Promise(resolve => setTimeout(resolve, 10));
    return Response.json([], {headers: {'x-om-cache': nth === 1 ? 'miss' : 'hit'}});
  };
  try {
    const [fresh, cached] = await Promise.all([
      fetchRecordsWithStatus('dedup-test', {useCache: false}),
      fetchRecordsWithStatus('dedup-test'),
    ]);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen, ['1', null]);
    assert.equal(fresh.cache, 'miss');
    assert.equal(cached.cache, 'hit');
    // Same-mode concurrent requests still share one network call.
    await Promise.all([fetchRecordsWithStatus('dedup-test'), fetchRecordsWithStatus('dedup-test')]);
    assert.equal(seen.length, 3);
  } finally { globalThis.fetch = previous; }
});
