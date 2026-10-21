import test from 'node:test';
import assert from 'node:assert/strict';
import {act, createElement as h, Fragment, useRef} from 'react';
import {createDom} from './helpers/dom.mjs';
import {importTs} from './helpers/import-ts.mjs';

const {useEscapeKey} = await importTs(new URL('../src/components/pareto/useEscapeKey.ts', import.meta.url));
const {GifViewer} = await importTs(new URL('../src/components/pareto/GifViewer.tsx', import.meta.url));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

async function viewer(t, initial = {}) {
  const dom = createDom(t);
  let props = {open: true, url: null, title: 'A', solutionUrl: '/a.solution', puzzleId: null, puzzleName: 'Puzzle', onClose() {}, ...initial};
  const render = async changes => {
    props = {...props, ...changes};
    await dom.render(h(GifViewer, props));
  };
  const button = label => [...dom.container.querySelectorAll('button')].find(node => node.textContent === label);
  await render({});
  return {...dom, render, button, unmount: () => dom.render(null), click: label => act(async () => {
    const node = button(label);
    assert.ok(node, `missing button: ${label}`);
    assert.equal(node.disabled, false, `${label} must be available`);
    node.click();
  })};
}

function Layer({open = true, onClose}) {
  const ref = useRef(null);
  useEscapeKey(ref, onClose, open);
  return h('div', {ref, className: 'gif-viewer-backdrop', hidden: !open});
}

test('a hidden persistent player does not block Escape in the overlap dialog', async t => {
  const dom = createDom(t);
  let overlapCloses = 0, playerCloses = 0;
  const render = open => dom.render(h(Fragment, null,
    h(Layer, {onClose: () => overlapCloses++}),
    h(Layer, {open, onClose: () => playerCloses++}),
  ));
  await render(true);
  await dom.escape();
  assert.equal(playerCloses, 1, 'only the top visible dialog closes');
  assert.equal(overlapCloses, 0);
  await render(false);
  await dom.escape();
  assert.equal(overlapCloses, 1, 'the retained hidden iframe backdrop is not a modal layer');
  assert.equal(playerCloses, 1, 'the hidden viewer has no active Escape handler');
});

for (const outcome of ['resolve', 'reject']) {
  test(`switching records aborts Download and ignores a late ${outcome} without disturbing the new action`, async t => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', (url, options) => {
      const request = {...deferred(), url, signal: options.signal};
      requests.push(request);
      return request.promise; // Deliberately allow completion after abort.
    });
    const createUrl = t.mock.method(URL, 'createObjectURL', () => 'blob:unused');
    const dom = await viewer(t);
    await dom.click('Download');
    assert.equal(requests.length, 1);
    await dom.render({solutionUrl: '/b.solution', title: 'B'});
    assert.equal(requests[0].signal.aborted, true, 'changing the source must abort the old download');
    assert.equal(dom.button('Download').disabled, false);
    await dom.click('Download');
    assert.equal(requests[1].url, '/b.solution');
    await act(async () => {
      if (outcome === 'resolve') requests[0].resolve(new Response('solution A'));
      else requests[0].reject(new Error('stale download failed'));
    });
    assert.equal(createUrl.mock.callCount(), 0, 'old bytes cannot trigger a download');
    assert.equal(dom.button('Downloading…').disabled, true, 'the old finalizer cannot clear B pending');
    assert.equal(dom.container.querySelector('.solution-player-status--error'), null);
    await dom.render({open: false});
    assert.equal(requests[1].signal.aborted, true, 'closing cancels the current action too');
    await act(async () => requests[1].resolve(new Response('solution B')));
    assert.equal(createUrl.mock.callCount(), 0);
  });
}

test('switching records cancels Preview, ignores the old popup and keeps the same iframe', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/config') return new Response('', {status: 503}); // No GPU/network in DOM tests.
    return new Response(String(url));
  });
  const dom = await viewer(t, {puzzleId: 'P1'});
  const frame = dom.container.querySelector('iframe');
  const popups = [];
  t.mock.method(dom.window, 'open', () => {
    const child = {closed: false, postMessage: t.mock.fn()};
    popups.push(child);
    return child;
  });
  const hello = child => act(async () => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
    source: child, origin: 'https://ssk97.github.io', data: 'Hello',
  })));
  await dom.click('Preview');
  await dom.render({puzzleId: 'P2', solutionUrl: '/b.solution', title: 'B'});
  assert.equal(dom.container.querySelector('iframe'), frame, 'only actions reset, not the player element');
  assert.ok(dom.button('Preview'), 'B must not inherit A pending state');
  await dom.click('Preview');
  await hello(popups[0]);
  assert.equal(popups[0].postMessage.mock.callCount(), 0, 'A must not be sent after switching records');
  assert.equal(dom.button('Loading viewer…').disabled, true, 'B still waits for its own popup');
  await hello(popups[1]);
  const [message, origin] = popups[1].postMessage.mock.calls[0].arguments;
  assert.equal(origin, 'https://ssk97.github.io');
  assert.equal(new TextDecoder().decode(message.solution), '/b.solution');
  assert.equal(new TextDecoder().decode(message.puzzle), '/puzzles/P2.puzzle');
  assert.equal(dom.button('Preview').disabled, false);
});

