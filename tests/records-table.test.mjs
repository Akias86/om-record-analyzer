import test from 'node:test';
import assert from 'node:assert/strict';
import {act, createElement as h, Fragment} from 'react';
import {readFile} from 'node:fs/promises';
import {createDom} from './helpers/dom.mjs';
import {importTs} from './helpers/import-ts.mjs';

const {default: RecordsTable} = await importTs(new URL('../src/components/records/RecordsTable.tsx', import.meta.url));
const {getRecordsTableLayout} = await importTs(new URL('../src/components/records/layout.ts', import.meta.url));
const {useRecordsNameWidth} = await importTs(new URL('../src/components/records/useRecordsNameWidth.ts', import.meta.url));
const {makeDiamondShape} = await importTs(new URL('../src/components/pareto/shapes.tsx', import.meta.url));
const {USER_GREEN, USER_RED} = await importTs(new URL('../src/components/pareto/constants.ts', import.meta.url));
const {score} = JSON.parse((await readFile(new URL('./fixtures/verify/looping.json', import.meta.url), 'utf8')).replace(/^\uFEFF/, ''));
function NameWidthProbe({names, visible = true}) {
  const {tableRef, longestNameWidth} = useRecordsNameWidth(names, visible);
  return h('div', {'data-name-width': longestNameWidth}, visible && h('table', {ref: tableRef},
    h('tbody', null, names.map((name, i) => h('tr', {key: i},
      h('td', null, h('span', {className: 'records-table-user-name'}, name)),
    ))),
  ));
}

const GreenDiamond = makeDiamondShape(USER_GREEN);
const RedDiamond = makeDiamondShape(USER_RED);

function sharedRecords() {
  const users = ['First save', 'Second save'].map((solutionName, i) => ({
    id: `user-${i}`, puzzleId: 'P007', puzzleType: 'NORMAL', solutionName,
    score: {...score, cost: 40 + i}, fullScore: '40g/143c/12a', solutionKey: `file-${i}`,
  }));
  return {
    records: [{id: 'leaderboard', puzzle: {id: 'P007', type: 'NORMAL'}, score,
      smartFormattedScore: '40g/143c/12a', fullFormattedScore: '40g/143c/12a'}],
    recordsReady: true, loading: false, error: null, puzzleType: 'NORMAL', metrics: [],
    puzzleUserRecords: users,
    userFrontierByManifold: new Map([
      ['VICTORY_AREA', new Set([users[0].id])],
      ['INFINITY_AREA', new Set([users[1].id])],
    ]),
  };
}

const pathStyle = path => Object.fromEntries(
  ['d', 'fill', 'fill-opacity', 'stroke', 'stroke-width'].map(key => [key, path.getAttribute(key)]),
);

test('Records uses the same red/green diamonds as Pareto Chart in both score modes', async t => {
  const dom = createDom(t);
  await dom.render(h(Fragment, null,
    h(RecordsTable, {shared: sharedRecords(), onPlayRecord() {}, onPlayUserSolution() {}}),
    h('svg', {'data-chart': 'green'}, h(GreenDiamond, {cx: 0, cy: 0})),
    h('svg', {'data-chart': 'red'}, h(RedDiamond, {cx: 0, cy: 0})),
  ));
  const chart = color => dom.container.querySelector(`[data-chart="${color}"] path`);
  const assertMarkers = colors => {
    const rows = [...dom.container.querySelectorAll('.records-table-row-user')];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const name = row.querySelector('.records-table-user-name').textContent;
      const marker = row.querySelector('.records-table-user-marker');
      assert.equal(marker.tagName.toLowerCase(), 'svg');
      assert.equal(marker.getAttribute('aria-hidden'), 'true');
      assert.equal(marker.getAttribute('viewBox'), '-6 -6 12 12');
      assert.equal(marker.querySelector('circle'), null);
      assert.deepEqual(pathStyle(marker.querySelector('path')), pathStyle(chart(colors[name])));
      assert.equal(row.querySelector('.records-table-flag-dot[title="Looping"]').tagName, 'SPAN');
    }
  };
  assertMarkers({'First save': 'green', 'Second save': 'red'});
  const infinity = [...dom.container.querySelectorAll('button')].find(button => button.textContent === '@∞');
  await act(async () => infinity.click());
  assertMarkers({'First save': 'red', 'Second save': 'green'});
});

test('diamond clicks and keyboard activation still play the selected user record', async t => {
  const dom = createDom(t);
  const shared = sharedRecords();
  const play = t.mock.fn();
  await dom.render(h(RecordsTable, {shared, onPlayRecord() {}, onPlayUserSolution: play}));
  const row = dom.container.querySelector('.records-table-row-user');
  const selected = shared.puzzleUserRecords.find(user => user.solutionName === row.querySelector('.records-table-user-name').textContent);
  await act(async () => row.querySelector('.records-table-user-marker path').dispatchEvent(
    new dom.window.MouseEvent('click', {bubbles: true}),
  ));
  for (const key of ['Enter', ' ']) {
    await act(async () => row.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key, bubbles: true})));
  }
  assert.equal(play.mock.callCount(), 3);
  for (const call of play.mock.calls) assert.equal(call.arguments[0], selected);
});

