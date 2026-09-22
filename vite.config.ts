import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:3001',
          changeOrigin: true,
        },
        // Without this, getWsUrl() in services/api.ts resolves to
        // ws://localhost:5173/ws (Vite's own dev server, which has no
        // WebSocket handler at that path) instead of the backend, so every
        // live push (goals, score, odds) silently never connects when the
        // app is run via `npm run dev` rather than through the backend
        // itself (`npm run server`, which serves the built frontend AND
        // /ws from the same port).
        '/ws': {
          target: (env.VITE_API_TARGET || 'http://localhost:3001').replace(/^http/, 'ws'),
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
})
