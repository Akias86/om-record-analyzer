import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/

// The offline demo dataset (src/dev/demo, ~400 kB of bundled leaderboard data)
// is a development convenience. Production builds resolve the module specifier
// to an empty stub so it is never emitted, while `src/api/demo.ts` keeps its
// runtime `import.meta.env.DEV` guard for the Node test runner.
const demoStub = fileURLToPath(new URL('./src/dev/demo/production-stub.ts', import.meta.url))

export default defineConfig(({ mode }) => ({
  plugins: [react(), cloudflare()],
  resolve: {
    alias: mode === 'production' ? [{ find: '../dev/demo', replacement: demoStub }] : [],
  },
}))
