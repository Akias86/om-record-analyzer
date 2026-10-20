import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {classifyPoint, groupPointsByClass} = await importTs(new URL('../src/components/pareto/points.ts', import.meta.url));
const {CLASS_ORDER, CLASS_COLOR, CLASS_FRONTIER_COLOR} = await importTs(new URL('../src/components/pareto/constants.ts', import.meta.url));
const point = (overrides = {}) => ({
  x: 1, y: 1, id: 'point', score: null, categories: null, recordIndex: 0,
  overlap: false, trackless: false, looping: false, ...overrides,
});

test('Looping legend follows O → T → L and uses #76BBF9 for both ordinary and frontier points', () => {
  assert.deepEqual(CLASS_ORDER, ['overlap', 'trackless', 'looping', 'normal']);
  assert.equal(CLASS_COLOR.looping, '#76BBF9');
  assert.equal(CLASS_FRONTIER_COLOR.looping, '#76BBF9');
});

test('point flag color precedence is O → T → L for every flag combination', () => {
  for (const overlap of [false, true]) {
    for (const trackless of [false, true]) {
      for (const looping of [false, true]) {
        assert.equal(classifyPoint(point({overlap, trackless, looping})),
          overlap ? 'overlap' : trackless ? 'trackless' : looping ? 'looping' : 'normal');
      }
    }
  }
});

test('unknown legacy Looping values do not receive the Looping color', () => {
  for (const looping of [null, undefined]) {
    assert.equal(classifyPoint(point({looping})), 'normal');
  }
});

test('point groups contain Looping separately and preserve empty classes', () => {
  const points = [
    point({id: 'O', overlap: true, trackless: true, looping: true}),
    point({id: 'T', trackless: true, looping: true}),
    point({id: 'L', looping: true}),
    point({id: 'N'}),
  ];
  const groups = groupPointsByClass(points);
  assert.deepEqual(Object.keys(groups), CLASS_ORDER);
  assert.deepEqual(CLASS_ORDER.map(key => groups[key].map(p => p.id)), [['O'], ['T'], ['L'], ['N']]);
  assert.equal(groups.looping[0], points[2]);
  assert.deepEqual(groupPointsByClass([]), {overlap: [], trackless: [], looping: [], normal: []});
});
