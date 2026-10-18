// Vendored from om-web-simulator/src/embed/protocol.js (protocol v1).
export const CHANNEL = 'om-player';
export const VERSION = 1;

export function packet(type, requestId, session, payload = {}) {
  return {channel: CHANNEL, version: VERSION, type, requestId, session, payload};
}

export function isPacket(value, session) {
  return !!value && typeof value === 'object' && value.channel === CHANNEL && value.version === VERSION
    && typeof value.type === 'string' && typeof value.requestId === 'string'
    && value.requestId.length > 0 && value.requestId.length <= 160
    && typeof value.session === 'string' && (!session || value.session === session)
    && !!value.payload && typeof value.payload === 'object';
}

export function exactOrigin(value) {
  if (typeof value !== 'string') throw new TypeError('parentOrigin must be an HTTP(S) origin.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new TypeError('parentOrigin must be an exact HTTP(S) origin, without a path.');
  }
  return url.origin;
}

export function copyBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  throw new TypeError('Expected puzzle/solution bytes as an ArrayBuffer or typed array.');
}

export function playerError(message, code = 'PLAYER_ERROR') {
  const error = new Error(message);
  error.name = code === 'ABORTED' ? 'AbortError' : 'PlayerError';
  error.code = code;
  return error;
}
