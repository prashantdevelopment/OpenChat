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
        // app, so browsers keep them cached across deploys. The 3D map's
        // libraries (three.js, React Three Fiber and its helpers) get a
        // separate file that only the Discover page downloads. React is
        // claimed first (highest priority): otherwise the three group pulls
        // it in (R3F imports it) and every page would need that file. R3F's
        // own copy of scheduler stays with R3F.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /(?<!@react-three[\\/]fiber[\\/])node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
              priority: 3,
            },
            {
              name: 'three',
              test: /node_modules[\\/](three|@react-three|its-fine|react-use-measure|suspend-react|zustand)[\\/]/,
              priority: 2,
            },
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
})
