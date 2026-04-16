(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const SERVICE_WORKER_URL = './service-worker-v3.js?v=20260417a';
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
    } catch {
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
    } catch {
      // Browsers commonly reject periodic background sync probing without a user-visible
      // capability difference. Keep the app quiet unless registration itself fails later.
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

  const registrationMatches = (registration, expectedUrl) => {
    if (!registration || !expectedUrl) {
      return false;
    }

    return [registration.installing, registration.waiting, registration.active]
      .filter(Boolean)
      .some((worker) => worker.scriptURL === expectedUrl);
  };

  const showUpdateToast = () => {
    const toast = document.getElementById('update-toast');
    if (toast) {
      toast.classList.remove('hidden');
    }
  };

  const initRefreshButton = (registration) => {
    const btn = document.getElementById('update-refresh-btn');
    const toast = document.getElementById('update-toast');
    if (!btn) return;

    btn.onclick = () => {
      // Immediate UI feedback
      btn.disabled = true;
      btn.innerText = 'Refreshing...';
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';

      const waiting = registration.waiting;
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        
        // Safety timeout: if controllerchange doesn't fire in 2s, force reload
        setTimeout(() => {
          if (toast) toast.classList.add('hidden');
          window.location.reload();
        }, 2000);
      } else {
        if (toast) toast.classList.add('hidden');
        window.location.reload();
      }
    };
  };

  const register = async () => {
    try {
      const swUrl = resolveServiceWorkerUrl();
      let registration = await navigator.serviceWorker.getRegistration();

      if (!registrationMatches(registration, swUrl)) {
        registration = await navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' });
      } else if (typeof registration?.update === 'function') {
        await registration.update();
      }

      if (registration) {
        initRefreshButton(registration);

        if (registration.waiting) {
          showUpdateToast();
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast();
              }
            });
          }
        });

        // Check for updates periodically (every 1 hour)
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000);
      }

      await waitForReady();
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  };

  if (typeof window !== 'undefined') {
    window.MemoryCueServiceWorker = {
      ensureRegistration: register,
      waitForReady,
      resolveServiceWorkerUrl,
    };
  }

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }

  if (typeof navigator.serviceWorker.addEventListener === 'function') {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
})();
