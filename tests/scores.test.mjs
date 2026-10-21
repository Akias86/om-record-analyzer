import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {normalizeScore, canReuseUserScore, USER_SCORE_VERSION} = await importTs(new URL('../src/lib/scores.ts', import.meta.url));
const {getMetricValue, formatLevelValue, formatAreaINF} = await importTs(new URL('../src/lib/metrics.ts', import.meta.url));
const {compareMetric, getManifold, supportsScore, computeFrontierIndices} = await importTs(new URL('../src/lib/manifold.ts', import.meta.url));
const {parseCategoryCached, evaluateCategoryHolders} = await importTs(new URL('../src/lib/customCategories.ts', import.meta.url));
const {parseBoolFilters, matchesScoreFilters} = await importTs(new URL('../src/lib/scoreFilters.ts', import.meta.url));
const {parseFlags, nextFlagState, activeFlagSorting} = await importTs(new URL('../src/components/records/flags.ts', import.meta.url));
const {formatScoreParts} = await importTs(new URL('../src/lib/verify/format.ts', import.meta.url));
const {computeScore} = await importTs(new URL('../src/lib/verify/metrics.ts', import.meta.url));

const lv = (level, value) => ({level, value});
const score = (overrides = {}) => ({
  cost: 40, instructions: 8, overlap: false, trackless: true, looping: true,
  cycles: 50, area: 20, height: 4, width: 4.5, boundingHex: 3, rate: 5,
  areaINF: lv(0, 22), heightINF: lv(0, 4), widthINF: lv(0, 4.5), boundingHexINF: lv(0, 3),
  ...overrides,
});

test('new scores preserve explicit looping=false even when Rate is present', () => {
  const value = score({looping: false});
  assert.deepEqual(normalizeScore(value), value);
  assert.ok(compareMetric('looping', value, score()) > 0);
  assert.equal(compareMetric('looping', value, score({looping: false, rate: null})), 0);
});

test('upload reuse requires a matching hash, the corrected score version, and a known L value', () => {
  assert.equal(USER_SCORE_VERSION, 3);
  const cached = {hash: 'same-file', scoreVersion: USER_SCORE_VERSION, score: score()};
  assert.equal(canReuseUserScore(cached, 'same-file'), true);
  assert.equal(canReuseUserScore({...cached, score: score({looping: false})}, 'same-file'), true);
  for (const looping of [null, undefined]) {
    assert.equal(canReuseUserScore({...cached, score: score({looping})}, 'same-file'), false);
  }
  for (const scoreVersion of [undefined, 1, 2]) {
    assert.equal(canReuseUserScore({...cached, scoreVersion}, 'same-file'), false);
  }
  assert.equal(canReuseUserScore(cached, 'changed-file'), false);
  assert.equal(canReuseUserScore(cached, null), false);
  assert.equal(canReuseUserScore(undefined, 'same-file'), false);
});

test('legacy scores migrate finite dimensions without inventing Looping or infinite growth rates', () => {
  const {areaINF, looping, ...base} = score();
  const migrated = normalizeScore({...base, areaINFLevel: 2, areaINFValue: 1.5, heightINF: 4, widthINF: 'Infinity', boundingHexINF: null});
  assert.deepEqual(migrated.areaINF, lv(2, 1.5));
  assert.deepEqual(migrated.heightINF, lv(0, 4));
  assert.equal(migrated.widthINF, null);
  assert.equal(migrated.looping, null);
  assert.equal('areaINFLevel' in migrated, false);
  assert.equal('areaINFValue' in migrated, false);
  assert.deepEqual(areaINF, lv(0, 22));
  assert.equal(looping, true);
});

test('all four @∞ metrics use a graded chart value and preserve growth notation for display', () => {
  for (const key of ['areaINF', 'heightINF', 'widthINF', 'boundingHexINF']) {
    assert.equal(getMetricValue(score({[key]: lv(1, 1.25)}), key), 125000);
    assert.equal(getMetricValue(score({[key]: lv(0, 4.5)}), key), 4.5);
    assert.equal(getMetricValue(score({[key]: null}), key), null);
    assert.equal(getMetricValue(score({[key]: lv(1, Infinity)}), key), null);
  }
  assert.equal(formatAreaINF(score({areaINF: lv(2, 1.25)})), "1.25a''");
  assert.equal(formatLevelValue(lv(1, 0.25)), "0.25'");
  assert.equal(formatLevelValue(lv(1, 0.25), 'b'), "0.25b'");
  assert.equal(formatLevelValue(null), null);
});

test('every @∞ metric compares level before value, not by an approximate chart scale', () => {
  for (const key of ['areaINF', 'heightINF', 'widthINF', 'boundingHexINF']) {
    assert.ok(compareMetric(key, score({[key]: lv(0, 1e9)}), score({[key]: lv(1, 0.001)})) < 0);
    assert.ok(compareMetric(key, score({[key]: lv(1, 0.25)}), score({[key]: lv(1, 0.5)})) < 0);
    assert.ok(compareMetric(key, score({[key]: null}), score()) > 0);
  }
});

