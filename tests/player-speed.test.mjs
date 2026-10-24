import test from 'node:test';
import assert from 'node:assert/strict';
import {act, createElement as h, useState} from 'react';
import {createDom} from './helpers/dom.mjs';
import {importTs} from './helpers/import-ts.mjs';
import {packet} from '../src/lib/player/protocol.js';

const {PlaybackSpeedControl} = await importTs(new URL('../src/components/pareto/PlaybackSpeedControl.tsx', import.meta.url));
const {GifViewer} = await importTs(new URL('../src/components/pareto/GifViewer.tsx', import.meta.url));
const {DEFAULT_PLAYBACK_SPEED, clampPlaybackSpeed, parsePlaybackSpeed, wheelPlaybackSpeed} = await importTs(new URL('../src/components/pareto/playbackSpeed.ts', import.meta.url));

async function controls(t, initial = 5) {
  const dom = createDom(t);
  const changes = [];
  function Harness({disabled = false}) {
    const [value, setValue] = useState(initial);
    return h(PlaybackSpeedControl, {value, disabled, onChange: next => { changes.push(next); setValue(next); }});
  }
  await dom.render(h(Harness));
  const range = dom.container.querySelector('input[type=range]');
  const number = dom.container.querySelector('input[type=number]');
  const input = (element, value) => act(async () => {
    element.value = String(value);
    element.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  });
  const wheel = async (deltaY, options = {}) => {
    const event = new dom.window.WheelEvent('wheel', {deltaY, bubbles: true, cancelable: true, ...options});
    // Happy DOM's WheelEvent currently omits the inherited modifier fields.
    Object.defineProperty(event, 'ctrlKey', {value: options.ctrlKey ?? false});
    await act(async () => range.dispatchEvent(event));
    return event;
  };
  const key = (element, key) => act(async () => {
    // React DOM was imported before this isolated DOM existed and selects
    // its legacy input-event fallback. Supply its focus listener shims.
    element.attachEvent = () => {};
    element.detachEvent = () => {};
    element.focus();
    element.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
  });
  return {...dom, range, number, input, wheel, key, changes, disable: () => dom.render(h(Harness, {disabled: true}))};
}

test('speed supports zero, fractional input and the full 0–30 range with default 5', () => {
  assert.equal(DEFAULT_PLAYBACK_SPEED, 5);
  for (const value of [0, 0.025, 5, 12.345, 30]) assert.equal(clampPlaybackSpeed(value), value);
  assert.equal(clampPlaybackSpeed(-1), 0);
  assert.equal(clampPlaybackSpeed(31), 30);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(clampPlaybackSpeed(value), 5);
  for (const value of ['', ' ', 'bad', '-', 'Infinity']) assert.equal(parsePlaybackSpeed(value), null);
  assert.equal(parsePlaybackSpeed('0'), 0);
  assert.equal(parsePlaybackSpeed('5.125'), 5.125);
});

test('each wheel event changes speed by exactly 0.1 independent of delta magnitude', () => {
  for (const delta of [1, 100, 1000]) {
    assert.equal(wheelPlaybackSpeed(5, delta), 4.9);
    assert.equal(wheelPlaybackSpeed(5, -delta), 5.1);
  }
  let speed = 5;
  for (let i = 0; i < 10; i++) speed = wheelPlaybackSpeed(speed, -1);
  assert.equal(speed, 6);
  assert.equal(wheelPlaybackSpeed(0, 1), 0);
  assert.equal(wheelPlaybackSpeed(30, -1), 30);
  assert.equal(wheelPlaybackSpeed(5.125, -1), 5.225);
  assert.equal(wheelPlaybackSpeed(5, 0), 5);
});

test('slider shows decorative ticks every five cycles without restricting fractional values', async t => {
  const dom = await controls(t);
  const ticks = dom.container.querySelector('.solution-player-speed-ticks');
  assert.equal(ticks.getAttribute('aria-hidden'), 'true');
  assert.deepEqual([...ticks.children].map(tick => Number(tick.dataset.value)), [0, 5, 10, 15, 20, 25, 30]);
  assert.equal(ticks.querySelectorAll('input, button, [tabindex]').length, 0);
  assert.equal(dom.range.step, 'any');
  await dom.wheel(-1);
  assert.equal(dom.range.value, '5.1');
});

test('slider snaps to integers while wheel and direct input keep fractional speeds', async t => {
  const dom = await controls(t);
  assert.equal(dom.range.value, '5');
  assert.equal(dom.number.value, '5');
  assert.equal(dom.range.min, '0');
  assert.equal(dom.range.max, '30');
  assert.equal(dom.range.step, 'any', 'fractional values must be representable on the thumb');
  await dom.input(dom.range, 7.6);
  assert.equal(dom.range.value, '8');
  assert.equal(dom.number.value, '8');
  assert.equal((await dom.wheel(-300)).defaultPrevented, true);
  assert.equal(dom.range.value, '8.1');
  assert.equal(dom.number.value, '8.1');
  await dom.input(dom.number, 5.125);
  assert.equal(dom.range.value, '5.125');
  assert.equal(dom.range.getAttribute('aria-valuetext'), '5.125 cycles/s');
  await dom.input(dom.number, 0);
  assert.equal(dom.range.value, '0');
  assert.equal(dom.changes.at(-1), 0);
});

