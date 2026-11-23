import test from 'node:test';
import assert from 'node:assert/strict';
import {act, createElement as h, useState} from 'react';
import {createDom} from './helpers/dom.mjs';
import {importTs} from './helpers/import-ts.mjs';

// The application frame: providers, top bar (search + theme), sidebar tree and
// the two workspace headers. These are the pieces the refactor introduced, so
// they get the same DOM-level coverage as the records table and the player.
const {PuzzleTreeProvider} = await importTs(new URL('../src/state/puzzleTree.tsx', import.meta.url));
const {UserSolutionsProvider} = await importTs(new URL('../src/state/userSolutions.tsx', import.meta.url));
const {SolutionUploadProvider} = await importTs(new URL('../src/state/solutionUpload.tsx', import.meta.url));
const {AppShell} = await importTs(new URL('../src/components/layout/AppShell.tsx', import.meta.url));
const {TopBar} = await importTs(new URL('../src/components/layout/TopBar.tsx', import.meta.url));
const {WelcomeScreen} = await importTs(new URL('../src/components/layout/WelcomeScreen.tsx', import.meta.url));
const {PuzzleHeader} = await importTs(new URL('../src/components/layout/PuzzleHeader.tsx', import.meta.url));
const {default: Sidebar} = await importTs(new URL('../src/components/Sidebar.tsx', import.meta.url));
const {searchPuzzles} = await importTs(new URL('../src/lib/puzzleSearch.ts', import.meta.url));
const {mergeRecentPuzzle, parseRecentPuzzles} = await importTs(new URL('../src/lib/recentPuzzles.ts', import.meta.url));
const {nextThemeMode, resolveTheme, THEME_MODES} = await importTs(new URL('../src/lib/theme.ts', import.meta.url));

const PUZZLES = [
  {id: 'P007', displayName: 'Stabilized Water', type: 'NORMAL',
    group: {id: 'G1', displayName: 'Getting Started', collection: {id: 'C1', displayName: 'Chapter 1'}}},
  {id: 'P012', displayName: 'Water Purification', type: 'PRODUCTION',
    group: {id: 'G1', displayName: 'Getting Started', collection: {id: 'C1', displayName: 'Chapter 1'}}},
  {id: 'P045', displayName: 'Reclaiming Water', type: 'NORMAL',
    group: {id: 'G2', displayName: 'Journal II', collection: {id: 'C2', displayName: 'Journals'}}},
];

const flat = PUZZLES.map(({id, displayName, type, group}) => ({
  id, displayName, type,
  groupId: group.id, groupName: group.displayName,
  collectionId: group.collection.id, collectionName: group.collection.displayName,
}));

async function shell(t, {recent = [], puzzleId = null} = {}) {
  const dom = createDom(t);
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).startsWith('/api/om/puzzles')) return Response.json(PUZZLES);
    throw new Error(`unexpected request: ${url}`);
  });
  // The app reads the bare `localStorage` global; expose happy-dom's store and
  // restore Node's (absent) binding afterwards.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, writable: true, value: dom.window.localStorage});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });

  const picks = [];
  const views = [];

  function Harness() {
    const [selected, setSelected] = useState(puzzleId);
    const [view, setView] = useState('table');
    const select = (id) => { picks.push(id); setSelected(id); };
    const changeView = (next) => { views.push(next); setView(next); };
    return h(PuzzleTreeProvider, null,
      h(UserSolutionsProvider, null,
        h(SolutionUploadProvider, null,
          h(AppShell, {
            topBar: h(TopBar, {onPickPuzzle: select}),
            sidebar: h(Sidebar, {selectedPuzzleId: selected, onSelectPuzzle: select, recent}),
          }, selected
            ? h(PuzzleHeader, {
              puzzleId: selected,
              detail: PUZZLES.find(puzzle => puzzle.id === selected) ?? null,
              view,
              onViewChange: changeView,
              recordCount: 120,
              steadyStateCount: 40,
              userCount: 2,
              frontierCount: 1,
              loading: false,
            })
            : h(WelcomeScreen, {recent, onSelectPuzzle: select, onUpload() {}, verifiedCount: 0, frontierCount: 0})))));
  }

  await dom.render(h(Harness));
  // Let the tree request settle before asserting on rendered rows.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });

  const query = selector => dom.container.querySelector(selector);
  const all = selector => [...dom.container.querySelectorAll(selector)];
  const text = selector => query(selector)?.textContent;
  const click = async element => { await act(async () => element.click()); };
  // React DOM was imported before this isolated DOM existed, so it runs its
  // legacy input polyfill (see tests/player-speed.test.mjs): the element needs
  // the IE event shims to be tracked, and onChange arrives with keyup rather
  // than with the input event. The value is written through the prototype
  // setter so React's own value tracker still sees it as a user edit.
  const writeValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  const type = async (element, value) => {
    element.attachEvent = () => {};
    element.detachEvent = () => {};
    await act(async () => element.focus());
    writeValue.call(element, value);
    await act(async () => {
      element.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
      element.dispatchEvent(new dom.window.KeyboardEvent('keyup', {key: 'a', bubbles: true}));
    });
  };

  return {...dom, query, all, text, click, type, picks, views};
}