for (const boundary of ['puzzle', 'local file', 'close', 'unmount']) {
  test(`Preview is also cancelled on ${boundary} changes without sending stale bytes`, async t => {
    t.mock.method(globalThis, 'fetch', async url => url === '/api/config'
      ? new Response('', {status: 503}) : new Response(String(url)));
    const initial = {puzzleId: 'P1'};
    if (boundary === 'local file') {
      const {saveUserSolutionFile, clearUserSolutionFiles} = await importTs(new URL('../src/lib/userSolutionFiles.ts', import.meta.url));
      // Node has no IndexedDB: these are isolated, in-memory fixtures only.
      await saveUserSolutionFile('review-local-a', new Blob(['local A']));
      await saveUserSolutionFile('review-local-b', new Blob(['local B']));
      t.after(clearUserSolutionFiles);
      initial.solutionKey = 'review-local-a';
    }
    const dom = await viewer(t, initial);
    const child = {closed: false, postMessage: t.mock.fn()};
    t.mock.method(dom.window, 'open', () => child);
    await dom.click('Preview');
    if (boundary === 'puzzle') await dom.render({puzzleId: 'P2'});
    else if (boundary === 'local file') await dom.render({solutionKey: 'review-local-b'});
    else if (boundary === 'close') await dom.render({open: false});
    else await dom.unmount();
    await act(async () => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: child, origin: 'https://ssk97.github.io', data: 'Hello',
    })));
    assert.equal(child.postMessage.mock.callCount(), 0);
    if (boundary !== 'unmount') assert.equal(dom.button('Preview').disabled, false);
  });
}

const SHA = 'b01e618e46fb9721c467d7979a74ed82328abd71';
const solutionUrl = `https://zlbb.faendir.com/l/om/${SHA}/P253/110g-20i-204c-41a-8h-TL`;
const author = {name: 'Author', url: `https://github.com/zachtronics-leaderboards/om-leaderboard/commit/${SHA}`};

test('reopening the same record retries a failed author request', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? new Response('', {status: 503}) : Response.json({author}));
  const dom = await viewer(t, {solutionUrl});
  assert.equal(dom.container.querySelector('.gif-viewer-author'), null);
  await dom.render({open: false});
  await dom.render({open: true});
  assert.equal(requests, 2);
  assert.equal(dom.container.querySelector('.gif-viewer-author a')?.textContent, 'Author');
});

for (const result of [author, null]) {
  test(`reopening reuses the confirmed ${result ? 'author' : 'unknown author'} without another request`, async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({author: result}));
    const dom = await viewer(t, {solutionUrl});
    await dom.render({open: false});
    await dom.render({open: true});
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(dom.container.querySelector('.gif-viewer-author a')?.textContent ?? null, result?.name ?? null);
  });
}

test('closing cancels pending attribution; its late response cannot replace the retried author', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    const request = {...deferred(), signal: options.signal};
    requests.push(request);
    return request.promise;
  });
  const dom = await viewer(t, {solutionUrl});
  await dom.render({open: false});
  assert.equal(requests[0].signal.aborted, true);
  await dom.render({open: true});
  assert.equal(requests.length, 2);
  await act(async () => requests[1].resolve(Response.json({author})));
  await act(async () => requests[0].resolve(Response.json({author: {...author, name: 'Stale author'}})));
  assert.equal(dom.container.querySelector('.gif-viewer-author a')?.textContent, 'Author');
  await dom.render({open: false});
  await dom.render({open: true});
  assert.equal(requests.length, 2, 'the successful retry is cached');
});

test('a hidden viewer makes no author request and local solutions never show remote attribution', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({author}));
  const dom = await viewer(t, {solutionUrl, open: false});
  assert.equal(fetch.mock.callCount(), 0);
  await dom.render({open: true});
  assert.equal(dom.container.querySelector('.gif-viewer-author a')?.textContent, 'Author');
  await dom.render({solutionKey: 'local-file'});
  assert.equal(dom.container.querySelector('.gif-viewer-author'), null);
  await dom.render({open: false});
  await dom.render({open: true});
  assert.equal(fetch.mock.callCount(), 1);
});
