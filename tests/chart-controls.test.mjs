import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {initialControlsPanel, controlsPanelReducer: reduce, needsControlsOverlay} = await importTs(new URL('../src/components/pareto/controlsPanel.ts', import.meta.url));
const wide = (state) => reduce(state, {type: 'resize', compact: false});
const narrow = (state) => reduce(state, {type: 'resize', compact: true});
const toggle = (state) => reduce(state, {type: 'toggle'});

test('chart settings default to open on desktop and closed on narrow workspaces', () => {
  const initial = initialControlsPanel('false');
  assert.deepEqual(initial, {compact: true, desktopCollapsed: false, overlayOpen: false});
  assert.equal(wide(initial).desktopCollapsed, false);
  assert.equal(narrow(initial).overlayOpen, false);
  assert.equal(initialControlsPanel('invalid').desktopCollapsed, false);
});

test('desktop collapse preference survives narrow overlay interactions and resizing', () => {
  let state = toggle(wide(initialControlsPanel('false')));
  assert.equal(state.desktopCollapsed, true);
  state = narrow(state);
  assert.equal(state.overlayOpen, false);
  state = toggle(state);
  assert.equal(state.overlayOpen, true);
  assert.equal(state.desktopCollapsed, true);
  state = reduce(state, {type: 'close'});
  assert.equal(state.overlayOpen, false);
  assert.equal(wide(state).desktopCollapsed, true);
  assert.equal(initialControlsPanel(String(state.desktopCollapsed)).desktopCollapsed, true);
});

test('an open narrow overlay is dismissed when changing layout, without collapsing the desktop panel', () => {
  const state = toggle(initialControlsPanel('false'));
  assert.equal(state.overlayOpen, true);
  const desktop = wide(state);
  assert.equal(desktop.overlayOpen, false);
  assert.equal(desktop.desktopCollapsed, false);
  assert.equal(narrow(desktop).overlayOpen, false);
});

test('same-layout resize observations do not close a user-opened overlay', () => {
  const state = toggle(initialControlsPanel('false'));
  assert.equal(narrow(state), state);
  assert.equal(narrow(state).overlayOpen, true);
});

test('desktop Close collapses the panel and a subsequent toggle expands it', () => {
  let state = reduce(wide(initialControlsPanel('false')), {type: 'close'});
  assert.equal(state.desktopCollapsed, true);
  state = toggle(state);
  assert.equal(state.desktopCollapsed, false);
});

test('responsive mode uses the chart workspace width and reserves room for the optional user list', () => {
  assert.equal(needsControlsOverlay(859, false), true);
  assert.equal(needsControlsOverlay(860, false), false);
  assert.equal(needsControlsOverlay(1000, false), false);
  assert.equal(needsControlsOverlay(1000, true), true);
  assert.equal(needsControlsOverlay(1069, true), true);
  assert.equal(needsControlsOverlay(1070, true), false);
});
