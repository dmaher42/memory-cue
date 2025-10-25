import { initReminders } from './js/reminders.js';

/* BEGIN GPT CHANGE: tabbed navigation */
(function () {
  const views = {
    reminders: document.querySelector('[data-view="reminders"]'),
    today: document.querySelector('[data-view="today"]'),
    notebook: document.querySelector('[data-view="notebook"]'),
  };
  const nav = document.querySelector('.btm-nav');
  if (!nav || !views.reminders || !views.today || !views.notebook) return;
  const btns = Array.from(nav.querySelectorAll('button')).slice(0, 3);
  const order = ['reminders', 'today', 'notebook'];

  const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function show(target) {
    if (!order.includes(target)) return;
    Object.entries(views).forEach(([key, el]) => {
      if (!el) return;
      const isActive = key === target;
      el.classList.toggle('hidden', !isActive);
      el.setAttribute('aria-hidden', String(!isActive));
    });
    btns.forEach((button, index) => {
      const isActive = order[index] === target;
      button.setAttribute('aria-current', isActive ? 'page' : 'false');
      button.classList.toggle('active', isActive);
    });
    const skip = document.querySelector('a[href="#main"]');
    const main = document.getElementById('main') || document.querySelector('main');
    if (skip && main) {
      main.setAttribute('data-active-view', target);
    }
    requestAnimationFrame(() => {
      const behavior = reduceMotion?.matches ? 'auto' : 'smooth';
      try {
        window.scrollTo({ top: 0, behavior });
      } catch {
        window.scrollTo(0, 0);
      }
    });
  }

  btns.forEach((button, index) => {
    button.addEventListener('click', () => {
      show(order[index]);
    });
  });

  document.querySelectorAll('[data-jump-view]').forEach((control) => {
    control.addEventListener('click', () => {
      const target = control.getAttribute('data-jump-view');
      if (!target) return;
      show(target);
    });
  });

  document.querySelectorAll('[data-scroll-target]').forEach((control) => {
    control.addEventListener('click', () => {
      const targetId = control.getAttribute('data-scroll-target');
      if (!targetId) return;
      const el = document.getElementById(targetId);
      if (!el) return;
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        el.scrollIntoView(true);
      }
    });
  });

  show('reminders');
})();
/* END GPT CHANGE */

/* BEGIN GPT CHANGE: bottom sheet open/close */
(function () {
  const fab = document.getElementById('fabCreate');
  const sheet = document.getElementById('create-sheet');
  const closeBtn = document.getElementById('closeCreateSheet');
  if (!sheet || !closeBtn) return;

  sheet.classList.add('hidden');
  sheet.setAttribute('hidden', '');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.removeAttribute('open');

  const openerSet = new Set();
  if (fab) openerSet.add(fab);
  document
    .querySelectorAll('[data-open-add-task]')
    .forEach((button) => openerSet.add(button));

  const openers = Array.from(openerSet).filter((button) =>
    button instanceof HTMLElement
  );

  let lastTrigger = null;

  const prioritySelect = document.getElementById('priority');
  const chips = document.getElementById('priorityChips');
  if (prioritySelect && chips) {
    const radios = Array.from(chips.querySelectorAll('input[name="priority"]'));
    let lastPriority = prioritySelect.value || 'Medium';

    const syncRadios = (value) => {
      radios.forEach((radio) => {
        radio.checked = radio.value === value;
      });
    };

    const syncFromSelect = () => {
      const value = prioritySelect.value || 'Medium';
      lastPriority = value;
      syncRadios(value);
    };

    radios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        if (prioritySelect.value !== radio.value) {
          prioritySelect.value = radio.value;
          lastPriority = radio.value;
          prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    prioritySelect.addEventListener('change', syncFromSelect);
    syncFromSelect();

    const watcher = setInterval(() => {
      if (!document.body.contains(prioritySelect)) {
        clearInterval(watcher);
        return;
      }
      if (prioritySelect.value !== lastPriority) {
        syncFromSelect();
      }
    }, 250);
  }

  function openSheet(trigger) {
    lastTrigger = trigger ?? null;
    sheet.classList.remove('hidden');
    sheet.removeAttribute('hidden');
    sheet.setAttribute('aria-hidden', 'false');
    sheet.setAttribute('open', '');
    const firstInput = sheet.querySelector('input,select,textarea,button');
    if (firstInput instanceof HTMLElement) {
      firstInput.focus();
    } else if (sheet instanceof HTMLElement) {
      sheet.focus();
    }
  }
  function closeSheet() {
    sheet.classList.add('hidden');
    sheet.setAttribute('hidden', '');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.removeAttribute('open');
    const focusTarget =
      (lastTrigger && document.body.contains(lastTrigger) && lastTrigger) || fab;
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
    lastTrigger = null;
  }

  openers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSheet(trigger);
    });
  });

  closeBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeSheet();
  });
  sheet.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.matches('[data-close]')) {
      closeSheet();
    }
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSheet();
    }
  });

  document.addEventListener('cue:open', () => {
    openSheet();
  });
  document.addEventListener('cue:close', () => {
    closeSheet();
  });

  if (typeof window !== 'undefined') {
    window.closeAddTask = closeSheet;
  }
})();
/* END GPT CHANGE */

