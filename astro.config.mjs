// @ts-check
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

// Ensure all environment variables from .env and .env.local are populated into process.env in dev server
const loadedEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
Object.assign(process.env, loadedEnv);

const siteUrl = process.env.SITE_URL ?? 'https://notchi-web-tau.vercel.app';

/**
 * @returns {import('vite').Plugin}
 */
function apiDevMiddleware() {
  return {
    name: 'api-dev-middleware',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      server.middlewares.use(
        /**
         * @param {any} req
         * @param {any} res
         * @param {() => void} next
         */
        async (req, res, next) => {
          if (!req.url?.startsWith('/api/')) return next();
          Object.assign(process.env, loadedEnv);
          const urlPath = req.url.split('?')[0].replace(/^\/api\//, '');
          try {
            /** @type {any} */
            let mod;
            if (urlPath === 'claim-status') {
              mod = await import('./api/claim-status.js');
            } else if (urlPath === 'claim') {
              mod = await import('./api/claim.js');
            } else if (urlPath === 'redeem') {
              mod = await import('./api/redeem.js');
            } else if (urlPath === 'assets') {
              mod = await import('./api/assets.js');
            } else if (urlPath === 'release-device') {
              mod = await import('./api/release-device.js');
            }
            if (mod?.default) {
              let body = '';
              req.on('data', /** @param {any} chunk */ (chunk) => (body += chunk));
              req.on('end', async () => {
                try {
                  req.body = body ? JSON.parse(body) : {};
                } catch {
                  req.body = body;
                }
                res.status = (/** @type {number} */ code) => {
                  res.statusCode = code;
                  return res;
                };
                res.json = (/** @type {any} */ data) => {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(data));
                };
                await mod.default(req, res);
              });
              return;
            }
          } catch (err) {
            console.error('[dev-api] Error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            return;
          }
          next();
        }
      );
    },
  };
}

export default defineConfig({
  site: siteUrl,
  output: 'static',
  integrations: [
    react(),
    sitemap({
      filter: (page) => !/(\/download\/latest\/|\/rss\.xml|\/robots\.txt)$/.test(page),
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en-US',
          id: 'id-ID',
        },
      },
    }),
  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'id'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss(), apiDevMiddleware()],
  },
});
