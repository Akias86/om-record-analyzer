import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {act, createElement as h} from 'react';
import {createDom} from './helpers/dom.mjs';
import {importTs} from './helpers/import-ts.mjs';
import {packet} from '../src/lib/player/protocol.js';

const {GifViewer} = await importTs(new URL('../src/components/pareto/GifViewer.tsx', import.meta.url));
const styles = await Promise.all(['../src/components/ParetoChart.css', '../src/components/pareto/GifViewer.css']
  .map(path => readFile(new URL(path, import.meta.url), 'utf8')));

async function viewer(t, {solutionResponse, ...initial} = {}) {
  const dom = createDom(t);
  // Happy DOM has no layout engine. Model the same chrome in both modes so
  // these tests can exercise the shared viewport-fitting hook on resize/zoom.
  const viewport = {width: 1440, height: 1000};
  t.mock.getter(dom.window.HTMLElement.prototype, 'clientWidth', function () {
    return this.classList.contains('solution-player-backdrop') ? viewport.width : 0;
  });
  t.mock.getter(dom.window.HTMLElement.prototype, 'clientHeight', function () {
    return this.classList.contains('solution-player-backdrop') ? viewport.height : 0;
  });
  const bounds = dom.window.HTMLElement.prototype.getBoundingClientRect;
  t.mock.method(dom.window.HTMLElement.prototype, 'getBoundingClientRect', function () {
    if (this.classList.contains('gif-viewer-header')) return {height: 40};
    if (this.classList.contains('gif-viewer-footer')) return {height: 80};
    return bounds.call(this);
  });
  const observers = new Set();
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() {}
    disconnect() { observers.delete(this); }
  };
  const style = dom.window.document.createElement('style');
  // Isolated DOM tests do not load the app's theme variables.
  style.textContent = `${styles.join('\n')}\n.gif-viewer-panel { border: 1px solid black; }`;
  dom.window.document.head.append(style);
  const posts = [];
  let state = {ready: true, busy: false, playing: false, cycle: 0, fraction: 0, stepping: 0,
    speed: 5, gpu: 'ready', victoryCycle: 100, analysisStatus: 'complete', collision: null, error: null};
  const frameWindow = {
    location: {href: 'https://player.test/'},
    postMessage(message) {
      posts.push(message);
      if (message.type === 'load') state = {...state, cycle: 0, playing: message.payload.autoplay};
      if (message.type === 'speed') state = {...state, speed: message.payload.speed};
      if (message.type === 'seek') state = {...state, cycle: message.payload.cycle};
      if (message.type === 'play') state = {...state, playing: true};
      if (message.type === 'pause') state = {...state, playing: false};
      const type = message.type === 'init' ? 'ready' : message.type === 'load' ? 'loaded' : 'ack';
      const payload = type === 'ready' ? {capabilities: []} : {state: {...state}};
      queueMicrotask(() => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        source: frameWindow, origin: 'https://player.test', data: packet(type, message.requestId, message.session, payload),
      })));
    },
  };
  t.mock.getter(dom.window.HTMLIFrameElement.prototype, 'contentWindow', () => frameWindow);
  t.mock.method(globalThis, 'fetch', async url => url === '/a.solution' && solutionResponse
    ? solutionResponse : new Response(String(url)));
  let props = {open: true, url: '/record.gif', title: 'A', solutionUrl: '/a.solution', puzzleId: 'P1',
    puzzleName: 'Puzzle', playerUrl: 'https://player.test/', onClose() {}, ...initial};
  const render = async changes => {
    props = {...props, ...changes};
    await dom.render(h(GifViewer, props));
  };
  await render({});
  const frame = dom.container.querySelector('iframe');
  await act(async () => frame.dispatchEvent(new dom.window.Event('load')));
  const toggle = () => dom.container.querySelector('.solution-player-mode-toggle');
  return {...dom, posts, frame, render, toggle, state: () => state,
    resize: changes => act(async () => {
      Object.assign(viewport, changes);
      for (const observer of observers) observer.callback();
      await new Promise(resolve => dom.window.requestAnimationFrame(resolve));
    }),
    switchMode: () => act(async () => {
      assert.ok(toggle(), 'both replay formats must be available');
      toggle().click();
    }),
  };
}

