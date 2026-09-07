/// <reference types="vite/client" />

/** Installability enhances the website; failure must never block registration. */
export function registerPublicOfflineWorker() {
  if (
    import.meta.env.VITE_BUILD_TARGET !== 'pages' ||
    !import.meta.env.PROD ||
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    !('serviceWorker' in navigator)
  )
    return;

  const register = () => {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    void navigator.serviceWorker
      .register(new URL('service-worker.js', base).href, {
        scope: base.pathname,
        updateViaCache: 'none',
      })
      .catch(() => {
        // Browsers may disable workers in private mode. The online app still works.
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
