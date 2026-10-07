/**
 * Lets the built app open without a connection, so a phone can check in where there's no signal. Only the build:
 * the dev server's modules change on every edit and must never come from a saved copy.
 */
export function registerOfflineSupport() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Offline support is off:', error));
  });
}
