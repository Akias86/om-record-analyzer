import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {parseHash, puzzleHash, recordPlaybackTarget, findPlaybackRecord, findUserPlaybackRecord} = await importTs(new URL('../src/lib/routes.ts', import.meta.url));
const empty = {validator: false, puzzleId: null, playback: null};
const record = (overrides = {}) => ({
  id: 'record-1', puzzle: {id: 'P007'}, solution: 'https://example.com/one.solution',
  gif: 'https://example.com/one.gif', ...overrides,
});

test('existing home, puzzle and validator routes remain compatible', () => {
  for (const hash of ['', '#', '#/unknown', '#/puzzle/']) assert.deepEqual(parseHash(hash), empty);
  assert.deepEqual(parseHash('#/puzzle/P007'), {...empty, puzzleId: 'P007'});
  assert.deepEqual(parseHash('#/validator'), {...empty, validator: true});
  assert.deepEqual(parseHash('#/validator?record=ignored'), {...empty, validator: true});
  assert.equal(puzzleHash('P007'), '#/puzzle/P007');
});

test('playback routes round-trip encoded puzzle and record identifiers', () => {
  const puzzleId = '关卡 /?#+%';
  const playback = {kind: 'record', value: '记录 /?#+%&='};
  const hash = puzzleHash(puzzleId, playback);
  assert.deepEqual(parseHash(hash), {validator: false, puzzleId, playback});
  assert.equal(puzzleHash('P007', {kind: 'record', value: 'abc'}), '#/puzzle/P007?record=abc');
});

test('invalid path encoding does not crash the app; empty playback and unknown parameters are ignored', () => {
  for (const hash of ['#/puzzle/%', '#/puzzle/%E0%A4%A']) assert.deepEqual(parseHash(hash), empty);
  for (const query of ['record=', 'unrelated=value', 'record=&solution=&gif=']) {
    assert.deepEqual(parseHash(`#/puzzle/P007?${query}`), {...empty, puzzleId: 'P007'});
  }
  assert.deepEqual(parseHash('#/puzzle/P007?unrelated=1&record=abc').playback, {kind: 'record', value: 'abc'});
});

test('stable record ids are preferred and remain resolvable when rows reorder', () => {
  const selected = record();
  const target = recordPlaybackTarget(selected);
  assert.deepEqual(target, {kind: 'record', value: selected.id});
  const other = record({id: 'record-2'});
  assert.equal(findPlaybackRecord([other, selected], 'P007', target), selected);
  assert.equal(findPlaybackRecord([selected, other], 'P007', target), selected);
});

test('legacy records use solution or GIF identifiers without relying on row indices', () => {
  for (const selected of [
    record({id: null, solution: 'https://example.com/a.solution?x=1&y=2+#fragment'}),
    record({id: null, solution: null, gif: 'https://example.com/动画.gif?a=1&b=2'}),
  ]) {
    const target = recordPlaybackTarget(selected);
    assert.equal(target.kind, selected.solution ? 'solution' : 'gif');
    const route = parseHash(puzzleHash('P007', target));
    assert.deepEqual(route.playback, target);
    assert.equal(findPlaybackRecord([selected], route.puzzleId, route.playback), selected);
  }
  assert.equal(recordPlaybackTarget(record({id: null, solution: null, gif: null})), null);
});

test('record targets take precedence and missing or stale puzzle data cannot play the wrong record', () => {
  const target = parseHash('#/puzzle/P007?record=missing&solution=https%3A%2F%2Fexample.com%2Fone.solution').playback;
  assert.deepEqual(target, {kind: 'record', value: 'missing'});
  assert.equal(findPlaybackRecord([record()], 'P007', target), undefined);
  assert.equal(findPlaybackRecord([record()], 'P008', recordPlaybackTarget(record())), undefined);
  assert.equal(findPlaybackRecord([], 'P007', recordPlaybackTarget(record())), undefined);
  assert.equal(findPlaybackRecord([record()], 'P007', {kind: 'gif', value: 'https://untrusted.example/arbitrary.gif'}), undefined);
});

test('local playback routes round-trip stable user IDs without exposing files or storage keys', () => {
  const local = {id: 'local /?#+', puzzleId: 'P007', solutionKey: 'private-content-key'};
  const target = {kind: 'user', value: local.id};
  const hash = puzzleHash(local.puzzleId, target);
  assert.deepEqual(parseHash(hash), {...empty, puzzleId: 'P007', playback: target});
  assert.ok(!hash.includes(local.solutionKey));
  assert.equal(findUserPlaybackRecord([{...local, id: 'other'}, local], 'P007', target), local);
  assert.equal(findUserPlaybackRecord([local], 'P008', target), undefined);
  assert.equal(findUserPlaybackRecord([], 'P007', target), undefined);
});

test('local and leaderboard namespaces never resolve each other or use a hash-supplied storage key', () => {
  const local = {id: 'record-1', puzzleId: 'P007', solutionKey: 'stored-key'};
  assert.equal(findPlaybackRecord([record()], 'P007', {kind: 'user', value: 'record-1'}), undefined);
  assert.equal(findUserPlaybackRecord([local], 'P007', {kind: 'record', value: 'record-1'}), undefined);
  assert.equal(findUserPlaybackRecord([local], 'P007', {kind: 'user', value: 'stored-key'}), undefined);
  assert.deepEqual(parseHash('#/puzzle/P007?record=abc&user=def').playback, {kind: 'record', value: 'abc'});
  assert.deepEqual(parseHash('#/puzzle/P007?user='), {...empty, puzzleId: 'P007'});
});

test('old user records still resolve so the UI can request a re-upload', () => {
  const local = {id: 'legacy', puzzleId: 'P007'};
  assert.equal(findUserPlaybackRecord([local], 'P007', {kind: 'user', value: 'legacy'}), local);
});

test('clearing playback returns to a plain puzzle route', () => {
  const {puzzleId} = parseHash(puzzleHash('P007', recordPlaybackTarget(record())));
  assert.deepEqual(parseHash(puzzleHash(puzzleId)), {...empty, puzzleId: 'P007'});
});
