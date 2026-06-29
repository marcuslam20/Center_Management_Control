import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxy /api → backend (port 8080). Build → web/dist (backend phục vụ static).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist' },
});
