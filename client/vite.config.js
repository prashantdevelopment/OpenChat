import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // "@/..." = "src/..." (used by shadcn/coss ui components)
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