initReminders({
  qSel: '#searchReminders',
  titleSel: '#reminderText',
  dateSel: '#reminderDate',
  timeSel: '#reminderTime',
  detailsSel: '#reminderDetails',
  prioritySel: '#priority',
  categorySel: '#category',
  saveBtnSel: '#saveReminder',
  cancelEditBtnSel: '#cancelEditBtn',
  listSel: '#reminderList',
  statusSel: '#statusMessage',
  syncStatusSel: '#syncStatus',
  voiceBtnSel: '#voiceBtn',
  notifBtnSel: '#notifBtn',
  addQuickBtnSel: '#quickAdd',
  filterBtnsSel: '[data-filter]',
  categoryFilterSel: '#categoryFilter',
  categoryOptionsSel: '#categorySuggestions',
  countTodaySel: '#todayCount',
  countOverdueSel: '#overdueCount',
  countTotalSel: '#totalCountBadge, #totalCount',
  countCompletedSel: '#completedCount',
  defaultFilter: 'all',
  googleSignInBtnSel: '#googleSignInBtn',
  googleSignOutBtnSel: '#googleSignOutBtn',
  googleAvatarSel: '#googleAvatar',
  googleUserNameSel: '#googleUserName',
  syncAllBtnSel: '#syncAll',
  syncUrlInputSel: '#syncUrl',
  saveSettingsSel: '#saveSyncSettings',
  testSyncSel: '#testSync',
  openSettingsSel: '#openSettings',
  emptyStateSel: '#emptyState',
  listWrapperSel: '#remindersWrapper',
  notesSel: '#notes',
  saveNotesBtnSel: '#saveNotes',
  loadNotesBtnSel: '#loadNotes',
  dateFeedbackSel: '#dateFeedback',
  variant: 'mobile',
}).catch((error) => {
  console.error('Failed to initialise reminders:', error);
});

document.addEventListener('memoryCue:remindersUpdated', (event) => {
  const totalCountEl = document.getElementById('totalCount');
  if (!totalCountEl) return;
  const total = Array.isArray(event?.detail?.items) ? event.detail.items.length : 0;
  totalCountEl.textContent = String(total);
});

/* BEGIN GPT CHANGE: today view population */
(function () {
  const todayEl = document.querySelector('[data-view="today"]');
  const listEl = document.getElementById('reminderList');
  if (!todayEl || !listEl) return;

  function isToday(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
  }

  function renderToday() {
    const items = Array.from(listEl.querySelectorAll('[data-reminder]'));
    const todayItems = items.filter((item) => {
      const direct = item.getAttribute('data-due');
      const nested = item.querySelector('[data-due]');
      const when = direct || (nested ? nested.textContent : '') || '';
      return isToday(when.trim());
    });

    todayEl.innerHTML = '';
    const header = document.createElement('h2');
    header.textContent = 'Today';
    todayEl.appendChild(header);

    todayItems.forEach((item) => {
      todayEl.appendChild(item.cloneNode(true));
    });

    if (!todayItems.length) {
      const p = document.createElement('p');
      p.textContent = 'No reminders due today.';
      todayEl.appendChild(p);
    }
  }

  document.addEventListener('DOMContentLoaded', renderToday);
  document.addEventListener('reminders:updated', renderToday);
})();
/* END GPT CHANGE */

