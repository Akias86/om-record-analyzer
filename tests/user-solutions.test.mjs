import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {findRecordMatch} = await importTs(new URL('../src/state/userSolutions.tsx', import.meta.url));

const record = (overrides = {}) => ({
  id: 'r1', puzzleId: 'P007', puzzleType: 'NORMAL', solutionName: 'sol',
  fileName: 'a.solution', hash: 'h1', score: {looping: true}, fullScore: '',
  ...overrides,
});
const parsed = (name, hash, puzzleId = 'P007') => ({
  file: {name}, bytes: new Uint8Array(0), meta: {puzzleId, solutionName: 'sol'}, hash,
});

test('upload matching replaces only the same solution, never a different file with the same name', () => {
  const records = [record()];
  assert.equal(findRecordMatch(records, parsed('a.solution', 'h1')), 0);
  assert.equal(findRecordMatch(records, parsed('A.SOLUTION', 'h1')), 0);
  // Same name but different bytes: a brand-new solution, not a replacement.
  assert.equal(findRecordMatch(records, parsed('a.solution', 'h2')), null);
  // Legacy records without a hash still match by name (nothing to compare).
  assert.equal(findRecordMatch([record({hash: undefined})], parsed('a.solution', 'h2')), 0);
  // Without a local hash (no crypto.subtle) name matching is the best available.
  assert.equal(findRecordMatch(records, parsed('a.solution', null)), 0);
  assert.equal(findRecordMatch(records, parsed('b.solution', 'h1')), null);
  assert.equal(findRecordMatch(records, parsed('a.solution', 'h1', 'P010')), null);
  assert.equal(findRecordMatch(records, parsed('a.solution', 'h1', null)), null);
});

test('legacy records without fileName fall back to the embedded solution name', () => {
  const legacy = record({fileName: undefined, hash: undefined});
  assert.equal(findRecordMatch([legacy], parsed('whatever.solution', 'h9')), 0);
  const named = record({fileName: undefined, hash: undefined, solutionName: 'other'});
  assert.equal(findRecordMatch([named], parsed('whatever.solution', 'h9')), null);
});
