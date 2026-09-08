import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pagesOutput = path.join(root, 'dist', 'pages');
const appOutput = path.join(root, 'dist', 'app');

async function readProjectFile(...parts) {
  return readFile(path.join(root, ...parts), 'utf8');
}

async function targetConfig(mode, environment = {}) {
  const saved = new Map(
    Object.keys(environment).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, environment);
  const { default: configFactory } = await import('../vite.pages.config.ts');
  try {
    return configFactory({
      command: 'build',
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

void test('declares separate Pages and authenticated-app build targets', async () => {
  const appUrl = 'https://app.example.invalid/';
  const publishableConfig = {
    VITE_APP_URL: appUrl,
    VITE_AUTH_REDIRECT_URL: appUrl,
    VITE_SUPABASE_URL: 'https://project.example.invalid',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
  };
  const pages = await targetConfig('pages', {
    ...publishableConfig,
  });
  const app = await targetConfig('app', publishableConfig);
  const [packageJson, client, publicClient, entry] = await Promise.all([
    readProjectFile('package.json').then(JSON.parse),
    readProjectFile('app', 'client.tsx'),
    readProjectFile('app', 'public-client.tsx'),
    readProjectFile('app', 'entry.tsx'),
  ]);

  assert.equal(pages.base, '/sekhonmarathon_suratgarh_2026/');
  assert.equal(pages.build.outDir, 'dist/pages');
  assert.equal(pages.define['import.meta.env.VITE_BUILD_TARGET'], '"pages"');
  assert.equal(pages.define['process.env.NEXT_PUBLIC_SUPABASE_URL'], '""');
  assert.equal(
    pages.define['process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
    '""',
  );

  assert.equal(app.base, '/');
  assert.equal(app.build.outDir, 'dist/app');
  assert.equal(app.server.host, '0.0.0.0');
  assert.equal(app.server.port, 3000);
  assert.equal(app.server.strictPort, true);
  assert.equal(app.define['import.meta.env.VITE_BUILD_TARGET'], '"app"');
  assert.equal(
    app.define['process.env.NEXT_PUBLIC_SUPABASE_URL'],
    '"https://project.example.invalid"',
  );
  assert.equal(
    app.define['process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
    '"publishable-test-key"',
  );
  assert.equal(
    typeof app.define['process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL'],
    'string',
  );
  assert.doesNotMatch(
    JSON.stringify(app.define),
    /SERVICE_ROLE|NETLIFY_AUTH_TOKEN/u,
  );

  assert.match(packageJson.scripts['build:pages'], /--mode pages/u);
  assert.match(packageJson.scripts['build:app'], /--mode app/u);
  assert.match(packageJson.scripts['verify:targets'], /build:pages/u);
  assert.match(packageJson.scripts['verify:targets'], /build:app/u);
  assert.match(
    packageJson.scripts['functions:check'],
    /deno(?:@\d+\.\d+\.\d+)? check/u,
  );
  assert.match(client, /VITE_BUILD_TARGET === 'pages'/u);
  assert.match(publicClient, /PublicGuide/u);
  assert.doesNotMatch(publicClient, /supabase|event-portal|portal-recovery/ui);
  assert.match(entry, /import\('\.\/public-client'\)/u);
  assert.match(entry, /import\('\.\/client'\)/u);
  await assert.rejects(
    () =>
      targetConfig('pages', { VITE_APP_URL: '', VITE_AUTH_REDIRECT_URL: '' }),
    /VITE_APP_URL must be an explicit HTTPS URL/u,
  );
});

void test('built artifacts keep Pages public-only and the app root-based', async (t) => {
  if (!existsSync(pagesOutput) || !existsSync(appOutput)) {
    t.skip('target artifacts are created by build:pages and build:app in CI');
    return;
  }

  const [
    appManifest,
    pagesIndex,
    appIndex,
    pagesWebManifest,
    appWebManifest,
  ] = await Promise.all([
    findManifest(appOutput),
    readFile(path.join(pagesOutput, 'index.html'), 'utf8'),
    readFile(path.join(appOutput, 'index.html'), 'utf8'),
    readFile(path.join(pagesOutput, 'manifest.webmanifest'), 'utf8').then(
      JSON.parse,
    ),
    readFile(path.join(appOutput, 'manifest.webmanifest'), 'utf8').then(
      JSON.parse,
    ),
  ]);

  assert.match(
    pagesIndex,
    /(?:src|href)="\/sekhonmarathon_suratgarh_2026\/assets\//u,
  );
  assert.doesNotMatch(appIndex, /\/sekhonmarathon_suratgarh_2026\//u);
  assert.match(appIndex, /(?:src|href)="\/assets\//u);

  assert(
    Object.keys(appManifest).length > 0,
    'Netlify output has a Vite manifest',
  );

  const pagesManifestUrl = new URL(
    'manifest.webmanifest',
    'https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/',
  );
  const appManifestUrl = new URL(
    'manifest.webmanifest',
    'https://app.example.invalid/',
  );
  assert.equal(
    new URL(pagesWebManifest.start_url, pagesManifestUrl).pathname,
    '/sekhonmarathon_suratgarh_2026/',
  );
  assert.equal(
    new URL(pagesWebManifest.scope, pagesManifestUrl).pathname,
    '/sekhonmarathon_suratgarh_2026/',
  );
  assert.equal(new URL(appWebManifest.start_url, appManifestUrl).pathname, '/');
  assert.equal(new URL(appWebManifest.scope, appManifestUrl).pathname, '/');
  assert.doesNotMatch(
    JSON.stringify(pagesWebManifest),
    /race-desk|organiser|certificate/u,
  );

  const canary = process.env.U1_BUNDLE_SECRET_CANARY;
  const configuredAppUrl = process.env.VITE_APP_URL;
  const pagesText = (await readTextTree(pagesOutput)).join('\n');
  const pagesCodeText = (await readTextTree(pagesOutput, false)).join('\n');
  assert.doesNotMatch(
    pagesCodeText,
    /@supabase\/supabase-js|supabase\.co|submit-registration|payment-receipts|organiser-payment-proof|payment-review-queue|event-portal|portal-recovery|get_member_route|publish_member_route|unpublish_member_route|route-timeline-desk|Payment QR pending|pending_review/ui,
  );
  assert.doesNotMatch(pagesText, /http:\/\/localhost:3000/u);
  if (configuredAppUrl)
    assert.match(
      pagesText,
      new RegExp(configuredAppUrl.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
  if (canary) {
    const appText = await readTextTree(appOutput);
    const emittedText = (
      await Promise.all([
        Promise.resolve(pagesText),
        Promise.resolve(appText.join('\n')),
      ])
    ).join('\n');
    assert.doesNotMatch(
      emittedText,
      new RegExp(canary.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
  }
});