/* BEGIN GPT CHANGE: progressive list loading */
(function () {
  const list = document.getElementById('reminderList');
  if (!list) return;

  const all = Array.from(list.children);
  if (all.length <= 30) return;
  const PAGE_SIZE = 20;
  list.innerHTML = '';
  let index = 0;

  function appendPage() {
    const slice = all.slice(index, index + PAGE_SIZE);
    slice.forEach((node) => list.appendChild(node));
    index += slice.length;
  }

  appendPage();
  const sentinel = document.createElement('div');
  sentinel.id = 'listSentinel';
  list.appendChild(sentinel);

  const io = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && index < all.length) {
      appendPage();
      if (index >= all.length) io.disconnect();
    }
  });
  io.observe(sentinel);
})();
/* END GPT CHANGE */

/* BEGIN GPT CHANGE: settings modal wiring */
(function () {
  const openBtn = document.querySelector('[data-open="settings"]') || document.getElementById('openSettings');
  const modal = document.getElementById('settingsModal');
  const closeBtn = document.getElementById('closeSettings');
  if (!openBtn || !modal || !closeBtn) return;

  function open() {
    modal.classList.remove('hidden');
  }
  function close() {
    modal.classList.add('hidden');
  }

  openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.matches('[data-close]')) {
      close();
    }
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });
})();
/* END GPT CHANGE */

