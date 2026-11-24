import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importTs} from './helpers/import-ts.mjs';

const {getPuzzleMap} = await importTs(new URL('../src/api/om.ts', import.meta.url));
const {parseSolutionMeta} = await importTs(new URL('../src/lib/verify/solution-parse.ts', import.meta.url));
const {parsePuzzleMeta, customPuzzleType} = await importTs(new URL('../src/lib/verify/puzzle-parse.ts', import.meta.url));
const {verifyBatch} = await importTs(new URL('../src/lib/verify/batch.ts', import.meta.url));

function withPuzzleId(bytes, id) {
  return Buffer.concat([bytes.subarray(0, 4), Buffer.from([id.length]), Buffer.from(id), bytes.subarray(5 + bytes[4])]);
}

test('an old solution header resolves to the official puzzle and verifies the same score', async t => {
  const canonical = await readFile(new URL('./fixtures/verify/looping.solution', import.meta.url));
  const legacy = withPuzzleId(canonical, 'old-p007');
  const unknown = withPuzzleId(canonical, 'unknown');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    if (url === '/api/om/puzzles') return Response.json([
      {id: 'P008', type: 'NORMAL', altIds: ['P007']},
      {id: 'P007', type: 'NORMAL', altIds: ['old-p007']},
    ]);
    if (url === '/puzzles/P007.puzzle') return new Response(await readFile(new URL('../public/puzzles/P007.puzzle', import.meta.url)));
    if (url instanceof URL && url.pathname.endsWith('/libverify.wasm')) return new Response(await readFile(url));
    throw new Error(`unexpected request: ${url}`);
  });
  const puzzles = await getPuzzleMap();
  const inputs = [canonical, legacy, unknown].map(bytes => ({bytes, puzzleId: parseSolutionMeta(bytes, puzzles).puzzleId}));
  assert.deepEqual(inputs.map(({puzzleId}) => puzzleId), ['P007', 'P007', 'unknown']);
  assert.equal(parseSolutionMeta(legacy).puzzleId, 'old-p007', 'reading without the official list still returns the original ID');

  const [current, old, missing] = await verifyBatch(inputs);
  assert.equal(current.passed, true, current.error);
  assert.equal(old.passed, true, old.error);
  assert.equal(old.puzzleId, 'P007');
  assert.equal(old.puzzleType, 'NORMAL');
  assert.deepEqual(old.score, current.score);
  assert.equal(missing.error, 'puzzle file not found: unknown');
  assert.deepEqual(requests.filter(url => url.startsWith('/puzzles/')), ['/puzzles/P007.puzzle']);
  assert.equal(parseSolutionMeta(legacy).puzzleId, 'old-p007', 'the original solution bytes are not rewritten');
});

test('custom puzzle type prefers the API, else derives production and polymer from the file', async () => {
  const read = id => readFile(new URL(`../public/puzzles/${id}.puzzle`, import.meta.url)).then(bytes => new Uint8Array(bytes));
  const normal = parsePuzzleMeta(await read('P007'));
  const polymer = parsePuzzleMeta(await read('P020'));
  const production = parsePuzzleMeta(await read('P076'));
  assert.equal(normal.polymerOutput, false);
  assert.equal(normal.isProduction, false);
  assert.equal(polymer.polymerOutput, true, 'polymer output chain carries atom type 15');
  assert.equal(polymer.isProduction, false);
  assert.equal(production.isProduction, true);
  // Known puzzles use the authoritative API type, including polymer direction.
  assert.equal(customPuzzleType(polymer, 'POLYMER_HEIGHT'), 'POLYMER_HEIGHT');
  assert.equal(customPuzzleType(production, 'PRODUCTION'), 'PRODUCTION');
  // Unknown files fall back to what the format actually stores.
  assert.equal(customPuzzleType(production), 'PRODUCTION');
  assert.equal(customPuzzleType(normal), 'NORMAL');
  assert.equal(customPuzzleType(polymer), '', 'polymer direction is not in the file; all geometry stays measured');
});
