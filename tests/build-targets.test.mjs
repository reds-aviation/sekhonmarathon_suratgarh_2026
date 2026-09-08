import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pagesOutput = path.join(root, 'dist', 'pages');
const netlifyOutput = path.join(root, 'dist', 'netlify');

async function readProjectFile(...parts) {
  return readFile(path.join(root, ...parts), 'utf8');
}

async function pagesConfig(mode = 'pages', environment = {}) {
  const saved = new Map(
    Object.keys(environment).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, environment);
  const { default: configFactory } = await import('../vite.pages.config.ts');
  try {
    return configFactory({
      command: mode === 'development' ? 'serve' : 'build',
      mode,
      isPreview: false,
      isSsrBuild: false,
    });
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function findManifest(output) {
  for (const candidate of [
    path.join(output, '.vite', 'manifest.json'),
    path.join(output, 'manifest.json'),
  ]) {
    if (existsSync(candidate))
      return JSON.parse(await readFile(candidate, 'utf8'));
  }
  throw new Error(`No Vite manifest found under ${output}`);
}

async function readTextTree(directory, includeCss = true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return readTextTree(entryPath, includeCss);
      const extension = includeCss
        ? /\.(?:html|js|css|json|webmanifest)$/u
        : /\.(?:html|js|json|webmanifest)$/u;
      if (!extension.test(entry.name)) return [];
      return [await readFile(entryPath, 'utf8')];
    }),
  );
  return files.flat();
}

void test('both public hosts build the same static public guide', async () => {
  const published = await pagesConfig('pages', {
    VITE_APP_URL: 'https://ignored.example.invalid/',
    VITE_AUTH_REDIRECT_URL: 'https://ignored.example.invalid/',
    VITE_SUPABASE_URL: 'https://ignored.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'ignored-key',
  });
  const netlify = await pagesConfig('netlify', {
    URL: 'https://sekhon-marathon-suratgarh-2026.netlify.app/',
  });
  const local = await pagesConfig('development');
  const [packageJson, entry, publicClient, configSource, netlifyConfig] = await Promise.all([
      readProjectFile('package.json').then(JSON.parse),
      readProjectFile('app', 'entry.tsx'),
      readProjectFile('app', 'public-client.tsx'),
      readProjectFile('vite.pages.config.ts'),
      readProjectFile('netlify.toml'),
  ]);
  const releaseWorkflow = await readProjectFile(
    '.github',
    'workflows',
    'trusted-release.yml',
  );
  const verificationWorkflow = await readProjectFile(
    '.github',
    'workflows',
    'ci.yml',
  );

  assert.equal(published.base, '/sekhonmarathon_suratgarh_2026/');
  assert.equal(local.base, '/');
  assert.equal(netlify.base, '/');
  assert.equal(published.build.outDir, 'dist/pages');
  assert.equal(netlify.build.outDir, 'dist/netlify');
  assert.equal(published.server.host, '0.0.0.0');
  assert.equal(published.server.port, 3000);
  assert.equal(published.server.strictPort, true);
  assert.equal(
    published.define['import.meta.env.VITE_BUILD_TARGET'],
    '"pages"',
  );
  assert.deepEqual(Object.keys(published.define).sort(), [
    'import.meta.env.VITE_BUILD_TARGET',
    'process.env.NEXT_PUBLIC_BASE_PATH',
  ]);

  assert.equal(packageJson.scripts.dev, 'pnpm run dev:pages');
  assert.equal(packageJson.scripts.build, 'pnpm run build:pages');
  assert.match(packageJson.scripts['dev:pages'], /--mode development/u);
  assert.match(packageJson.scripts['build:pages'], /--mode pages/u);
  assert.match(packageJson.scripts['build:netlify'], /--mode netlify/u);
  assert.match(packageJson.scripts['verify:targets'], /build:pages/u);
  assert.match(packageJson.scripts['verify:targets'], /build:netlify/u);
  assert.doesNotMatch(packageJson.scripts['verify:targets'], /build:app/u);
  assert.equal(packageJson.scripts['dev:app'], undefined);
  assert.equal(packageJson.scripts['build:app'], undefined);

  assert.match(entry, /import '\.\/public-client';/u);
  assert.doesNotMatch(entry, /\.\/client|VITE_BUILD_TARGET/u);
  assert.match(publicClient, /PublicGuide/u);
  assert.doesNotMatch(publicClient, /supabase|event-portal|portal-recovery/ui);
  assert.doesNotMatch(
    configSource,
    /VITE_APP_URL|VITE_AUTH_REDIRECT_URL|NEXT_PUBLIC_SUPABASE|VITE_SUPABASE/u,
  );
  assert.doesNotMatch(
    `${releaseWorkflow}\n${verificationWorkflow}`,
    /netlify|supabase|functions:check|build:app|dist\/app/ui,
  );
  assert.match(releaseWorkflow, /git worktree add --detach/u);
  assert.match(releaseWorkflow, /rsync --archive --delete/u);
  assert.match(releaseWorkflow, /push origin HEAD:gh-pages/u);
  assert.doesNotMatch(releaseWorkflow, /actions\/deploy-pages/u);
  assert.match(netlifyConfig, /command = "pnpm run build:netlify"/u);
  assert.match(netlifyConfig, /publish = "dist\/netlify"/u);
});

