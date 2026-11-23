/* ---------------------------------------------------------------------------
   Development-only offline data source.

   `?demo=1` (remembered in localStorage so it survives hash navigation) makes
   the API layer answer from the bundled public-domain dataset in src/dev/demo
   instead of the Cloudflare Worker proxy. Useful for UI work, review previews
   and demos where zlbb.faendir.com is unreachable.

   The module is imported dynamically behind `import.meta.env.DEV`, so the
   dataset is never part of a production bundle.
--------------------------------------------------------------------------- */

import type { DemoApi } from '../dev/demo'

const STORAGE_KEY = 'om-app:demo'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// Read defensively: the Node test runner imports this module without Vite's
// `import.meta.env`, where the demo dataset is neither bundled nor wanted.
const DEV_BUILD = Boolean(import.meta.env?.DEV)

/** True when this build can offer demo data at all. */
export function demoAvailable(): boolean {
  return DEV_BUILD
}

/** Reads the `?demo=` flag once, persisting it, then the stored preference. */
export function isDemoEnabled(): boolean {
  try {
    const flag = new URLSearchParams(window.location.search).get('demo')
    if (flag !== null) {
      const enabled = flag !== '0' && flag !== 'false'
      const store = storage()
      if (enabled) store?.setItem(STORAGE_KEY, '1')
      else store?.removeItem(STORAGE_KEY)
      return enabled
    }
    return storage()?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Persists the preference and reloads: module-level caches (puzzle tree,
   in-flight dedup, localStorage API cache) must not mix real and demo data. */
export function setDemoEnabled(enabled: boolean): void {
  const store = storage()
  try {
    if (enabled) store?.setItem(STORAGE_KEY, '1')
    else store?.removeItem(STORAGE_KEY)
  } catch { /* the reload below still applies it for this page view */ }
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('demo')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch { /* keep the current URL */ }
  window.location.reload()
}

let api: Promise<DemoApi | null> | null = null

export function getDemoApi(): Promise<DemoApi | null> {
  if (!demoAvailable() || !isDemoEnabled()) return Promise.resolve(null)
  api ??= import('../dev/demo')
    .then((module) => module.demoApi)
    .catch(() => null)
  return api
}
