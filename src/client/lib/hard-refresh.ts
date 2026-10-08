/**
 * Hard refresh after a deploy: drop the service worker and its caches, then reload from the
 * network. Needed on iOS home-screen apps, which have no browser refresh/cache controls.
 */
export async function hardRefresh(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } finally {
    // Cache-busting query defeats any HTTP-cached index.html; strip it again once loaded.
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now().toString(36));
    window.location.replace(url.toString());
  }
}

/** Remove the cache-busting param left by hardRefresh() so it doesn't linger in the URL. */
export function stripRefreshParam(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has('_r')) {
    url.searchParams.delete('_r');
    window.history.replaceState(null, '', url.toString());
  }
}

export const BUILD_LABEL = `v${__APP_VERSION__} · ${__GIT_HASH__}`;
