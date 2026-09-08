import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath, URL } from 'node:url';

const PAGES_BASE = '/sekhonmarathon_suratgarh_2026/';
const PAGES_OUTPUT = 'dist/pages';
const NETLIFY_OUTPUT = 'dist/netlify';
const PAGES_URL =
  'https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/';
const LOCAL_URL = 'http://localhost:3000/';

function normalizeBase(value: string) {
  const base = value.trim();
  if (!base.startsWith('/') || base.includes('?') || base.includes('#'))
    throw new Error(
      'VITE_PAGES_BASE_PATH must be an absolute path without a query or fragment',
    );
  return base === '/' ? '/' : `${base.replace(/\/+$/u, '')}/`;
}

function normalizeSiteUrl(value: string, base: string, fallback: string) {
  const url = new URL(value || fallback);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      'VITE_PAGES_URL must be an http(s) URL without credentials',
    );
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  if (url.pathname !== base)
    throw new Error(
      `VITE_PAGES_URL must use the configured Pages base path (${base})`,
    );
  return url.href;
}

function targetMetadata(siteUrl: string) {
  return {
    name: 'target-index-metadata',
    transformIndexHtml(html: string) {
      return html.replaceAll('__SITE_URL__', siteUrl);
    },
  };
}

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), ['VITE_PAGES_']);
  const env = {
    ...loadedEnv,
    ...(process.env.VITE_PAGES_BASE_PATH
      ? { VITE_PAGES_BASE_PATH: process.env.VITE_PAGES_BASE_PATH }
      : {}),
    ...(process.env.VITE_PAGES_URL
      ? { VITE_PAGES_URL: process.env.VITE_PAGES_URL }
      : {}),
  };
  const publishedBase = normalizeBase(
    env.VITE_PAGES_BASE_PATH || PAGES_BASE,
  );
  const isPages = mode === 'pages';
  const isNetlify = mode === 'netlify';
  const base = isPages ? publishedBase : '/';
  const fallbackUrl = isPages ? PAGES_URL : LOCAL_URL;
  const siteUrl = normalizeSiteUrl(
    env.VITE_PAGES_URL || (isNetlify ? process.env.URL || '' : ''),
    base,
    fallbackUrl,
  );
  const publicBasePath = base === '/' ? '' : base.slice(0, -1);

  return {
    base,
    plugins: [targetMetadata(siteUrl), react()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    css: { postcss: { plugins: [tailwindcss()] } },
    define: {
      'import.meta.env.VITE_BUILD_TARGET': JSON.stringify('pages'),
      'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(publicBasePath),
    },
    build: {
      outDir: isNetlify ? NETLIFY_OUTPUT : PAGES_OUTPUT,
      emptyOutDir: true,
      manifest: true,
    },
    server: { host: '0.0.0.0', port: 3000, strictPort: true },
  };
});
