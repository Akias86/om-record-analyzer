/* ---------------------------------------------------------------------------
   Production stand-in for the demo dataset.

   `vite.config.ts` aliases `../dev/demo` to this file for production builds so
   the bundled leaderboard JSON is never emitted: `src/api/demo.ts` still calls
   `import('../dev/demo')`, but it is guarded by `import.meta.env.DEV`, and this
   module keeps the specifier resolvable and tiny.
--------------------------------------------------------------------------- */

export const demoApi = null
