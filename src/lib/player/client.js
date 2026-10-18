// Vendored from om-web-simulator/embed/client.js (protocol v1).
import {copyBytes, exactOrigin, isPacket, packet, playerError} from './protocol.js';

const uniqueId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Connect one iframe. Bytes are copied before transfer; caller buffers remain usable. */
export function createPlayerClient(iframe, options) {
  if (!iframe || !options?.url) throw new TypeError('An iframe and player URL are required.');
  const host = window;
  const url = new URL(options.url, host.location.href);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Player URL must use HTTP(S).');
  const origin = url.origin, parentOrigin = exactOrigin(host.location.origin), session = uniqueId();
  const params = new URLSearchParams(url.hash.slice(1));
  params.set('parentOrigin', parentOrigin); params.set('session', session); url.hash = params.toString();
  const pending = new Map();
  let disposed = false, connected = false, hasLoaded = false, sequence = 0, initId, readyTimer, loadAbort, lastState = null, lastError = '';
  let resolveReady, rejectReady;
  let ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Consumers commonly await load() instead. Keep a standalone readiness failure handled.
  ready.catch(() => {});
  const report = error => { try { options.onError?.(error); } catch {} };
  const notify = state => {
    lastState = state;
    if (state.error && `${state.error.code}:${state.error.message}` !== lastError) {
      lastError = `${state.error.code}:${state.error.message}`;
      report(playerError(state.error.message, state.error.code));
    } else if (!state.error) lastError = '';
    try { options.onState?.(state); } catch {}
  };
  const id = () => `${session}:${++sequence}`;
  const post = (type, requestId, payload, transfer = []) => {
    if (!disposed) iframe.contentWindow?.postMessage(packet(type, requestId, session, payload), origin, transfer);
  };
  const rejectPending = error => {
    for (const item of pending.values()) item.finish(error);
  };
  function startReadyTimeout() {
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      const error = playerError('Player did not become ready within 20 seconds.', 'READY_TIMEOUT');
      rejectReady(error); rejectPending(error); report(error);
    }, options.readyTimeoutMs ?? 20000);
  }
  function beginHandshake() {
    if (disposed) return;
    initId = id(); post('init', initId, {}); startReadyTimeout();
  }
  function onLoad() {
    if (disposed) return;
    // A StrictMode cleanup may have queued an about:blank load before this new
    // client attached. It is same-origin and safe to identify; the real player
    // on another origin deliberately throws here and proceeds to the handshake.
    try { if (iframe.contentWindow?.location?.href === 'about:blank') return; } catch {}
    if (hasLoaded && connected) {
      const error = playerError('Player iframe reloaded. Load the record again.', 'RELOADED');
      connected = false; loadAbort?.abort(); rejectPending(error); report(error);
      ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      ready.catch(() => {});
    }
    hasLoaded = true;
    beginHandshake();
  }
  function onMessage(event) {
    const message = event.data;
    if (disposed || event.source !== iframe.contentWindow || event.origin !== origin || !isPacket(message, session)) return;
    if (message.type === 'ready') {
      if (message.requestId !== initId) return;
      clearTimeout(readyTimer); connected = true; resolveReady(message.payload);
      return;
    }
    if (!connected) return;
    if (message.type === 'state') {
      if (!message.requestId.startsWith(`${session}:state:`)) return;
      notify(message.payload); return;
    }
    const item = pending.get(message.requestId);
    if (!item || !['ack', 'loaded', 'error'].includes(message.type)) return;
    if (message.type === 'error') {
      const error = playerError(message.payload.message || 'Player command failed.', message.payload.code);
      item.finish(error); if (error.code !== 'ABORTED') report(error);
    } else {
      if (message.payload.state) notify(message.payload.state);
      item.finish(null, message.payload);
    }
  }
  host.addEventListener('message', onMessage);
  iframe.addEventListener('load', onLoad);
  iframe.src = url.href;
  // The initial load event supplies the first init message. Start the timeout now,
  // including DNS/network time; a cached page cannot silently wait forever.
  startReadyTimeout();

  async function request(type, payload = {}, {signal, transfer = []} = {}) {
    if (disposed) throw playerError('Player client is disposed.', 'DISPOSED');
    if (signal?.aborted) throw playerError('Player request cancelled.', 'ABORTED');
    await new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(playerError('Player request cancelled.', 'ABORTED')); };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, {once: true});
      ready.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    });
    if (disposed || signal?.aborted) throw playerError('Player request cancelled.', 'ABORTED');
    return new Promise((resolve, reject) => {
      const requestId = id();
      let timer;
      const abort = () => {
        finish(playerError('Player request cancelled.', 'ABORTED'));
        if (type === 'load' || type === 'seek') post('cancel', id(), {});
      };
      const finish = (error, result) => {
        if (!pending.delete(requestId)) return;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result);
      };
      pending.set(requestId, {finish});
      signal?.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => {
        const error = playerError(`Player ${type} request timed out.`, 'REQUEST_TIMEOUT');
        finish(error); if (type === 'load' || type === 'seek') post('cancel', id(), {}); report(error);
      }, options.requestTimeoutMs ?? 30000);
      try { post(type, requestId, payload, transfer); } catch (error) { finish(error); }
    });
  }
  return {
    get ready() { return ready; },
    get state() { return lastState; },
    async load(record) {
      loadAbort?.abort();
      const controller = new AbortController(); loadAbort = controller;
      const abort = () => controller.abort();
      record.signal?.addEventListener('abort', abort, {once: true});
      if (record.signal?.aborted) controller.abort();
      try {
        const puzzle = copyBytes(record.puzzle.bytes), solution = copyBytes(record.solution.bytes);
        return await request('load', {
          puzzle: {name: record.puzzle.name || 'input.puzzle', bytes: puzzle},
          solution: {name: record.solution.name || 'input.solution', bytes: solution},
          title: String(record.title || ''), autoplay: record.autoplay !== false,
        }, {signal: controller.signal, transfer: [puzzle.buffer, solution.buffer]});
      } finally {
        record.signal?.removeEventListener('abort', abort);
        if (loadAbort === controller) loadAbort = null;
      }
    },
    play: () => request('play'), pause: () => request('pause'),
    step: direction => request('step', {direction}),
    seek: cycle => request('seek', {cycle}),
    setSpeed: speed => request('speed', {speed}),
    setTitle: title => request('title', {title: String(title || '')}),
    getState: () => request('state'),
    cancel() { loadAbort?.abort(); return request('cancel'); },
    dispose() {
      if (disposed) return;
      if (connected) post('cancel', id(), {});
      disposed = true; connected = false; clearTimeout(readyTimer); loadAbort?.abort();
      const error = playerError('Player client is disposed.', 'DISPOSED');
      rejectReady(error); rejectPending(error);
      host.removeEventListener('message', onMessage); iframe.removeEventListener('load', onLoad);
      iframe.removeAttribute('src');
    },
  };
}
