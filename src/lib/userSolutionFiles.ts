const DATABASE = 'om-user-solution-files'
const STORE = 'solutions'

let database: Promise<IDBDatabase> | null = null
// Retain files during a write, or for this session if persistence is unavailable.
const sessionFiles = new Map<string, Blob>()

function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1)
      let blocked = false
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE) }
      request.onerror = () => reject(request.error)
      request.onblocked = () => { blocked = true; reject(new Error('Solution storage is blocked')) }
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return }
        request.result.onversionchange = () => { request.result.close(); database = null }
        resolve(request.result)
      }
    }).catch((error) => { database = null; throw error })
  }
  return database
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = run(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onabort = () => reject(tx.error ?? new Error('Solution storage transaction aborted'))
    tx.onerror = () => reject(tx.error ?? request.error)
  })
}

export async function saveUserSolutionFile(key: string, file: Blob): Promise<boolean> {
  sessionFiles.set(key, file)
  try {
    await transaction('readwrite', (store) => store.put(file, key))
    if (sessionFiles.get(key) === file) sessionFiles.delete(key)
    return true
  } catch {
    return false
  }
}

export async function readUserSolutionFile(key: string): Promise<ArrayBuffer | null> {
  let file = sessionFiles.get(key)
  if (!file) {
    try { file = await transaction('readonly', (store) => store.get(key)) }
    catch { return null }
  }
  // Each call gets its own buffer: transferring it to a player must not detach
  // the stored file or break subsequent downloads, previews and replays.
  return file instanceof Blob ? file.arrayBuffer() : null
}

export async function clearUserSolutionFiles(): Promise<void> {
  sessionFiles.clear()
  try { await transaction('readwrite', (store) => store.clear()) }
  catch { /* Storage may be disabled; the session copy has still been cleared. */ }
}
