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
  if (!fab || !sheet || !closeBtn) return;

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

  function openSheet() {
    sheet.classList.remove('hidden');
    const firstInput = sheet.querySelector('input,select,textarea,button');
    if (firstInput) firstInput.focus();
  }
  function closeSheet() {
    sheet.classList.add('hidden');
    fab.focus();
  }
  fab.addEventListener('click', openSheet);
  closeBtn.addEventListener('click', closeSheet);
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
})();
/* END GPT CHANGE */

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