for (const [url, tag] of [['/record.gif', 'IMG'], ['/record.webm?replay=1', 'VIDEO']]) {
  test(`${tag} switches through an icon-only button and fills the shared 826:647 frame`, async t => {
    const dom = await viewer(t, {url});
    assert.equal(dom.toggle().textContent, '');
    assert.equal(dom.toggle().querySelectorAll('svg').length, 1);
    assert.equal(dom.toggle().getAttribute('aria-label'), 'Switch to GIF / video');
    assert.equal(dom.toggle().getAttribute('aria-pressed'), 'false');
    await dom.switchMode();
    assert.equal(dom.toggle().textContent, '');
    assert.equal(dom.toggle().getAttribute('aria-label'), 'Switch to real-time playback');
    assert.equal(dom.toggle().getAttribute('aria-pressed'), 'true');
    assert.equal(dom.frame.hidden, true);
    assert.equal(dom.state().playing, false);
    assert.equal(dom.posts.at(-1).type, 'pause');
    assert.equal(dom.container.querySelector('input[type=number]').disabled, true);
    const media = dom.container.querySelector('.gif-viewer-img');
    assert.equal(media.tagName, tag);
    assert.equal(media.getAttribute('width'), '826');
    assert.equal(media.getAttribute('height'), '647');
    const mediaStyle = dom.window.getComputedStyle(media);
    const frameStyle = dom.window.getComputedStyle(dom.frame);
    for (const property of ['position', 'top', 'right', 'bottom', 'left', 'width', 'height']) {
      assert.equal(mediaStyle[property], frameStyle[property], `${property} must match the real-time frame`);
    }
    assert.equal(mediaStyle.width, '100%');
    assert.equal(mediaStyle.height, '100%');
    assert.equal(mediaStyle.objectFit, 'fill');
    const bodyStyle = dom.window.getComputedStyle(dom.container.querySelector('.solution-player-body'));
    assert.equal(bodyStyle.width, '100%');
    assert.equal(bodyStyle.aspectRatio, '826 / 647');
    const panel = dom.container.querySelector('.solution-player-panel');
    assert.equal(panel.style.width, '828px');
    assert.equal(dom.window.getComputedStyle(panel).maxWidth, '100%');
    if (tag === 'VIDEO') {
      assert.equal(media.autoplay, true);
      assert.equal(media.loop, true);
      assert.equal(media.muted, true);
    }
    await dom.switchMode();
    assert.equal(dom.container.querySelector('.gif-viewer-img'), null);
    assert.equal(dom.container.querySelector('iframe'), dom.frame, 'the warm iframe is never replaced');
    assert.equal(dom.frame.hidden, false);
    assert.equal(dom.state().playing, true);
    assert.equal(dom.posts.filter(message => message.type === 'load').length, 1);
  });
}

for (const url of ['/record.gif', '/record.mp4']) {
  test(`${url} uses the same viewport fitting and resize rounding as real-time playback`, async t => {
    const dom = await viewer(t, {url});
    const panel = dom.container.querySelector('.solution-player-panel');
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      // Browser zoom changes the CSS viewport while keeping the screen size.
      const width = Math.floor(1366 / zoom), height = Math.floor(768 / zoom);
      await dom.resize({width, height});
      const expected = Math.floor(Math.max(0, Math.min(826, width - 50, (height - 170) * 826 / 647))) + 2;
      assert.equal(panel.style.width, `${expected}px`);
      await dom.switchMode();
      await dom.resize({width, height});
      assert.equal(panel.style.width, `${expected}px`, `same fitting at zoom ${zoom}`);
      assert.equal(dom.container.querySelector('.gif-viewer-img').style.width, '', 'no recording-only inline size');
      await dom.switchMode();
      assert.equal(dom.container.querySelector('iframe'), dom.frame);
    }
  });
}

test('the status line occupies a shared footer row so both modes place it at the same height', async t => {
  const dom = await viewer(t);
  const footer = dom.container.querySelector('.gif-viewer-footer');
  const live = footer.querySelector('.solution-player-footer-layout--live');
  const recorded = footer.querySelector('.solution-player-footer-layout--recorded');
  const controls = live;
  const items = [...live.children];
  const speed = live.querySelector('input[type=number]');
  const statuses = footer.querySelectorAll('.solution-player-status');
  assert.equal(statuses.length, 1, 'the status must not be duplicated per mode');
  const status = statuses[0];
  assert.equal(status.parentElement, footer);
  const footerStyle = dom.window.getComputedStyle(footer);
  assert.equal(footerStyle.display, 'grid');
  assert.equal(footerStyle.gap, '8px');
  assert.equal(dom.window.getComputedStyle(live).gridArea, dom.window.getComputedStyle(recorded).gridArea);
  assert.equal(dom.window.getComputedStyle(status).gridArea, '2 / 1');
  await dom.switchMode();
  assert.deepEqual([...live.children], items, 'mode switches must preserve the flex items that determine footer height');
  assert.equal(live.getAttribute('aria-hidden'), 'true');
  assert.equal(live.hasAttribute('inert'), true);
  assert.equal(recorded.getAttribute('aria-hidden'), 'false');
  assert.equal(recorded.hasAttribute('inert'), false);
  assert.notEqual(dom.window.getComputedStyle(recorded).visibility, 'hidden');
  assert.deepEqual([...recorded.children].map(node => node.textContent), ['Download', 'Preview']);
  for (const button of live.querySelectorAll('button')) assert.equal(button.disabled, true);
  for (const button of recorded.querySelectorAll('button')) assert.equal(button.disabled, false);
  for (const item of items) assert.equal(dom.window.getComputedStyle(item).visibility, 'hidden');
  for (const input of controls.querySelectorAll('input, button')) assert.equal(input.disabled, true);
  const paused = dom.posts.length;
  await act(async () => items[0].click());
  assert.equal(dom.posts.length, paused, 'hidden cycle controls must not send commands');
  const statusStyle = dom.window.getComputedStyle(status);
  assert.equal(statusStyle.whiteSpace, 'nowrap', 'mode-specific status text cannot introduce a new footer line');
  assert.equal(statusStyle.textOverflow, 'ellipsis');
  assert.equal(status.title, status.textContent, 'the full clipped status remains available in a tooltip');
  await dom.switchMode();
  assert.equal(live.getAttribute('aria-hidden'), 'false');
  assert.equal(live.hasAttribute('inert'), false);
  assert.equal(recorded.getAttribute('aria-hidden'), 'true');
  assert.equal(recorded.hasAttribute('inert'), true);
  for (const button of recorded.querySelectorAll('button')) assert.equal(button.disabled, true);
  assert.equal(live.querySelector('input[type=number]'), speed);
  assert.equal(speed.disabled, false);
  for (const item of items) assert.notEqual(dom.window.getComputedStyle(item).visibility, 'hidden');
});

