import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.iocompute.ai'],
    // The app's own backend (admin API + SSO exchange). Without this, a dev server answers
    // /api itself (index.html for GETs, empty 404 for POSTs) and sign-in silently breaks —
    // exactly the 2026-10-19 "sso-exchange 404" incident. Override with VITE_API_PROXY_TARGET.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4010',
        changeOrigin: true,
      },
    },
  },
})
