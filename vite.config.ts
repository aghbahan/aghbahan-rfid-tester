import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// base = имя репозитория GitHub Pages: https://<user>.github.io/aghbahan-rfid-tester/
export default defineConfig({
  base: '/aghbahan-rfid-tester/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
