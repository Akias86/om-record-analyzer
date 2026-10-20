import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {parseHash, puzzleHash, recordPlaybackTarget, findPlaybackRecord} = await importTs(new URL('../src/lib/routes.ts', import.meta.url));
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

test('clearing playback returns to a plain puzzle route', () => {
  const {puzzleId} = parseHash(puzzleHash('P007', recordPlaybackTarget(record())));
  assert.deepEqual(parseHash(puzzleHash(puzzleId)), {...empty, puzzleId: 'P007'});
});