void test('the Netlify artifact uses root-relative static hosting paths', async (t) => {
  if (!existsSync(netlifyOutput)) {
    t.skip('the Netlify artifact is created by build:netlify in CI');
    return;
  }

  const [index, manifest, offline] = await Promise.all([
    readFile(path.join(netlifyOutput, 'index.html'), 'utf8'),
    readFile(path.join(netlifyOutput, 'manifest.webmanifest'), 'utf8').then(
      JSON.parse,
    ),
    readFile(path.join(netlifyOutput, 'offline.html'), 'utf8'),
  ]);
  assert.match(index, /(?:src|href)="\/assets\//u);
  assert.doesNotMatch(index, /\/sekhonmarathon_suratgarh_2026\/assets\//u);
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.match(offline, /href="\.\/"/u);
  assert.doesNotMatch(offline, /sekhonmarathon_suratgarh_2026/u);
});

void test('the built Pages artifact excludes the retired private app', async (t) => {
  if (!existsSync(pagesOutput)) {
    t.skip('the Pages artifact is created by build:pages in CI');
    return;
  }

  const [manifest, pagesIndex, webManifest, allText, codeText] =
    await Promise.all([
      findManifest(pagesOutput),
      readFile(path.join(pagesOutput, 'index.html'), 'utf8'),
      readFile(path.join(pagesOutput, 'manifest.webmanifest'), 'utf8').then(
        JSON.parse,
      ),
      readTextTree(pagesOutput).then((files) => files.join('\n')),
      readTextTree(pagesOutput, false).then((files) => files.join('\n')),
    ]);

  assert.match(
    pagesIndex,
    /(?:src|href)="\/sekhonmarathon_suratgarh_2026\/assets\//u,
  );
  assert(
    Object.keys(manifest).length > 0,
    'the GitHub Pages output has a Vite manifest',
  );
  assert.doesNotMatch(JSON.stringify(manifest), /app\/client\.tsx/u);

  const manifestUrl = new URL(
    'manifest.webmanifest',
    'https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/',
  );
  assert.equal(
    new URL(webManifest.start_url, manifestUrl).pathname,
    '/sekhonmarathon_suratgarh_2026/',
  );
  assert.equal(
    new URL(webManifest.scope, manifestUrl).pathname,
    '/sekhonmarathon_suratgarh_2026/',
  );
  assert.doesNotMatch(
    codeText,
    /@supabase\/supabase-js|supabase\.co|submit-registration|payment-receipts|organiser-payment-proof|payment-review-queue|event-portal|portal-recovery|get_member_route|publish_member_route|unpublish_member_route|route-timeline-desk|pending_review/ui,
  );
  assert.doesNotMatch(allText, /http:\/\/localhost:3000/u);

  // Essential event guidance remains in the initial document if the app cannot start.
  assert.match(pagesIndex, /id="static-event-information"/u);
  assert.match(pagesIndex, /Sekhon Indian Air Force Marathon 2026/u);
  assert.match(pagesIndex, /5 KM ₹200 · 10 KM ₹250 · 21 KM ₹250/u);
  assert.match(pagesIndex, /official AFNET portal confirms your registration/iu);

  const canary = process.env.U1_BUNDLE_SECRET_CANARY;
  if (canary)
    assert.doesNotMatch(
      allText,
      new RegExp(canary.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
});