test('the shell shows the welcome screen, then the puzzle header after a sidebar pick', async t => {
  const dom = await shell(t);
  assert.equal(dom.text('.brand-title'), 'Opus Magnum');
  assert.ok(dom.query('.welcome-title'), 'no puzzle selected starts on the welcome screen');
  assert.equal(dom.query('.puzzle-head'), null);

  const collections = dom.all('.tree-row--collection');
  assert.deepEqual(collections.map(row => row.querySelector('.tree-label')?.textContent), ['Chapter 1', 'Journals']);
  assert.deepEqual(collections.map(row => row.querySelector('.tree-count')?.textContent), ['2', '1']);
  assert.equal(dom.query('.tree-row--puzzle'), null, 'puzzles stay collapsed until a collection opens');

  await dom.click(collections[0]);
  const groups = dom.all('.tree-row--group');
  assert.equal(groups.length, 1);
  await dom.click(groups[0]);
  const puzzles = dom.all('.tree-row--puzzle');
  assert.deepEqual(puzzles.map(row => row.querySelector('.tree-label')?.textContent), ['Stabilized Water', 'Water Purification']);
  assert.deepEqual(puzzles.map(row => row.querySelector('.tree-type')?.textContent), ['STD', 'PROD'],
    'the short type label keeps production puzzles apart from standard ones');
  assert.equal(puzzles[0].id, 'puzzle-P007');

  await dom.click(puzzles[1]);
  assert.deepEqual(dom.picks, ['P012']);
  assert.equal(dom.text('.puzzle-title'), 'Water Purification');
  assert.equal(dom.text('.puzzle-crumb-id'), 'P012');
  assert.equal(dom.text('.badge'), 'Production');
  assert.equal(dom.query('.welcome'), null);
  const selected = dom.all('.tree-row--puzzle.is-selected');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].getAttribute('aria-current'), 'true');
  assert.equal(selected[0].title, 'Water Purification (P012)');
  // Counts come from the shared records state and stay legible while loading.
  assert.match(dom.text('.puzzle-stats'), /120/);
  assert.match(dom.text('.puzzle-stats'), /40 with @∞/);
  assert.match(dom.text('.puzzle-stats'), /2 yours · 1 on frontier/);

  const buttons = dom.all('.segmented button');
  assert.deepEqual(buttons.map(button => button.textContent.trim()), ['Records', 'Pareto chart']);
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-pressed')), ['true', 'false']);
  await dom.click(buttons[1]);
  assert.deepEqual(dom.views, ['chart']);
  assert.deepEqual(dom.all('.segmented button').map(button => button.getAttribute('aria-pressed')), ['false', 'true']);
});

test('the top bar search ranks matches and opens a puzzle on Enter', async t => {
  const dom = await shell(t);
  const input = dom.query('.puzzle-search .input');
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(dom.query('.puzzle-search-results'), null, 'nothing is listed before typing');

  await dom.type(input, 'water');
  const options = dom.all('.puzzle-search-option');
  assert.deepEqual(options.map(option => option.querySelector('.puzzle-search-id')?.textContent), ['P012', 'P045', 'P007'],
    'a name that starts with the query outranks one that merely contains a word of it');
  assert.equal(options[0].getAttribute('aria-selected'), 'true');
  assert.equal(options[0].classList.contains('is-cursor'), true);
  assert.equal(options[0].querySelector('.puzzle-search-path')?.textContent, 'Chapter 1 · Getting Started');

  const focused = dom.query('.puzzle-search .input');
  await act(async () => {
    focused.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
  });
  assert.equal(dom.all('.puzzle-search-option')[1].getAttribute('aria-selected'), 'true');

  await act(async () => {
    dom.query('.puzzle-search .input')
      .dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
  });
  assert.deepEqual(dom.picks, ['P045'], 'Enter opens the highlighted match');
  assert.equal(dom.query('.puzzle-search-results'), null, 'picking closes the list');
  assert.equal(dom.query('.puzzle-search .input').value, '', 'and clears the query');

  await dom.type(dom.query('.puzzle-search .input'), 'zzz');
  assert.match(dom.text('.puzzle-search-empty'), /No puzzle matches/);
});

