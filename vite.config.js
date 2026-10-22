import { defineConfig } from 'vite'

export default defineConfig({
  // Toy pages are served from /toy/<slug>/, so every emitted asset must stay relative.
  base: './',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules\\three')) {
            return 'three'
          }
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5178,
  },
})