test('rapid wheel events accumulate and do not scroll; disabled and zoom gestures pass through', async t => {
  const dom = await controls(t);
  await act(async () => {
    for (let i = 0; i < 10; i++) dom.number.dispatchEvent(new dom.window.WheelEvent('wheel', {deltaY: -1, bubbles: true, cancelable: true}));
  });
  assert.equal(dom.number.value, '6');
  assert.equal(dom.changes.at(-1), 6);
  assert.equal((await dom.wheel(-1, {ctrlKey: true})).defaultPrevented, false);
  assert.equal((await dom.wheel(0, {deltaX: 1})).defaultPrevented, false);
  await dom.disable();
  assert.equal(dom.range.disabled, true);
  assert.equal(dom.number.disabled, true);
  assert.equal((await dom.wheel(-1)).defaultPrevented, false);
  assert.equal(dom.changes.length, 10);
});

test('numeric drafts allow blank input and clamp invalid ranges on commit without sending NaN', async t => {
  const dom = await controls(t);
  await dom.input(dom.number, '');
  assert.equal(dom.changes.length, 0);
  assert.equal(dom.number.value, '');
  await dom.key(dom.number, 'Enter');
  assert.equal(dom.number.value, '5');
  await dom.input(dom.number, 45);
  assert.equal(dom.changes.length, 0);
  await dom.key(dom.number, 'Enter');
  assert.equal(dom.number.value, '30');
  await dom.input(dom.number, -5);
  await act(async () => dom.number.blur());
  assert.equal(dom.number.value, '0');
  await dom.input(dom.number, '');
  await dom.key(dom.number, 'Escape');
  assert.equal(dom.number.value, '0');
  assert.deepEqual(dom.changes, [30, 0]);
});

test('slider keyboard controls snap to integers and respect endpoints', async t => {
  const dom = await controls(t, 5.2);
  await dom.key(dom.range, 'ArrowRight');
  assert.equal(dom.range.value, '6');
  await dom.key(dom.range, 'ArrowLeft');
  assert.equal(dom.range.value, '5');
  await dom.key(dom.range, 'Home');
  assert.equal(dom.range.value, '0');
  await dom.key(dom.range, 'ArrowDown');
  assert.equal(dom.range.value, '0');
  await dom.key(dom.range, 'End');
  assert.equal(dom.range.value, '30');
  await dom.key(dom.range, 'ArrowUp');
  assert.equal(dom.range.value, '30');
});

async function liveViewer(t) {
  const dom = createDom(t);
  const posts = [];
  let state = {ready: true, busy: false, playing: false, cycle: 0, fraction: 0, stepping: 0, speed: 19,
    gpu: 'ready', victoryCycle: 100, analysisStatus: 'complete', collision: null, error: null};
  const frameWindow = {
    location: {href: 'https://player.test/player/'},
    postMessage(message) {
      posts.push(message);
      if (message.type === 'speed') state = {...state, speed: message.payload.speed};
      if (message.type === 'play') state = {...state, playing: true};
      if (message.type === 'pause') state = {...state, playing: false};
      if (message.type === 'seek') state = {...state, cycle: message.payload.cycle};
      if (message.type === 'load') state = {...state, cycle: 0, playing: message.payload.autoplay};
      const type = message.type === 'init' ? 'ready' : message.type === 'load' ? 'loaded' : 'ack';
      const payload = type === 'ready' ? {capabilities: []} : {state: {...state}};
      queueMicrotask(() => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        source: frameWindow, origin: 'https://player.test', data: packet(type, message.requestId, message.session, payload),
      })));
    },
  };
  t.mock.getter(dom.window.HTMLIFrameElement.prototype, 'contentWindow', () => frameWindow);
  t.mock.method(globalThis, 'fetch', async url => new Response(String(url)));
  let props = {open: true, url: null, title: 'A', solutionUrl: '/a.solution', puzzleId: 'P1', puzzleName: 'Puzzle', playerUrl: 'https://player.test/player/', onClose() {}};
  const render = async changes => { props = {...props, ...changes}; await dom.render(h(GifViewer, props)); };
  await render({});
  const frame = dom.container.querySelector('iframe');
  await act(async () => frame.dispatchEvent(new dom.window.Event('load')));
  const input = async value => act(async () => {
    const number = dom.container.querySelector('input[type=number]');
    number.value = String(value);
    number.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  });
  return {...dom, posts, frame, render, input};
}

test('the persistent player resets actual speed to 5 before autoplay on every open and record change', async t => {
  const dom = await liveViewer(t);
  const number = () => dom.container.querySelector('input[type=number]');
  assert.equal(number().disabled, false);
  assert.equal(number().value, '5');
  assert.deepEqual(dom.posts.slice(1).map(p => p.type), ['load', 'speed', 'play']);
  assert.equal(dom.posts.find(p => p.type === 'load').payload.autoplay, false);
  assert.equal(dom.posts.find(p => p.type === 'speed').payload.speed, 5);
  await dom.input(5.125);
  assert.equal(dom.posts.at(-1).payload.speed, 5.125);
  await dom.input(0);
  assert.equal(dom.posts.at(-1).payload.speed, 0);
  await dom.render({open: false});
  const start = dom.posts.length;
  await dom.render({open: true});
  assert.equal(number().value, '5');
  assert.deepEqual(dom.posts.slice(start).map(p => p.type), ['seek', 'speed', 'play']);
  assert.equal(dom.posts.slice(start)[1].payload.speed, 5);
  assert.equal(dom.container.querySelector('iframe'), dom.frame, 'reset speed without destroying the warm iframe');
  await dom.input(30);
  const next = dom.posts.length;
  await dom.render({solutionUrl: '/b.solution', title: 'B'});
  assert.equal(number().value, '5');
  assert.deepEqual(dom.posts.slice(next).map(p => p.type), ['load', 'speed', 'play']);
  assert.equal(dom.posts.slice(next)[1].payload.speed, 5);
});
