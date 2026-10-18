import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerClient} from '../src/lib/player/client.js';
import {CHANNEL, VERSION, copyBytes, exactOrigin, isPacket, packet} from '../src/lib/player/protocol.js';

class Surface {
  listeners = new Map();
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) { for (const listener of [...this.listeners.get(type) || []]) listener(event); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const host = new Surface(); host.location = {href: 'https://host.example/records', origin: 'https://host.example'};
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {configurable: true, value: host});
  const iframe = new Surface(), posts = [], errors = [], states = [];
  iframe.contentWindow = {postMessage: (...args) => posts.push(args)};
  iframe.removeAttribute = name => { delete iframe[name]; };
  const client = createPlayerClient(iframe, {url: 'https://player.example/viewer/index.html', onError: error => errors.push(error), onState: state => states.push(state), ...options});
  const session = new URLSearchParams(new URL(iframe.src).hash.slice(1)).get('session');
  const receive = (type, requestId, payload = {}, extra = {}) => host.emit('message', {source: iframe.contentWindow, origin: 'https://player.example', data: packet(type, requestId, session, payload), ...extra});
  async function connect() {
    iframe.emit('load'); const init = posts.at(-1)[0];
    receive('ready', init.requestId, {capabilities: ['recording']}); await client.ready;
  }
  function cleanup() { client.dispose(); if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; }
  return {host, iframe, client, posts, session, receive, connect, cleanup, errors, states};
}

test('protocol accepts only explicit version/session envelopes and exact HTTP(S) origins', () => {
  const valid = packet('load', 'request-1', 'session-1');
  assert.equal(valid.channel, CHANNEL); assert.equal(valid.version, VERSION);
  assert.ok(isPacket(valid, 'session-1'));
  assert.ok(!isPacket({...valid, version: 2}, 'session-1'));
  assert.ok(!isPacket(valid, 'other'));
  assert.ok(!isPacket({...valid, requestId: ''}, 'session-1'));
  assert.equal(exactOrigin('https://host.example:8443'), 'https://host.example:8443');
  for (const origin of ['*', 'null', 'file:///C:/test', 'https://host.example/path', 'https://host.example/']) assert.throws(() => exactOrigin(origin));
});

test('copyBytes copies only the view range and leaves caller buffers intact', () => {
  const original = new Uint8Array([8, 1, 2, 9]);
  const copied = copyBytes(original.subarray(1, 3)); copied[0] = 7;
  assert.deepEqual([...original], [8, 1, 2, 9]); assert.deepEqual([...copied], [7, 2]);
  assert.notEqual(copied.buffer, original.buffer);
});

test('handshake checks origin, source, request ID and uses an exact target origin', async () => {
  const f = fixture();
  try {
    assert.equal(new URLSearchParams(new URL(f.iframe.src).hash.slice(1)).get('parentOrigin'), 'https://host.example');
    f.iframe.emit('load'); const init = f.posts.at(-1)[0]; let resolved = false;
    f.client.ready.then(() => { resolved = true; });
    f.receive('ready', init.requestId, {}, {origin: 'https://attacker.example'});
    f.receive('ready', init.requestId, {}, {source: {}});
    f.receive('ready', 'unknown', {}); await flush(); assert.equal(resolved, false);
    f.receive('ready', init.requestId, {capabilities: []}); await f.client.ready;
    assert.ok(f.posts.every(([, origin]) => origin === 'https://player.example'));
  } finally { f.cleanup(); }
});

test('load copies before transfer and correlates only the matching loaded result', async () => {
  const f = fixture();
  try {
    await f.connect(); const puzzle = new Uint8Array([1, 2]), solution = new Uint8Array([3, 4]);
    const result = f.client.load({puzzle: {name: 'a.puzzle', bytes: puzzle}, solution: {name: 'a.solution', bytes: solution}, title: 'Title'});
    await flush(); const [message, , transfer] = f.posts.at(-1);
    assert.equal(message.type, 'load'); assert.notEqual(transfer[0], puzzle.buffer); assert.notEqual(transfer[1], solution.buffer);
    assert.deepEqual([...puzzle], [1, 2]); assert.equal(message.payload.title, 'Title');
    f.receive('loaded', 'unknown', {state: {cycle: 8}}); assert.equal(f.states.length, 0);
    f.receive('loaded', message.requestId, {state: {cycle: 0}});
    assert.equal((await result).state.cycle, 0); assert.equal(f.client.state.cycle, 0);
  } finally { f.cleanup(); }
});

test('new record and AbortSignal cancel previous loads without reporting fallback errors', async () => {
  const f = fixture();
  const record = {puzzle: {name: 'a.puzzle', bytes: new Uint8Array([1])}, solution: {name: 'a.solution', bytes: new Uint8Array([2])}};
  try {
    await f.connect();
    const first = f.client.load(record); const firstRejected = assert.rejects(first, {name: 'AbortError'}); await flush();
    const controller = new AbortController(); const second = f.client.load({...record, signal: controller.signal});
    const secondRejected = assert.rejects(second, {name: 'AbortError'}); await flush();
    controller.abort(); await Promise.all([firstRejected, secondRejected]);
    assert.ok(f.posts.some(([message]) => message.type === 'cancel')); assert.equal(f.errors.length, 0);
  } finally { f.cleanup(); }
});

