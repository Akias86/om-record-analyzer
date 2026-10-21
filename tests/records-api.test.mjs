import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {fetchRecords} = await importTs(new URL('../src/api/om.ts', import.meta.url));

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
