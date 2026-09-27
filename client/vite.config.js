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
  build: {
    rolldownOptions: {
      output: {
        // Libraries in their own files: they change far less often than the
        // app, so browsers keep them cached across deploys. The landing
        // page's motion (GSAP + Lenis) gets a separate file that only the
        // landing page downloads; the vendor group must not claim it.
        codeSplitting: {
          groups: [
            // Vite's small preload helper is used by every lazy import: on its
            // own, so it never lands in (and drags along) a lazy file.
            { name: 'preload-helper', test: /preload-helper/, priority: 4 },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
              priority: 3,
            },
            {
              name: 'landing-motion',
              test: /node_modules[\\/](gsap|lenis)[\\/]/,
              priority: 2,
            },
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
})
