export const initMobileSyncControls = () => {
  const statusContainer = document.getElementById('syncStatus');
  const statusDotEl = document.getElementById('mcStatus');
  const statusTextEl = document.getElementById('mcStatusText');

  if (!statusTextEl) return;

  const ACTIVE_CLASSES = ['online', 'offline', 'error'];
  const DOT_CLASSES = ['online', 'offline'];
  const DEFAULT_MESSAGES = {
    checking: 'Checking connection...',
    syncing: 'Syncing your latest changes...',
    online: 'Connected. Changes sync automatically.',
    offline: "You're offline. Changes are saved on this device until you reconnect.",
    error: "We couldn't sync right now. We'll retry soon.",
    info: '',
  };
  const DISPLAY_MESSAGES = {
    checking: 'Checking...',
    syncing: 'Syncing...',
    online: 'Synced. Auto-save on.',
    offline: 'Offline. Saving locally.',
    error: 'Sync issue. Retrying.',
    info: '',
  };

  let currentState = null;

  function applyDotState(state) {
    if (!statusDotEl) return;
    DOT_CLASSES.forEach((cls) => statusDotEl.classList.remove(cls));
    const isOnline = state !== 'offline' && state !== 'error';
    statusDotEl.classList.add(isOnline ? 'online' : 'offline');
    statusDotEl.setAttribute('aria-label', isOnline ? 'Online' : 'Offline');
  }

  function setStatus(state, message) {
    currentState = state;
    ACTIVE_CLASSES.forEach((cls) => statusTextEl.classList.remove(cls));
    if (statusContainer) ACTIVE_CLASSES.forEach((cls) => statusContainer.classList.remove(cls));

    if (state === 'online') {
      statusTextEl.classList.add('online');
      if (statusContainer) statusContainer.classList.add('online');
    } else if (state === 'error') {
      statusTextEl.classList.add('error');
      if (statusContainer) statusContainer.classList.add('error');
    } else {
      statusTextEl.classList.add('offline');
      if (statusContainer) statusContainer.classList.add('offline');
    }

    const fullText = typeof message === 'string' && message.trim() ? message.trim() : DEFAULT_MESSAGES[state] || '';
    const displayText = typeof message === 'string' && message.trim() ? message.trim() : DISPLAY_MESSAGES[state] || fullText;
    const srText = fullText || displayText || '';
    statusTextEl.textContent = srText;

    if (srText) {
      statusTextEl.setAttribute('title', srText);
      statusTextEl.setAttribute('aria-label', srText);
    } else {
      statusTextEl.removeAttribute('title');
      statusTextEl.removeAttribute('aria-label');
    }

    applyDotState(state);
    statusTextEl.dataset.state = state;
  }

  function updateOnlineState() {
    if (currentState === 'syncing') return;
    setStatus(navigator.onLine ? 'online' : 'offline');
  }

  setStatus(navigator.onLine ? 'online' : 'offline');
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
};
