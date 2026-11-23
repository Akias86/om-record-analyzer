import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {importTs} from './helpers/import-ts.mjs';

const {parseScoreString, parseScoreFlags} = await importTs(new URL('../src/dev/demo/scoreString.ts', import.meta.url));
const {buildDemoRecords, demoSolutionUrl, asOmType} = await importTs(new URL('../src/dev/demo/records.ts', import.meta.url));

const puzzles = JSON.parse(await readFile(new URL('../src/dev/demo/puzzles.json', import.meta.url), 'utf8'));
const scores = JSON.parse(await readFile(new URL('../src/dev/demo/scores.json', import.meta.url), 'utf8'));
const byId = new Map(puzzles.map(puzzle => [puzzle.id, puzzle]));

test('victory-only score strings fill the victory metrics and leave @∞ unknown', () => {
  const score = parseScoreString('100g-450i-450c-52a-3h-T');
  assert.deepEqual(score, {
    cost: 100, instructions: 450, cycles: 450, area: 52,
    height: 3, width: null, boundingHex: null, rate: null,
    overlap: false, trackless: true, looping: false,
    areaINF: null, heightINF: null, widthINF: null, boundingHexINF: null,
  });
});

test('a repeated geometry letter opens the @∞ group, with digits as growth levels', () => {
  const score = parseScoreString('20g-0i-3c-2a-1h-1.5w-2b-0.5r-2a-1h-1.5w-2b-OTL');
  assert.equal(score.cost, 20);
  assert.equal(score.rate, 0.5);
  assert.deepEqual(score.areaINF, {level: 0, value: 2});
  assert.deepEqual(score.heightINF, {level: 0, value: 1});
  assert.deepEqual(score.widthINF, {level: 0, value: 1.5});
  assert.deepEqual(score.boundingHexINF, {level: 0, value: 2});
  assert.deepEqual(parseScoreFlags('OTL'), {overlap: true, trackless: true, looping: true});

  const levels = parseScoreString('100g-15i-83c-183a-16h-12r-4a2-2h1-L');
  assert.deepEqual(levels.areaINF, {level: 2, value: 4});
  assert.deepEqual(levels.heightINF, {level: 1, value: 2});
  assert.equal(levels.widthINF, null, 'polymer height puzzles track no width');
});

test('production score strings carry area and rate only', () => {
  const score = parseScoreString('100g-108i-395c-74a-66r-74a-TL');
  assert.equal(score.area, 74);
  assert.equal(score.rate, 66);
  assert.deepEqual(score.areaINF, {level: 0, value: 74});
  assert.equal(score.height, null);
  assert.equal(score.boundingHex, null);
});

test('malformed score strings are rejected instead of half-parsed', () => {
  for (const input of ['', 'nonsense', '100g-', '100x-10i', '100g-10i-3c-2a-1h-Q']) {
    assert.equal(parseScoreString(input), null, input);
  }
});

test('every bundled demo score string parses into a complete victory score', () => {
  let total = 0;
  for (const [puzzleId, list] of Object.entries(scores)) {
    for (const scoreString of list) {
      const score = parseScoreString(scoreString);
      assert.ok(score, `${puzzleId}: ${scoreString} did not parse`);
      for (const key of ['cost', 'instructions', 'cycles', 'area']) {
        assert.ok(Number.isFinite(score[key]), `${puzzleId}: ${scoreString} missing ${key}`);
      }
      total++;
    }
  }
  assert.ok(total > 5000, `expected a substantial dataset, saw ${total}`);
});

test('demo records use the app score formatting and recompute category badges', () => {
  const puzzle = byId.get('P007');
  assert.equal(puzzle.name, 'Stabilized Water');
  assert.equal(puzzle.type, 'NORMAL');
  const records = buildDemoRecords(puzzle, scores.P007);
  assert.equal(records.length, scores.P007.length);
  for (const record of records) {
    assert.equal(record.puzzle.id, 'P007');
    assert.equal(record.puzzle.displayName, 'Stabilized Water');
    assert.equal(record.puzzle.group.collectionId, puzzle.group.collection.id);
    assert.match(record.smartFormattedScore, /^\d+g\/\d+c\/\d+a\/\d+i/);
    // Victory-only scores carry no @ suffix; steady-state scores show both.
    if (record.score.rate === null) assert.ok(!record.fullFormattedScore.includes('@'), record.fullFormattedScore);
    else assert.match(record.fullFormattedScore, /@V .+@∞$/);
    assert.ok(record.id.startsWith('demo-P007-'));
    assert.equal(record.gif, null);
  }
  const cheapest = records.find(record => record.score.cost === Math.min(...records.map(r => r.score.cost)));
  assert.ok(cheapest.smartFormattedCategories, 'the cheapest record sits on at least one frontier');
  assert.ok(cheapest.smartFormattedCategories.includes('@aV'), cheapest.smartFormattedCategories);
});

test('production demo records expose the @∞ formatting chain', () => {
  const puzzle = byId.get('P074');
  assert.equal(asOmType(puzzle.type), 'PRODUCTION');
  const records = buildDemoRecords(puzzle, scores.P074);
  const withRate = records.find(record => record.score.rate !== null);
  assert.match(withRate.fullFormattedScore, /@V .*@∞$/);
  assert.match(withRate.fullFormattedScore, /\d+r\//);
});

test('demo solution links are immutable GitHub raw URLs', () => {
  const puzzle = byId.get('P007');
  const url = demoSolutionUrl(puzzle, '20g-0i-3c-2a-1h-1.5w-2b-0.5r-2a-1h-1.5w-2b-OTL');
  assert.equal(url, 'https://raw.githubusercontent.com/zachtronics-leaderboards/om-leaderboard/master/'
    + 'CHAPTER_1/STABILIZED_WATER/STABILIZED_WATER_20g-0i-3c-2a-1h-1.5w-2b-0.5r-2a-1h-1.5w-2b-OTL.solution');
  assert.equal(demoSolutionUrl({...puzzle, path: null}, 'x'), null);
});

test('the demo puzzle list covers every bundled puzzle file exactly once', () => {
  assert.equal(puzzles.length, new Set(puzzles.map(puzzle => puzzle.id)).size);
  assert.equal(puzzles.filter(puzzle => puzzle.path === null).length, 1, 'only unlisted puzzles lack a path');
  for (const puzzle of puzzles) {
    assert.ok(puzzle.id && puzzle.name && puzzle.type, JSON.stringify(puzzle));
    assert.ok(asOmType(puzzle.type), `${puzzle.id}: unknown type ${puzzle.type}`);
    assert.ok(puzzle.group.name && puzzle.group.collection.name, `${puzzle.id}: missing hierarchy`);
  }
  assert.ok(puzzles.length >= 264);
  assert.deepEqual([...new Set(puzzles.map(puzzle => puzzle.type))].sort(),
    ['NORMAL', 'POLYMER_HEIGHT', 'POLYMER_WIDTH', 'PRODUCTION']);
});
