import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7890',
      '/ws': { target: 'ws://localhost:7890', ws: true },
    },
  },
  build: {
    outDir: '../dashboard',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
  },
})
