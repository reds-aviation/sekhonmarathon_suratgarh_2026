import { getStore } from '@netlify/blobs';
import { createCertificateHandler } from './service.mjs';

export function certificateStoreName(context = {}) {
  return context.deploy?.context === 'production'
    ? 'sekhon-finisher-2026'
    : `sekhon-finisher-2026-preview-${context.deploy?.id ?? 'local'}`;
}

export function createPrivateStoreAdapter(store) {
  return {
    getJSON: (key) => store.get(key, { type: 'json', consistency: 'strong' }),
    async createJSON(key, value) {
      const result = await store.setJSON(key, value, { onlyIfNew: true });
      if (!result.modified) return false;
      // SDK versions can report phantom conditional-write success on 5xx.
      // Require its ETag and corroborate the immutable value before issuing.
      if (!result.etag) throw new Error('Unconfirmed certificate write');
      const saved = await store.get(key, {
        type: 'json',
        consistency: 'strong',
      });
      if (JSON.stringify(saved) !== JSON.stringify(value))
        throw new Error('Certificate write was not durable');
      return true;
    },
  };
}

function privateStore(context) {
  // Runtime Context is authoritative. CONTEXT and DEPLOY_ID are build-only
  // environment variables, so process.env cannot identify a live deploy.
  const name = certificateStoreName(context);
  return createPrivateStoreAdapter(
    getStore({ name, consistency: 'strong', region: 'ap-southeast-1' }),
  );
}

export default createCertificateHandler({
  getStore: privateStore,
  env: process.env,
});

export const config = {
  path: ['/api/certificates', '/.netlify/functions/certificates'],
  rateLimit: {
    windowLimit: 2000,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
