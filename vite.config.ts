import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare({ inspectorPort: false })],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
