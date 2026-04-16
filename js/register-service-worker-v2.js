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
    // Session-based suppression: If we just reloaded, wait 30s before showing any toast
    const lastReload = sessionStorage.getItem('mc-pwa-refresh-timestamp');
    if (lastReload && Date.now() - parseInt(lastReload) < 30000) {
      console.log('SW: Update toast suppressed (just reloaded)');
      return;
    }

    // Cooldown: Don't show toast more than once every 5 minutes in a single session
    const lastPrompt = sessionStorage.getItem('mc-pwa-update-prompted');
    if (lastPrompt && Date.now() - parseInt(lastPrompt) < 300000) {
      console.log('SW: Update toast suppressed (cooldown)');
      return;
    }

    const toast = document.getElementById('update-toast');
    if (toast) {
      console.log('SW: Showing update available notification');
      toast.classList.remove('hidden');
      sessionStorage.setItem('mc-pwa-update-prompted', Date.now().toString());
    }
  };

  const initRefreshButton = (registration) => {
    const btn = document.getElementById('update-refresh-btn');
    const toast = document.getElementById('update-toast');
    if (!btn) return;

    btn.onclick = () => {
      console.log('SW: Refresh requested');
      // Immediate UI feedback
      btn.disabled = true;
      btn.innerText = 'Refreshing...';
      
      // Track this refresh to suppress the toast on reload
      sessionStorage.setItem('mc-pwa-refresh-timestamp', Date.now().toString());

      const waiting = registration.waiting;
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        
        // Safety timeout
        setTimeout(() => {
          if (toast) toast.classList.add('hidden');
          window.location.reload();
        }, 3000);
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
        console.log('SW: Registering new worker', swUrl);
        registration = await navigator.serviceWorker.register(swUrl, { updateViaCache: 'none' });
      } else {
        // Small delay before checking for updates to avoid initial load races
        setTimeout(() => {
          if (registration && typeof registration.update === 'function') {
            console.log('SW: Checking for updates');
            registration.update().catch(() => {});
          }
        }, 2000);
      }

      if (registration) {
        initRefreshButton(registration);

        if (registration.waiting) {
          showUpdateToast();
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            console.log('SW: New worker installing');
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('SW: New worker installed and waiting');
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