test('search ranking prefers an exact id, then a prefix, then a word, then the path', () => {
  const byId = query => searchPuzzles(flat, query).map(puzzle => puzzle.id);
  assert.deepEqual(byId('p045'), ['P045'], 'an exact id wins outright');
  assert.deepEqual(byId('stabilized'), ['P007'], 'an exact name wins outright');
  assert.deepEqual(byId('water'), ['P012', 'P045', 'P007'], 'a prefix beats a word match, ties sort by name');
  assert.deepEqual(byId('stabil'), ['P007'], 'a partial prefix still matches');
  assert.deepEqual(byId('journal'), ['P045'], 'the collection and group names are searchable too');
  assert.deepEqual(byId('purif'), ['P012'], 'a mid-word match is last resort but still found');
  assert.deepEqual(byId(''), [], 'an empty query lists nothing');
  assert.deepEqual(byId('   '), [], 'whitespace is not a query');
  assert.equal(searchPuzzles(flat, 'water', 2).length, 2, 'the list is capped');
});

test('the theme toggle cycles auto → light → dark and persists the choice', async t => {
  const dom = await shell(t);
  const root = dom.window.document.documentElement;
  const button = dom.query('.theme-toggle');
  assert.match(button.getAttribute('aria-label'), /Theme: Match system/);
  assert.equal(root.dataset.theme, undefined, 'auto leaves the attribute unset');

  await dom.click(button);
  assert.equal(root.dataset.theme, 'light');
  assert.equal(dom.window.localStorage.getItem('om-app:theme'), 'light');
  assert.match(dom.query('.theme-toggle').getAttribute('aria-label'), /Theme: Light/);

  await dom.click(dom.query('.theme-toggle'));
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(dom.window.localStorage.getItem('om-app:theme'), 'dark');

  await dom.click(dom.query('.theme-toggle'));
  assert.equal(root.dataset.theme, undefined, 'auto clears it again');
  assert.equal(dom.window.localStorage.getItem('om-app:theme'), null);

  assert.deepEqual(THEME_MODES, ['auto', 'light', 'dark']);
  assert.equal(nextThemeMode('dark'), 'auto', 'the cycle wraps');
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('light', true), 'light', 'an explicit choice ignores the OS');
});

test('recent puzzles survive a reload and reopen from both the sidebar and the welcome screen', async t => {
  const stored = mergeRecentPuzzle(
    [{id: 'P007', name: 'Stabilized Water', at: 1000}, {id: 'P012', name: 'Water Purification', at: 2000}],
    {id: 'P007', name: 'Stabilized Water'},
    3000,
  );
  assert.deepEqual(stored.map(entry => entry.id), ['P007', 'P012'], 'reopening moves a puzzle to the front');
  assert.deepEqual(parseRecentPuzzles(JSON.stringify(stored), 3000), stored);
  assert.deepEqual(parseRecentPuzzles('not json'), [], 'a corrupt entry degrades to an empty list');
  assert.deepEqual(parseRecentPuzzles(JSON.stringify([{id: 'P007'}])), [], 'partial entries are dropped');
  const future = parseRecentPuzzles(JSON.stringify([{id: 'P007', name: 'x', at: 9999}]), 3000);
  assert.deepEqual(future, [], 'entries dated in the future are ignored');
  assert.equal(mergeRecentPuzzle(
    Array.from({length: 8}, (_, i) => ({id: `P00${i}`, name: `n${i}`, at: i})),
    {id: 'P100', name: 'new'},
  ).length, 8, 'the list stays capped');

  const dom = await shell(t, {recent: [{id: 'P045', name: 'Reclaiming Water', at: 1000}]});
  const welcome = dom.all('.welcome-recent-item');
  assert.deepEqual(welcome.map(item => item.textContent), ['Reclaiming WaterP045']);
  await dom.click(welcome[0]);
  assert.deepEqual(dom.picks, ['P045']);
  assert.equal(dom.text('.puzzle-title'), 'Reclaiming Water');
});