test('recorded Preview remains usable and its hidden live counterpart cannot open a popup', async t => {
  const dom = await viewer(t);
  const open = t.mock.method(dom.window, 'open', () => null);
  await dom.switchMode();
  const active = dom.container.querySelector('.solution-player-footer-layout--recorded');
  const inactive = dom.container.querySelector('.solution-player-footer-layout--live');
  const preview = layout => [...layout.querySelectorAll('button')].find(button => button.textContent === 'Preview');
  await act(async () => preview(active).click());
  assert.equal(open.mock.callCount(), 1);
  assert.match(dom.container.querySelector('.solution-player-status').textContent, /Could not open/);
  await act(async () => preview(inactive).click());
  assert.equal(open.mock.callCount(), 1);
});

test('switching modes preserves speed and an explicitly paused simulator', async t => {
  const dom = await viewer(t);
  await act(async () => {
    const speed = dom.container.querySelector('input[type=number]');
    speed.value = '1.25';
    speed.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  });
  await act(async () => [...dom.container.querySelectorAll('button')].find(button => button.textContent === 'Pause').click());
  const start = dom.posts.length;
  await dom.switchMode();
  await dom.switchMode();
  assert.equal(dom.state().playing, false);
  assert.equal(dom.state().speed, 1.25);
  assert.equal(dom.container.querySelector('input[type=number]').value, '1.25');
  assert.deepEqual(dom.posts.slice(start).map(message => message.type), ['pause']);
});

test('selecting a recording during loading prevents late hidden autoplay', async t => {
  let finish;
  const solutionResponse = new Promise(resolve => { finish = resolve; });
  const dom = await viewer(t, {solutionResponse});
  await dom.switchMode();
  await act(async () => finish(new Response('solution bytes')));
  assert.equal(dom.frame.hidden, true);
  assert.equal(dom.state().playing, false);
  assert.equal(dom.posts.some(message => message.type === 'play'), false);
  await dom.switchMode();
  assert.equal(dom.state().playing, true);
  assert.equal(dom.posts.at(-1).type, 'play');
});

test('a new record or reopening restores real-time mode; closing removes recorded media', async t => {
  const dom = await viewer(t, {url: '/record.mp4'});
  await dom.switchMode();
  await dom.render({open: false});
  assert.equal(dom.container.querySelector('video'), null, 'hidden videos must not keep playing');
  await dom.render({open: true});
  assert.equal(dom.frame.hidden, false);
  assert.equal(dom.toggle().getAttribute('aria-pressed'), 'false');
  await dom.switchMode();
  await dom.render({url: '/b.gif', solutionUrl: '/b.solution', title: 'B'});
  assert.equal(dom.container.querySelector('.gif-viewer-img'), null);
  assert.equal(dom.frame.hidden, false);
  assert.equal(dom.toggle().getAttribute('aria-pressed'), 'false');
  assert.equal(dom.container.querySelector('iframe'), dom.frame);
});

test('records without a recording do not offer the mode toggle', async t => {
  const dom = await viewer(t, {url: null});
  assert.equal(dom.toggle(), null);
  assert.equal(dom.frame.hidden, false);
});

test('recording-only records use the shared reference frame without an unavailable real-time toggle', async t => {
  const dom = await viewer(t, {solutionUrl: null});
  assert.equal(dom.toggle(), null);
  assert.equal(dom.frame.hidden, true);
  assert.equal(dom.container.querySelector('.gif-viewer-img').width, 826);
  assert.equal(dom.container.querySelector('.gif-viewer-img').height, 647);
});
