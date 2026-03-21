export const initMobileSyncControls = () => {
  const statusContainer = document.getElementById('syncStatus');
  const statusDotEl = document.getElementById('mcStatus');
  const statusTextEl = document.getElementById('mcStatusText');
  const syncUrlInput = document.getElementById('syncUrl');
  const saveSettingsBtn = document.getElementById('saveSyncSettings');
  const testSyncBtn = document.getElementById('testSync');
  const syncAllBtn = document.getElementById('syncAll');
  const STORAGE_KEY = 'syncUrl';

  if (!statusTextEl) return;

  const ACTIVE_CLASSES = ['online', 'offline', 'error'];
  const DOT_CLASSES = ['online', 'offline'];
  const DEFAULT_MESSAGES = {
    checking: 'Checking connection…',
    syncing: 'Syncing your latest changes…',
    online: 'Connected. Changes sync automatically.',
    offline: "You're offline. Changes are saved on this device until you reconnect.",
    error: "We couldn't sync right now. We'll retry soon.",
    info: '',
  };
  const DISPLAY_MESSAGES = {
    checking: 'Checking…',
    syncing: 'Syncing…',
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

  function persistUrl(value) {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  }

  function getStoredUrl() {
    if (typeof localStorage === 'undefined') return '';
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function normaliseReminder(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id || raw.uid || raw.key || raw.slug || raw.uuid;
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : (typeof raw.name === 'string' ? raw.name.trim() : '');
    if (!title) return null;
    const dueIso = typeof raw.dueIso === 'string' && raw.dueIso ? raw.dueIso : (typeof raw.due === 'string' ? raw.due : null);
    const priority = typeof raw.priority === 'string' && raw.priority.trim() ? raw.priority.trim() : (raw.level || raw.importance || 'Medium');
    const category = typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : (raw.group || raw.bucket || 'General');
    const done = typeof raw.done === 'boolean' ? raw.done : Boolean(raw.completed || raw.isDone || raw.status === 'done');
    return {
      id: id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      title,
      dueIso: dueIso && dueIso.trim() ? dueIso.trim() : null,
      priority,
      category,
      done,
    };
  }

  function collectFromDom() {
    const elements = Array.from(document.querySelectorAll('[data-reminder]'));
    if (!elements.length) return [];
    return elements.map((el) => {
      const dataset = el.dataset || {};
      let raw = null;
      if (dataset.reminder) {
        try { raw = JSON.parse(dataset.reminder); } catch { raw = null; }
      }
      const candidate = raw || {
        id: dataset.id || dataset.reminderId || el.getAttribute('data-id') || null,
        title: dataset.title || dataset.reminderTitle || '',
        dueIso: dataset.due || dataset.reminderDue || el.getAttribute('data-due') || null,
        priority: dataset.priority || dataset.reminderPriority || el.getAttribute('data-priority') || '',
        category: dataset.category || dataset.reminderCategory || el.getAttribute('data-category') || '',
        done: dataset.done === 'true' || dataset.reminderDone === 'true' || el.getAttribute('data-done') === 'true',
      };
      if (!candidate.title) {
        const titleEl = el.querySelector('[data-reminder-title], [data-title], h3, h4, strong');
        if (titleEl) candidate.title = titleEl.textContent.trim();
      }
      if (!candidate.dueIso) {
        const dueEl = el.querySelector('[data-due], time');
        if (dueEl) {
          const attr = dueEl.getAttribute('datetime') || dueEl.getAttribute('data-due');
          candidate.dueIso = attr || dueEl.textContent.trim();
        }
      }
      return normaliseReminder(candidate);
    }).filter(Boolean);
  }

  function collectFromStorage() {
    if (typeof localStorage === 'undefined') return [];
    const reminders = [];
    const triedKeys = new Set();
    const preferredKeys = ['memoryCue.reminders.v1', 'memoryCue.reminders', 'memoryCueMobile.reminders', 'memoryCue.reminders.cache', 'reminders'];

    preferredKeys.forEach((key) => {
      if (triedKeys.has(key)) return;
      triedKeys.add(key);
      try {
        const value = localStorage.getItem(key);
        if (!value) return;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) parsed.forEach((item) => reminders.push(item));
        else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
          if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
        }
      } catch {
        /* ignore */
      }
    });

    if (!reminders.length) {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || triedKeys.has(key) || !/remind/i.test(key)) continue;
        triedKeys.add(key);
        try {
          const value = localStorage.getItem(key);
          if (!value) continue;
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) parsed.forEach((item) => reminders.push(item));
          else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
            if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
          }
        } catch {
          /* ignore */
        }
      }
    }

    return reminders.map(normaliseReminder).filter(Boolean);
  }

  function collectReminders() {
    const fromDom = collectFromDom();
    return fromDom.length ? fromDom : collectFromStorage();
  }

  function toggleBusy(isBusy) {
    if (isBusy) {
      syncAllBtn?.setAttribute('aria-busy', 'true');
      syncAllBtn?.setAttribute('disabled', 'disabled');
      testSyncBtn?.setAttribute('aria-busy', 'true');
      testSyncBtn?.setAttribute('disabled', 'disabled');
    } else {
      syncAllBtn?.removeAttribute('aria-busy');
      testSyncBtn?.removeAttribute('aria-busy');
      updateButtonState();
    }
  }

  function updateButtonState() {
    const hasUrl = Boolean((syncUrlInput?.value || '').trim() || getStoredUrl());
    if (hasUrl) {
      syncAllBtn?.removeAttribute('disabled');
      testSyncBtn?.removeAttribute('disabled');
    } else {
      syncAllBtn?.setAttribute('disabled', 'disabled');
      testSyncBtn?.setAttribute('disabled', 'disabled');
    }
  }

  const storedUrl = getStoredUrl();
  if (syncUrlInput && storedUrl) syncUrlInput.value = storedUrl;

  updateButtonState();
  setStatus(navigator.onLine ? 'online' : 'offline');
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  syncUrlInput?.addEventListener('input', updateButtonState);

  saveSettingsBtn?.addEventListener('click', () => {
    const value = (syncUrlInput?.value || '').trim();
    if (!value) {
      persistUrl('');
      setStatus('info', 'Sync URL cleared. Add one to enable sync.');
      updateButtonState();
      return;
    }
    try {
      const parsed = new URL(value);
      if (!/^https?:/.test(parsed.protocol)) throw new Error('Invalid protocol');
    } catch {
      setStatus('error', 'Enter a valid sync URL before saving.');
      return;
    }
    persistUrl(value);
    setStatus('online', 'Sync settings saved.');
    updateButtonState();
  });

  testSyncBtn?.addEventListener('click', async () => {
    const url = (syncUrlInput?.value || getStoredUrl()).trim();
    if (!url) {
      setStatus('error', 'Add your sync URL in Settings first.');
      return;
    }
    toggleBusy(true);
    setStatus('syncing', 'Testing connection…');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      if (response.ok) setStatus('online', 'Connection looks good.');
      else setStatus('error', 'Test failed. Check your Apps Script deployment.');
    } catch (error) {
      console.error('Test sync failed', error);
      setStatus('error', 'Test failed. Check your Apps Script deployment.');
    } finally {
      toggleBusy(false);
    }
  });

  syncAllBtn?.addEventListener('click', async () => {
    const url = (syncUrlInput?.value || getStoredUrl()).trim();
    if (!url) {
      setStatus('error', 'Add your sync URL in Settings first.');
      return;
    }
    const reminders = collectReminders();
    if (!reminders.length) {
      setStatus('info', 'Nothing to sync right now.');
      return;
    }
    toggleBusy(true);
    setStatus('syncing', `Syncing ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}…`);

    const chunkSize = 20;
    let okCount = 0;
    let failCount = 0;

    const makePayload = (reminder) => ({
      id: reminder.id,
      title: reminder.title,
      dueIso: reminder.dueIso || null,
      priority: reminder.priority || 'Medium',
      category: reminder.category || 'General',
      done: Boolean(reminder.done),
      source: 'memory-cue-mobile',
    });

    try {
      for (let index = 0; index < reminders.length; index += chunkSize) {
        const slice = reminders.slice(index, index + chunkSize);
        const results = await Promise.allSettled(slice.map((reminder) => fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(makePayload(reminder)),
        })));

        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value?.ok) okCount += 1;
          else failCount += 1;
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (!failCount) setStatus('online', `Sync complete. ${okCount} updated.`);
      else if (!okCount) setStatus('error', 'Sync failed. Check your sync URL and retry.');
      else setStatus('error', `Partial sync: ${okCount} success, ${failCount} failed.`);
    } catch (error) {
      console.error('Sync failed', error);
      setStatus('error', 'Sync failed. Try again soon.');
    } finally {
      toggleBusy(false);
    }
  });
};
