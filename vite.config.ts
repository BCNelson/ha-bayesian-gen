/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue()],
    base: env.VITE_BASE_URL || '/',
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
  }
})
