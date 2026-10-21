import test from 'node:test';
import assert from 'node:assert/strict';
import {importTs} from './helpers/import-ts.mjs';

const {saveUserSolutionFile, readUserSolutionFile, clearUserSolutionFiles} = await importTs(new URL('../src/lib/userSolutionFiles.ts', import.meta.url));
const {loadSolutionBytes} = await importTs(new URL('../src/lib/player/solution.ts', import.meta.url));

// Small IDB transaction double; the browser smoke checks also use real IndexedDB.
function fakeIndexedDB() {
  const values = new Map();
  let connection;
  const api = {
    failWrites: false,
    delayReads: false,
    waiting: [],
    values,
    close() { connection?.onversionchange(); },
    open(name, version) {
      assert.equal(name, 'om-user-solution-files');
      assert.equal(version, 1);
      const request = {};
      connection = {
        close() {},
        createObjectStore(store) { assert.equal(store, 'solutions'); },
        transaction(store, mode) {
          assert.equal(store, 'solutions');
          const tx = {};
          const action = (run, write = false) => {
            const result = {};
            const complete = () => {
              if (write && api.failWrites) { tx.error = new Error('Quota exceeded'); tx.onabort(); }
              else { result.result = run(); tx.oncomplete(); }
            };
            if (mode === 'readonly' && api.delayReads) api.waiting.push(complete);
            else queueMicrotask(complete);
            return result;
          };
          tx.objectStore = () => ({
            put: (file, key) => action(() => { values.set(key, structuredClone(file)); return key; }, true),
            get: key => action(() => values.get(key)),
            clear: () => action(() => values.clear(), true),
          });
          return tx;
        },
      };
      request.result = connection;
      queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); });
      return request;
    },
  };
  return api;
}

const db = fakeIndexedDB();
globalThis.indexedDB = db;

const sample = () => new Blob([new Uint8Array([3, 1, 4, 1, 5])]);

test('solution blobs persist separately from score metadata and survive a reopened database', async () => {
  assert.equal(await saveUserSolutionFile('test-persist', sample()), true);
  assert.ok(db.values.get('test-persist') instanceof Blob);
  db.close();
  assert.deepEqual([...new Uint8Array(await readUserSolutionFile('test-persist'))], [3, 1, 4, 1, 5]);
});

test('each playback/download gets a fresh buffer; transferring one never detaches the stored file', async () => {
  await saveUserSolutionFile('test-copy', sample());
  const first = await loadSolutionBytes(null, 'test-copy', new AbortController().signal);
  const transferred = structuredClone(first, {transfer: [first]});
  assert.equal(first.byteLength, 0);
  assert.equal(transferred.byteLength, 5);
  const second = await loadSolutionBytes(null, 'test-copy', new AbortController().signal);
  assert.deepEqual([...new Uint8Array(second)], [3, 1, 4, 1, 5]);
});

test('failed persistent writes retain a playable session copy and report non-persistence', async () => {
  db.failWrites = true;
  try {
    assert.equal(await saveUserSolutionFile('test-quota', sample()), false);
    assert.equal(db.values.has('test-quota'), false);
    assert.equal((await readUserSolutionFile('test-quota')).byteLength, 5);
  } finally { db.failWrites = false; }
  assert.equal(await saveUserSolutionFile('test-quota', sample()), true);
  assert.equal((await readUserSolutionFile('test-quota')).byteLength, 5);
});

test('clearing removes both persistent and session-only solution files', async () => {
  db.failWrites = true;
  await saveUserSolutionFile('test-session', sample());
  db.failWrites = false;
  await saveUserSolutionFile('test-disk', sample());
  await clearUserSolutionFiles();
  assert.equal(db.values.size, 0);
  assert.equal(await readUserSolutionFile('test-session'), null);
  assert.equal(await readUserSolutionFile('test-disk'), null);
});

test('missing local files do not fall through to a remote URL and explain re-uploading', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Must not fetch'); };
  try {
    await assert.rejects(loadSolutionBytes('https://example.com/remote.solution', 'missing', new AbortController().signal), /Re-upload/);
    await assert.rejects(loadSolutionBytes(null, undefined, new AbortController().signal), /No solution file/);
  } finally { globalThis.fetch = previous; }
});

test('local playback checks cancellation before and after IndexedDB reads', async () => {
  await saveUserSolutionFile('test-abort', sample());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadSolutionBytes(null, 'test-abort', controller.signal), {name: 'AbortError'});
  const pendingController = new AbortController();
  db.delayReads = true;
  try {
    const pending = loadSolutionBytes(null, 'test-abort', pendingController.signal);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.waiting.length, 1);
    pendingController.abort();
    db.waiting.shift()();
    await assert.rejects(pending, {name: 'AbortError'});
  } finally { db.delayReads = false; }
});

test('remote playback still fetches bytes with its AbortSignal and reports HTTP failures', async () => {
  const previous = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.com/remote.solution');
    assert.equal(options.signal, controller.signal);
    return new Response(new Uint8Array([2, 7, 1, 8]));
  };
  try {
    assert.deepEqual([...new Uint8Array(await loadSolutionBytes('https://example.com/remote.solution', undefined, controller.signal))], [2, 7, 1, 8]);
    globalThis.fetch = async () => new Response(null, {status: 404});
    await assert.rejects(loadSolutionBytes('https://example.com/remote.solution', undefined, controller.signal), /HTTP 404/);
  } finally { globalThis.fetch = previous; }
});
