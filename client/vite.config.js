import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Search and link-preview files that need the site's full address, known only
// at deploy: VITE_SITE_URL (e.g. https://openchat.example). It fills in
// %SITE_URL% in index.html and writes robots.txt and sitemap.xml into the
// build. Without it (development) the lines that need a full address are
// left out, and a production build warns.
const PUBLIC_PAGES = ['/', '/login', '/register']
// Behind the login: nothing there for search engines (and people's chats and
// profiles are nobody's search result). The pages also say noindex.
const PRIVATE_PATHS = ['/chat', '/discover', '/settings', '/u/']

const seo = (rawSiteUrl) => {
  const siteUrl = rawSiteUrl?.replace(/\/+$/, '')
  if (siteUrl && !/^https:\/\/[^/\s]+$/.test(siteUrl)) {
    throw new Error(`VITE_SITE_URL must be https://your.domain (no path), not "${rawSiteUrl}"`)
  }
  return {
    name: 'openchat-seo',
    transformIndexHtml: (html) =>
      siteUrl ? html.replaceAll('%SITE_URL%', siteUrl) : html.replace(/^.*%SITE_URL%.*\r?\n/gm, ''),
    generateBundle() {
      if (!siteUrl) this.warn('VITE_SITE_URL is not set: no sitemap.xml, and link previews have no image')
      const robots = ['User-agent: *', 'Allow: /', ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`)]
      if (siteUrl) robots.push('', `Sitemap: ${siteUrl}/sitemap.xml`)
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots.join('\n')}\n` })
      if (!siteUrl) return
      const urls = PUBLIC_PAGES.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), seo(loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_').VITE_SITE_URL)],
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
}))
