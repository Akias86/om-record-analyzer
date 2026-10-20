import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {getAvailableAxisMetrics, getAxisValue, getAxisDomain} = await importTs(new URL('../src/components/pareto/axes.ts', import.meta.url));
const {formatTick, generateTicks} = await importTs(new URL('../src/components/pareto/ticks.ts', import.meta.url));
const {getMetricValue} = await importTs(new URL('../src/lib/metrics.ts', import.meta.url));
const {getManifold} = await importTs(new URL('../src/lib/manifold.ts', import.meta.url));
const {INFINITY_SCORE_KEYS} = await importTs(new URL('../src/types.ts', import.meta.url));

const score = (overrides = {}) => ({
  cost: 40, instructions: 8, overlap: false, trackless: true, looping: false,
  cycles: 50, area: 20, height: 4, width: 4.5, boundingHex: 3, rate: 5,
  areaINF: null, heightINF: null, widthINF: null, boundingHexINF: null,
  ...overrides,
});

test('Axes offers every new @∞ object field using the existing numeric conversion', () => {
  for (const key of INFINITY_SCORE_KEYS) {
    for (const level of [0, 1, 2]) {
      const s = score({[key]: {level, value: 1.25}});
      assert.ok(getAvailableAxisMetrics([s]).includes(key));
      for (const scale of ['linear', 'log']) {
        assert.equal(getAxisValue(s, key, scale), getMetricValue(s, key));
        assert.equal(getAxisValue(s, key, scale), 1.25 * 100000 ** level);
      }
    }
  }
});

test('Axes excludes unknown @∞ measurements but admits fields available only in local scores', () => {
  const leaderboard = [null, score()];
  const local = [score({widthINF: {level: 1, value: 0.25}})];
  assert.ok(!getAvailableAxisMetrics(leaderboard).includes('widthINF'));
  assert.ok(getAvailableAxisMetrics([...leaderboard, ...local]).includes('widthINF'));
  assert.deepEqual(getAvailableAxisMetrics([]), []);
  assert.equal(getAxisValue(score(), 'areaINF', 'linear'), null);
});

test('Axes still limits new @∞ fields to those supported by the selected manifold', () => {
  const s = score(Object.fromEntries(INFINITY_SCORE_KEYS.map(key => [key, {level: 1, value: 0.25}])));
  for (const [manifold, key] of [
    ['INFINITY_AREA', 'areaINF'], ['INFINITY_HEIGHT', 'heightINF'],
    ['INFINITY_WIDTH', 'widthINF'], ['INFINITY_BHEX', 'boundingHexINF'],
  ]) {
    const options = getAvailableAxisMetrics([s], getManifold(manifold));
    assert.deepEqual(options.filter(k => INFINITY_SCORE_KEYS.includes(k)), [key]);
  }
});

test('new @∞ fractional projections determine linear domain and decimal tick spacing', () => {
  for (const key of INFINITY_SCORE_KEYS) {
    const values = [
      {level: 0, value: 0.125},
      {level: 1, value: 0.0000025},
      {level: 2, value: 0.00000000005},
    ].map(value => getAxisValue(score({[key]: value}), key, 'linear'));
    const axis = getAxisDomain(values, 'linear');
    assert.deepEqual(values, [0.125, 0.25, 0.5]);
    assert.equal(axis.isInteger, false);
    assert.equal(axis.domain[0], 0);
    assert.ok(axis.domain[1] > 0.5);
    assert.ok(axis.ticks.includes(0.1));
    assert.ok(axis.ticks.some(t => t > 0 && t < 0.5));
  }
});

test('log axes include positive values below 1 instead of clipping them', () => {
  const axis = getAxisDomain([0.125, 0.25, 0.5], 'log');
  assert.equal(axis.domain[0], 0.125);
  assert.ok(axis.domain[1] > 0.5);
  assert.ok(axis.ticks.some(t => t > 0 && t < 1));
  assert.ok(axis.ticks.every(t => t >= axis.domain[0] && t <= axis.domain[1]));
});

test('log plotting consistently omits nonpositive coordinates and missing measurements', () => {
  for (const value of [0, -1]) {
    const s = score({heightINF: {level: 0, value}});
    assert.equal(getAxisValue(s, 'heightINF', 'log'), null);
    assert.equal(getAxisValue(s, 'heightINF', 'linear'), value);
  }
  assert.equal(getAxisDomain([0, -1, Infinity, NaN], 'log'), null);
  assert.equal(getAxisDomain([], 'linear'), null);
});

test('fractional zoom ticks and labels retain sub-unit precision without a 0.5 step floor', () => {
  const ticks = generateTicks([0.125, 0.225], false);
  assert.ok(ticks.length > 2);
  assert.ok(ticks.every(t => t >= 0.125 && t <= 0.225));
  assert.equal(formatTick(0.125), '0.125');
  assert.equal(formatTick(0.00125), '0.00125');
  assert.equal(formatTick(4.25), '4.25');
  const tiny = generateTicks([0.00000000001, 0.00000000002], false);
  assert.ok(tiny.length > 2);
  assert.equal(new Set(tiny.map(formatTick)).size, tiny.length);
});

test('integer axes keep integer ticks, while all-zero linear data has a nondegenerate domain', () => {
  const axis = getAxisDomain([1, 2, 5], 'linear');
  assert.equal(axis.isInteger, true);
  assert.ok(axis.ticks.every(Number.isInteger));
  assert.ok(generateTicks([0, 5], true).every(Number.isInteger));
  const zero = getAxisDomain([0], 'linear');
  assert.ok(zero.domain[0] < zero.domain[1]);
});