test('iframe reload rejects outstanding commands and starts a fresh handshake', async () => {
  const f = fixture();
  try {
    await f.connect(); const command = f.client.play(); const rejected = assert.rejects(command, {code: 'RELOADED'}); await flush();
    f.iframe.emit('load'); await rejected; assert.equal(f.errors[0].code, 'RELOADED');
    const init = f.posts.at(-1)[0]; assert.equal(init.type, 'init');
    f.receive('ready', init.requestId, {capabilities: []}); await f.client.ready;
  } finally { f.cleanup(); }
});

test('readiness timeout and disposal reject waiters and release all listeners', async () => {
  const f = fixture({readyTimeoutMs: 8});
  try {
    await assert.rejects(f.client.ready, {code: 'READY_TIMEOUT'});
    assert.equal(f.errors[0].code, 'READY_TIMEOUT');
    f.client.dispose(); assert.equal(f.host.listeners.get('message').size, 0); assert.equal(f.iframe.listeners.get('load').size, 0);
    await assert.rejects(f.client.play(), {code: 'DISPOSED'});
  } finally { f.cleanup(); }
});

test('unfinished playback and collision are state changes; only actual player failures report errors', async () => {
  const f = fixture();
  try {
    await f.connect();
    f.receive('state', `${f.session}:state:1`, {victoryCycle: null, collision: null, error: null});
    f.receive('state', `${f.session}:state:2`, {victoryCycle: null, collision: {q: 1, r: 2}, error: null});
    assert.equal(f.errors.length, 0); assert.equal(f.states.length, 2);
    const failed = {error: {code: 'GPU_UNAVAILABLE', message: 'No adapter'}};
    f.receive('state', `${f.session}:state:3`, failed); f.receive('state', `${f.session}:state:4`, failed);
    assert.equal(f.errors.length, 1);
  } finally { f.cleanup(); }
});

test('immediate StrictMode cleanup sends no command to about:blank and rejects its waiting load', async () => {
  const f = fixture();
  try {
    const loading = f.client.load({puzzle: {name: 'p.puzzle', bytes: new Uint8Array([1])}, solution: {name: 's.solution', bytes: new Uint8Array([2])}});
    const rejected = assert.rejects(loading, error => ['ABORTED', 'DISPOSED'].includes(error.code));
    f.client.dispose(); await rejected;
    assert.equal(f.posts.length, 0); assert.equal(f.errors.length, 0);
  } finally { f.cleanup(); }
});

test('request timeout cancels a loading record and ignores its late reply', async () => {
  const f = fixture({requestTimeoutMs: 8});
  try {
    await f.connect();
    const loading = f.client.load({puzzle: {name: 'p.puzzle', bytes: new Uint8Array([1])}, solution: {name: 's.solution', bytes: new Uint8Array([2])}});
    const rejected = assert.rejects(loading, {code: 'REQUEST_TIMEOUT'}); await flush();
    const load = f.posts.at(-1)[0]; await rejected;
    f.receive('loaded', load.requestId, {state: {cycle: 500}});
    assert.equal(f.states.length, 0); assert.equal(f.errors[0].code, 'REQUEST_TIMEOUT');
    assert.equal(f.posts.at(-1)[0].type, 'cancel');
  } finally { f.cleanup(); }
});

test('a timed-out seek cancels simulation work and ignores its late acknowledgement', async () => {
  const f = fixture({requestTimeoutMs: 8});
  try {
    await f.connect();
    const seeking = f.client.seek(10000000);
    const rejected = assert.rejects(seeking, {code: 'REQUEST_TIMEOUT'});
    await flush(); const seek = f.posts.at(-1)[0]; await rejected;
    assert.equal(f.posts.at(-1)[0].type, 'cancel');
    f.receive('ack', seek.requestId, {state: {cycle: 10000000}});
    assert.equal(f.states.length, 0);
  } finally { f.cleanup(); }
});

test('disposing rejects every pending command while the request map is being drained', async () => {
  const f = fixture({requestTimeoutMs: 100});
  try {
    await f.connect();
    const commands = [f.client.play(), f.client.pause(), f.client.getState()];
    const rejected = commands.map(command => assert.rejects(command, {code: 'DISPOSED'}));
    await flush();
    f.client.dispose();
    await Promise.all(rejected);
    assert.equal(f.host.listeners.get('message').size, 0);
    assert.equal(f.iframe.listeners.get('load').size, 0);
    assert.equal(f.errors.length, 0);
  } finally { f.cleanup(); }
});