test('leaderboard-only tables preserve the compact rank column and Category allowance', () => {
  assert.deepEqual(getRecordsTableLayout(7), {minTableWidth: 1169, rankWidth: 76});
  assert.deepEqual(getRecordsTableLayout(0), {minTableWidth: 469, rankWidth: 76});
});

test('user name columns retain the 76px minimum and 240px cap without widening the table minimum', () => {
  for (const count of [0, 3, 7]) {
    const layout = getRecordsTableLayout(count, 500);
    assert.equal(layout.minTableWidth, 469 + count * 100);
    assert.equal(layout.rankWidth, `clamp(76px, calc(max(100cqw, ${469 + count * 100}px) - ${313 + count * 100}px), 240px)`);
    assert.equal(layout.minTableWidth, getRecordsTableLayout(count).minTableWidth,
      'extra name space must come from Category, not a wider table');
  }
});

test('short and medium names take only their measured width plus marker and padding', () => {
  for (const textWidth of [0, 10, 30, 38]) assert.equal(getRecordsTableLayout(7, textWidth).rankWidth, 76);
  for (const textWidth of [50, 84.3, 130, 180]) {
    const layout = getRecordsTableLayout(7, textWidth);
    assert.equal(layout.rankWidth,
      `clamp(76px, calc(max(100cqw, 1169px) - 1013px), ${Math.ceil(textWidth) + 38}px)`);
    assert.equal(layout.minTableWidth, 1169);
  }
});

test('name measurement tracks longest rendered text, shrinks after replacement/removal and waits for loading', async t => {
  const dom = createDom(t);
  const widths = new Map([['ii', 7], ['WW', 25], ['中🌊', 30], ['A long save', 90], ['very long', 500]]);
  t.mock.getter(dom.window.HTMLElement.prototype, 'scrollWidth', function () {
    return widths.get(this.textContent) ?? 0;
  });
  const render = (names, visible = true) => dom.render(h(NameWidthProbe, {names, visible}));
  const measured = () => Number(dom.container.firstElementChild.dataset.nameWidth);
  await render(['very long'], false);
  assert.equal(measured(), 0);
  await render(['very long']);
  assert.equal(measured(), 501, 'measure the full text, including any ellipsized portion');
  await render(['ii', 'WW', '中🌊', 'A long save']);
  assert.equal(measured(), 91, 'removing the longest name must shrink the column');
  await render(['ii', 'WW']);
  assert.equal(measured(), 26, 'use actual glyph widths, not character counts');
  await render(['ii']);
  assert.equal(measured(), 8);
  await render([]);
  assert.equal(measured(), 0);
});

test('name measurement is refreshed after fonts load and removes listeners on unmount', async t => {
  const dom = createDom(t);
  const fonts = new dom.window.EventTarget();
  Object.defineProperty(dom.window.document, 'fonts', {value: fonts, configurable: true});
  let width = 50;
  const measure = t.mock.getter(dom.window.HTMLElement.prototype, 'scrollWidth', () => width);
  await dom.render(h(NameWidthProbe, {names: ['font-dependent save']}));
  assert.equal(dom.container.firstElementChild.dataset.nameWidth, '51');
  width = 100;
  await act(async () => fonts.dispatchEvent(new dom.window.Event('loadingdone')));
  assert.equal(dom.container.firstElementChild.dataset.nameWidth, '101');
  await dom.render(null);
  const calls = measure.mock.callCount();
  await act(async () => fonts.dispatchEvent(new dom.window.Event('loadingdone')));
  assert.equal(measure.mock.callCount(), calls);
});

test('bounded name widths follow visible user records and retain complete long-name tooltips', async t => {
  const dom = createDom(t);
  const shared = sharedRecords();
  const longName = '这是一个很长的用户存档名称 🌊 ' + 'long-save-name-'.repeat(12);
  shared.puzzleUserRecords = shared.puzzleUserRecords.map(user => ({
    ...user, solutionName: longName + user.id, score: {...user.score, rate: null},
  }));
  await dom.render(h(RecordsTable, {shared, onPlayRecord() {}, onPlayUserSolution() {}}));
  const header = dom.container.querySelector('.records-table-th-rank');
  // Happy DOM does not parse nested clamp/calc widths; actual column bounds
  // are browser-verified. The table minimum remains unchanged across modes.
  assert.equal(dom.container.querySelector('table').style.minWidth, '1169px');
  const sizing = dom.container.querySelector('table').parentElement;
  assert.ok(sizing.classList.contains('records-table-sizing'));
  assert.equal(sizing.style.minWidth, '1169px', 'sizing must exclude the outer scrollbar gutter');
  for (const name of dom.container.querySelectorAll('.records-table-user-name')) {
    assert.ok(name.textContent.startsWith(longName));
    assert.equal(name.title, name.textContent, 'ellipsis must not discard the complete saved name');
  }
  const modeButton = label => [...dom.container.querySelectorAll('button')].find(button => button.textContent === label);
  await act(async () => modeButton('@∞').click());
  assert.equal(dom.container.querySelectorAll('.records-table-row-user').length, 0);
  assert.equal(header.style.width, '76px');
  assert.equal(dom.container.querySelector('table').style.minWidth, '1169px');
  await act(async () => modeButton('@V').click());
  assert.equal(dom.container.querySelector('table').style.minWidth, '1169px');
  assert.equal(dom.container.querySelectorAll('.records-table-user-name').length, 2);
});
