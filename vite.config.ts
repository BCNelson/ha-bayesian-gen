/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['bayesian_calculator_bg.wasm']
  },
  server: {
    fs: {
      allow: ['..']
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
})
