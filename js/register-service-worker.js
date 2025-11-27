(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const SERVICE_WORKER_URL = './service-worker.js';
  const PERIODIC_PERMISSION_NAME = 'periodic-background-sync';
  const PERIODIC_PROBE_TAG = 'mc-periodic-sync-permission-probe';
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  let readyPromise = null;

  const resolveServiceWorkerUrl = () => {
    if (typeof window === 'undefined' || !window.location) {
      return SERVICE_WORKER_URL;
    }
    try {
      return new URL(SERVICE_WORKER_URL, window.location.href).href;
    } catch (error) {
      console.warn('Failed resolving service worker URL', error);
      return SERVICE_WORKER_URL;
    }
  };

  const ensurePeriodicSyncPermission = async (registration) => {
    if (
      !registration ||
      !('permissions' in navigator) ||
      typeof navigator.permissions?.query !== 'function' ||
      !('periodicSync' in registration)
    ) {
      return;
    }

    let status;
    try {
      status = await navigator.permissions.query({ name: PERIODIC_PERMISSION_NAME });
    } catch (error) {
      console.warn('Periodic sync permission query failed', error);
      return;
    }

    if (!status || status.state === 'granted' || status.state === 'denied') {
      return;
    }

    try {
      await registration.periodicSync.register(PERIODIC_PROBE_TAG, {
        minInterval: ONE_DAY_MS,
      });
      await registration.periodicSync.unregister(PERIODIC_PROBE_TAG);
    } catch (error) {
      console.warn('Periodic sync permission request failed', error);
    }
  };

  const waitForReady = async () => {
    if (readyPromise) {
      return readyPromise;
    }
    readyPromise = navigator.serviceWorker.ready
      .then((registration) => {
        ensurePeriodicSyncPermission(registration);
        return registration;
      })
      .catch((error) => {
        console.warn('Waiting for service worker ready failed', error);
        readyPromise = null;
        return null;
      });
    return readyPromise;
  };

  const register = async () => {
    try {
      const existing = await navigator.serviceWorker.getRegistration();
      if (!existing) {
        const swUrl = resolveServiceWorkerUrl();
        await navigator.serviceWorker.register(swUrl);
      }
      await waitForReady();
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }

  if (typeof navigator.serviceWorker.addEventListener === 'function') {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      readyPromise = null;
      waitForReady();
    });
  }
})();