test('@∞ frontiers admit steady-state scores with looping=false; @V compares Looping independently', () => {
  const nonLooping = score({looping: false});
  assert.equal(supportsScore(getManifold('INFINITY_AREA'), nonLooping), true);
  assert.deepEqual(computeFrontierIndices(getManifold('VICTORY_AREA'), [nonLooping, score()]), [1]);
  assert.deepEqual(computeFrontierIndices(getManifold('INFINITY_AREA'), [nonLooping, score()]), [0, 1]);
});

test('custom category L admission uses the explicit flag; bare h∞ uses level/value ordering', () => {
  const category = parseCategoryCached('@aV: L, g');
  assert.equal(category.ok, true);
  assert.deepEqual([...evaluateCategoryHolders(category.category, 'NORMAL', [score({looping: false}), score()])], [1]);
  const heightCategory = parseCategoryCached('@h∞: true, h∞');
  assert.equal(heightCategory.ok, true);
  assert.deepEqual([...evaluateCategoryHolders(heightCategory.category, 'NORMAL', [score({heightINF: lv(1, 0.001)}), score({heightINF: lv(0, 1e9)})])], [1]);
});

test('chart defaults and old saved filters include Looping=Any; Yes/No do not match unknown legacy flags', () => {
  const filters = parseBoolFilters(JSON.stringify({overlap: 'false', trackless: 'true'}));
  assert.deepEqual(filters, {overlap: 'false', trackless: 'true', looping: 'any'});
  assert.equal(matchesScoreFilters(score({looping: false}), filters), true);
  assert.equal(matchesScoreFilters(score({looping: null}), filters), true);
  for (const looping of [true, false]) {
    const selected = {...filters, looping: String(looping)};
    assert.equal(matchesScoreFilters(score({looping}), selected), true);
    assert.equal(matchesScoreFilters(score({looping: !looping}), selected), false);
    assert.equal(matchesScoreFilters(score({looping: null}), selected), false);
  }
  assert.equal(parseBoolFilters('{broken').looping, 'any');
});

test('Records L defaults off and follows exactly the T cycle; flag priority is O → T → L', () => {
  assert.deepEqual(parseFlags(null), {o: 'asc', t: null, l: null});
  assert.deepEqual(parseFlags('{"o":null,"t":"desc"}'), {o: null, t: 'desc', l: null});
  for (const flag of ['trackless', 'looping']) {
    let state = null;
    for (const expected of ['desc', 'asc', null]) {
      state = nextFlagState(flag, state);
      assert.equal(state, expected);
    }
  }
  assert.deepEqual(activeFlagSorting({o: 'asc', t: 'desc', l: 'asc'}).map(({id}) => id), ['overlap', 'trackless', 'looping']);
  assert.deepEqual(activeFlagSorting({o: null, t: null, l: 'desc'}), [{id: 'looping', desc: false}]);
  assert.deepEqual(parseFlags('{"o":"invalid","t":true,"l":"desc"}'), {o: 'asc', t: null, l: 'desc'});
});

test('formatted scores include L only when explicitly true and render all growth-rate suffixes', () => {
  const parts = formatScoreParts(score({looping: false, heightINF: lv(1, 1.25), widthINF: lv(1, 0.5), boundingHexINF: lv(1, 0.25)}));
  assert.ok(parts.infinity);
  assert.doesNotMatch(parts.victory, /L/);
  assert.match(parts.infinity, /1\.25h'/);
  assert.match(parts.infinity, /0\.5w'/);
  assert.match(parts.infinity, /0\.25b'/);
  assert.match(formatScoreParts(score({overlap: true})).victory, /\/OTL@V$/);
});

test('local scores compute dimension growth per output and do not derive L from Rate', () => {
  const values = {
    cost: 40, instructions: 8, overlap: 0, 'number of track segments': 0,
    cycles: 50, area: 20, height: 4, width: 4.5, 'minimum hexagon': 3,
    'per repetition outputs': 2, 'per repetition cycles': 7,
    'per repetition^2 area': 0, 'per repetition area': 3,
    'per repetition height': 1, 'per repetition width': 0,
    'per repetition minimum hexagon': 0.5, 'steady state width': 4.5,
  };
  const verifier = {evaluate: (_, key) => values[key], error: () => null, looping: () => false};
  const result = computeScore(verifier, 1, 'NORMAL');
  assert.equal(result.rate, 3.5);
  assert.equal(result.looping, false);
  assert.deepEqual(result.areaINF, lv(1, 1.5));
  assert.deepEqual(result.heightINF, lv(1, 0.5));
  assert.deepEqual(result.widthINF, lv(0, 4.5));
  assert.deepEqual(result.boundingHexINF, lv(1, 0.25));
  verifier.looping = () => { throw new Error('must not simulate throughput'); };
  const partial = computeScore(verifier, 1, 'NORMAL', true);
  assert.equal(partial.rate, null);
  assert.equal(partial.looping, null);
  assert.equal(partial.areaINF, null);
});
