import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath, URL } from 'node:url';

const TARGETS = {
  pages: {
    base: '/sekhonmarathon_suratgarh_2026/',
    output: 'dist/pages',
    siteUrl: 'https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/',
  },
  app: {
    base: '/',
    output: 'dist/app',
    siteUrl: 'http://localhost:3000/',
  },
} as const;

type BuildTarget = keyof typeof TARGETS;

function normalizeBase(value: string, name: string) {
  const base = value.trim();
  if (!base.startsWith('/') || base.includes('?') || base.includes('#'))
    throw new Error(
      `${name} must be an absolute path without a query or fragment`,
    );
  return base === '/' ? '/' : `${base.replace(/\/+$/u, '')}/`;
}

function normalizeSiteUrl(
  value: string,
  fallback: string,
  base: string,
  name: string,
) {
  const url = new URL(value || fallback);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(`${name} must be an http(s) URL without credentials`);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  if (url.pathname !== base)
    throw new Error(
      `${name} must use the configured target base path (${base})`,
    );
  return url.href;
}

function resolveTarget(mode: string, env: Record<string, string>) {
  const modeTarget =
    mode === 'pages' ? 'pages' : mode === 'app' ? 'app' : undefined;
  const configuredTarget = modeTarget || env.VITE_BUILD_TARGET || 'app';
  if (!Object.hasOwn(TARGETS, configuredTarget))
    throw new Error('VITE_BUILD_TARGET must be either "pages" or "app"');
  return configuredTarget as BuildTarget;
}

function targetMetadata(siteUrl: string) {
  return {
    name: 'target-index-metadata',
    transformIndexHtml(html: string) {
      return html.replaceAll('__SITE_URL__', siteUrl);
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const environmentOverrides = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        (entry[0].startsWith('VITE_') || entry[0].startsWith('NEXT_PUBLIC_')),
    ),
  );
  const env: Record<string, string> = {
    ...loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']),
    ...environmentOverrides,
  };
  const target = resolveTarget(mode, env);
  const defaults = TARGETS[target];
  const base = normalizeBase(
    target === 'pages'
      ? env.VITE_PAGES_BASE_PATH || defaults.base
      : env.VITE_APP_BASE_PATH || defaults.base,
    target === 'pages' ? 'VITE_PAGES_BASE_PATH' : 'VITE_APP_BASE_PATH',
  );
  const pagesBase = normalizeBase(
    env.VITE_PAGES_BASE_PATH || TARGETS.pages.base,
    'VITE_PAGES_BASE_PATH',
  );
  const appBase = normalizeBase(
    env.VITE_APP_BASE_PATH || TARGETS.app.base,
    'VITE_APP_BASE_PATH',
  );
  const pagesUrl = normalizeSiteUrl(
    env.VITE_PAGES_URL || '',
    TARGETS.pages.siteUrl,
    pagesBase,
    'VITE_PAGES_URL',
  );
  const isPagesProductionBuild = target === 'pages' && command === 'build';
  if (isPagesProductionBuild && !env.VITE_APP_URL)
    throw new Error(
      'VITE_APP_URL must be an explicit HTTPS URL for a Pages build',
    );
  const appUrl = normalizeSiteUrl(
    env.VITE_APP_URL || '',
    TARGETS.app.siteUrl,
    appBase,
    'VITE_APP_URL',
  );
  if (isPagesProductionBuild && new URL(appUrl).protocol !== 'https:')
    throw new Error('VITE_APP_URL must use HTTPS for a Pages build');
  const authRedirectUrl = new URL(env.VITE_AUTH_REDIRECT_URL || appUrl);
  if (authRedirectUrl.origin !== new URL(appUrl).origin)
    throw new Error(
      'VITE_AUTH_REDIRECT_URL must use the authenticated app origin',
    );
  const publicBasePath = base === '/' ? '' : base.slice(0, -1);
  const supabaseUrl =
    target === 'app'
      ? env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''
      : '';
  const supabaseKey =
    target === 'app'
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        ''
      : '';

  return {
    base,
    plugins: [
      targetMetadata(target === 'pages' ? pagesUrl : appUrl),
      react(),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    css: { postcss: { plugins: [tailwindcss()] } },
    define: {
      'import.meta.env.VITE_BUILD_TARGET': JSON.stringify(target),
      'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify(appUrl),
      'import.meta.env.VITE_AUTH_REDIRECT_URL': JSON.stringify(
        authRedirectUrl.href,
      ),
      'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(publicBasePath),
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY':
        JSON.stringify(supabaseKey),
      'process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL': JSON.stringify(
        authRedirectUrl.href,
      ),
    },
    build: {
      outDir: defaults.output,
      emptyOutDir: true,
      manifest: true,
    },
    server: { port: 3000, strictPort: true },
  };
});