/* BEGIN GPT CHANGE: sync controls */
(function () {
  const syncStatusEl = document.getElementById('syncStatus');
  const syncUrlInput = document.getElementById('syncUrl');
  const saveSettingsBtn = document.getElementById('saveSyncSettings');
  const testSyncBtn = document.getElementById('testSync');
  const syncAllBtn = document.getElementById('syncAll');
  const STORAGE_KEY = 'syncUrl';

  if (!syncStatusEl) return;

  const ACTIVE_CLASSES = ['online', 'error'];
  let currentState = null;

  function setStatus(state, message) {
    currentState = state;
    ACTIVE_CLASSES.forEach((cls) => syncStatusEl.classList.remove(cls));

    if (state === 'online') {
      syncStatusEl.classList.add('online');
    } else if (state === 'error') {
      syncStatusEl.classList.add('error');
    }

    const defaultMessage = {
      checking: 'Checking connection…',
      syncing: 'Syncing your latest changes…',
      online: 'Connected. Changes sync automatically.',
      offline: "You're offline. Changes are saved on this device until you reconnect.",
      error: "We couldn't sync right now. We'll retry soon.",
      info: '',
    };

    const text = typeof message === 'string' && message.trim() ? message : (defaultMessage[state] || '');
    if (text) {
      syncStatusEl.textContent = text;
    }
    syncStatusEl.dataset.state = state;
  }

  function updateOnlineState() {
    if (currentState === 'syncing') return;
    if (navigator.onLine) {
      if (currentState !== 'online') {
        setStatus('online');
      }
    } else {
      setStatus('offline');
    }
  }

  function persistUrl(value) {
    if (typeof localStorage === 'undefined') return;
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
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
    const title = typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim()
      : (typeof raw.name === 'string' ? raw.name.trim() : '');
    if (!title) return null;

    const dueIso = typeof raw.dueIso === 'string' && raw.dueIso
      ? raw.dueIso
      : (typeof raw.due === 'string' ? raw.due : null);

    const priority = typeof raw.priority === 'string' && raw.priority.trim()
      ? raw.priority.trim()
      : (raw.level || raw.importance || 'Medium');

    const category = typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : (raw.group || raw.bucket || 'General');

    const done = typeof raw.done === 'boolean'
      ? raw.done
      : Boolean(raw.completed || raw.isDone || raw.status === 'done');

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

    return elements
      .map((el) => {
        const dataset = el.dataset || {};
        let raw = null;

        if (dataset.reminder) {
          try {
            raw = JSON.parse(dataset.reminder);
          } catch {
            raw = null;
          }
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
          if (titleEl) {
            candidate.title = titleEl.textContent.trim();
          }
        }

        if (!candidate.dueIso) {
          const dueEl = el.querySelector('[data-due], time');
          if (dueEl) {
            const attr = dueEl.getAttribute('datetime') || dueEl.getAttribute('data-due');
            candidate.dueIso = attr || dueEl.textContent.trim();
          }
        }

        return normaliseReminder(candidate);
      })
      .filter(Boolean);
  }

  function collectFromStorage() {
    if (typeof localStorage === 'undefined') return [];
    const reminders = [];
    const triedKeys = new Set();
    const preferredKeys = [
      'memoryCue.reminders.v1',
      'memoryCue.reminders',
      'memoryCueMobile.reminders',
      'memoryCue.reminders.cache',
      'reminders',
    ];

    preferredKeys.forEach((key) => {
      if (triedKeys.has(key)) return;
      triedKeys.add(key);
      try {
        const value = localStorage.getItem(key);
        if (!value) return;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => reminders.push(item));
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
          if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
        }
      } catch {
        // ignore invalid storage entries
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
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => reminders.push(item));
          } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
            if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
          }
        } catch {
          // ignore
        }
      }
    }

    return reminders.map(normaliseReminder).filter(Boolean);
  }

  function collectReminders() {
    const fromDom = collectFromDom();
    if (fromDom.length) return fromDom;
    return collectFromStorage();
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
  if (syncUrlInput && storedUrl) {
    syncUrlInput.value = storedUrl;
  }

  updateButtonState();
  setStatus(navigator.onLine ? 'online' : 'offline');

  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);

  syncUrlInput?.addEventListener('input', updateButtonState);

  saveSettingsBtn?.addEventListener('click', () => {
    const value = (syncUrlInput?.value || '').trim();
    if (!value) {
      persistUrl('');
      setStatus('info', 'Sync URL cleared. Add a new one to enable syncing.');
      updateButtonState();
      return;
    }

    try {
      const parsed = new URL(value);
      if (!/^https?:/.test(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      setStatus('error', 'Enter a valid Apps Script URL before saving.');
      return;
    }

    persistUrl(value);
    setStatus('online', 'Sync settings saved.');
    updateButtonState();
  });

  testSyncBtn?.addEventListener('click', async () => {
    const url = (syncUrlInput?.value || getStoredUrl()).trim();
    if (!url) {
      setStatus('error', 'Add your Apps Script URL in Settings first.');
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
      if (response.ok) {
        setStatus('online', 'Connection looks good.');
      } else {
        setStatus('error', 'Test failed. Please check your Apps Script deployment.');
      }
    } catch (error) {
      console.error('Test sync failed', error);
      setStatus('error', 'Test failed. Please check your Apps Script deployment.');
    } finally {
      toggleBusy(false);
    }
  });

  syncAllBtn?.addEventListener('click', async () => {
    const url = (syncUrlInput?.value || getStoredUrl()).trim();
    if (!url) {
      setStatus('error', 'Add your Apps Script URL in Settings first.');
      return;
    }

    const reminders = collectReminders();
    if (!reminders.length) {
      setStatus('info', 'No reminders to sync right now.');
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
        const results = await Promise.allSettled(slice.map((reminder) => (
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makePayload(reminder)),
          })
        )));

        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value?.ok) {
            okCount += 1;
          } else if (result.status === 'fulfilled') {
            failCount += 1;
          } else {
            failCount += 1;
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (!failCount) {
        setStatus('online', `Sync complete. ${okCount} reminder${okCount === 1 ? '' : 's'} updated.`);
      } else if (!okCount) {
        setStatus('error', 'Sync failed. Please check your Apps Script URL and try again.');
      } else {
        setStatus('error', `Partial sync: ${okCount} success, ${failCount} failed.`);
      }
    } catch (error) {
      console.error('Sync failed', error);
      setStatus('error', 'Sync failed. Please try again in a moment.');
    } finally {
      toggleBusy(false);
    }
  });
})();
/* END GPT CHANGE */
