import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {importTs} from './helpers/import-ts.mjs';

const {loadVerifier} = await importTs(new URL('../src/lib/verify/verifier.ts', import.meta.url));
const {computeScore} = await importTs(new URL('../src/lib/verify/metrics.ts', import.meta.url));
const wasm = await WebAssembly.compile(await readFile(new URL('../src/lib/verify/libverify.wasm', import.meta.url)));
const verifier = await loadVerifier(wasm);
const fixture = (name) => readFile(new URL(`./fixtures/verify/${name}`, import.meta.url));

test('bundled fork verifier matches the TypeScript WASM export contract', async () => {
  const source = ts.createSourceFile('verifier.ts', await readFile(new URL('../src/lib/verify/verifier.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const contract = source.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'VerifierExports');
  assert.ok(contract, 'VerifierExports interface must exist');
  const exports = new Map(WebAssembly.Module.exports(wasm).map(e => [e.name, e.kind]));
  for (const member of contract.members) {
    if (member.questionToken) continue;
    const name = member.name.getText(source);
    assert.equal(exports.get(name), ts.isFunctionTypeNode(member.type) ? 'function' : 'memory', `required WASM export: ${name}`);
  }
});

for (const name of ['looping', 'non-looping']) {
  test(`WASM ${name} score matches the upstream leaderboard, including independent L`, async () => {
    const expected = JSON.parse((await fixture(`${name}.json`)).toString().replace(/^\uFEFF/, '')).score;
    const puzzle = await readFile(new URL('../public/puzzles/P007.puzzle', import.meta.url));
    const ptr = verifier.create(puzzle, await fixture(`${name}.solution`));
    try {
      verifier.setCycleLimit(ptr, 150000);
      verifier.setCollisionCheckLimit(ptr, 0n);
      for (let i = 0; i < 150 && !verifier.converged(ptr) && !verifier.error(ptr); i++) verifier.advance(ptr, 1000);
      assert.equal(verifier.error(ptr), null);
      // Steady-state detection may precede the sixth product. The separate
      // completion measurement still has to match the leaderboard's cycles.
      assert.equal(verifier.converged(ptr), true);
      assert.deepEqual(computeScore(verifier, ptr, 'NORMAL'), expected);
    } finally { verifier.destroy(ptr); }
  });
}

test('WASM retains incremental progress and measures growing width/bounding hex as per-output rates', async () => {
  const ptr = verifier.create(await fixture('growing.puzzle'), await fixture('growing.solution'));
  try {
    verifier.setCollisionCheckLimit(ptr, 0n);
    verifier.advance(ptr, 1);
    assert.equal(verifier.currentCycle(ptr), 1);
    assert.equal(verifier.converged(ptr), false);
    assert.deepEqual(verifier.outputIntervals(ptr), {count: 0, intervals: [], repeatAfter: -1});
    assert.equal(verifier.currentCycle(ptr), 1, 'interval getters must not run a full throughput simulation');
    let sawFiniteOutputs = false;
    for (let i = 0; i < 100 && !verifier.converged(ptr); i++) {
      verifier.advance(ptr, 1);
      const observed = verifier.outputIntervals(ptr);
      if (!verifier.converged(ptr) && observed.count > 0) {
        sawFiniteOutputs = true;
        assert.equal(observed.repeatAfter, -1, 'finite observed output must not be reported as infinite');
      }
    }
    assert.equal(sawFiniteOutputs, true);
    assert.equal(verifier.completed(ptr), true);
    assert.equal(verifier.converged(ptr), true);
    assert.equal(verifier.error(ptr), null);
    const result = computeScore(verifier, ptr, 'NORMAL');
    assert.equal(result.looping, true);
    assert.equal(result.rate, 3);
    assert.deepEqual(result.areaINF, {level: 1, value: 0.5});
    assert.deepEqual(result.heightINF, {level: 0, value: 4});
    assert.deepEqual(result.widthINF, {level: 1, value: 0.25});
    assert.deepEqual(result.boundingHexINF, {level: 1, value: 0.25});
  } finally { verifier.destroy(ptr); }
});
