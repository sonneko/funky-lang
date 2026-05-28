import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: '.',
  base: '/funky-lang/',
  server: {
    fs: {
      allow: ['..']
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@funky': resolve(__dirname, '../src')
    }
  }
})
