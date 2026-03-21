(function () {
  const drawerBtn = document.getElementById('btn-open-drawer');
  const drawer = document.getElementById('mobile-drawer');
  const scrim = document.getElementById('mobile-drawer-scrim');
  const scrollTopBtn = document.getElementById('btn-scroll-top');
  const searchBtn = document.getElementById('btn-search');
  const drawerSyncStatus = document.getElementById('mcStatusText');
  const drawerSyncDot = document.getElementById('mcStatus');
  const quickAddPanel = document.getElementById('quickAddBar');
  const quickAddInputField = document.getElementById('reminderQuickAdd');
  const quickAddSelector = '[data-open-quick-add]';
  let activeQuickAddTrigger = null;
  const isPersistentQuickAdd =
    quickAddPanel instanceof HTMLElement && quickAddPanel.dataset.persistent === 'true';

  const toggleClass = (el, className, force) => {
    if (!el) return;
    if (typeof force === 'boolean') {
      el.classList.toggle(className, force);
    } else {
      el.classList.toggle(className);
    }
  };

  const setDrawerState = (open) => {
    if (!drawer) return;
    const isOpen = drawer.classList.contains('translate-x-0');
    const nextState = typeof open === 'boolean' ? open : !isOpen;
    if (nextState === isOpen) return;

    if (nextState) {
      drawer.inert = false;
      drawer.classList.add('translate-x-0');
      drawerBtn?.setAttribute('aria-expanded', 'true');
      if (scrim) {
        scrim.classList.remove('pointer-events-none');
        scrim.classList.remove('opacity-0');
        scrim.classList.add('opacity-100');
      }
      document.body.classList.add('overflow-hidden');
      if (!drawer.hasAttribute('data-focus-bound')) {
        drawer.setAttribute('data-focus-bound', 'true');
        drawer.focus({ preventScroll: true });
      } else {
        try {
          drawer.focus({ preventScroll: true });
        } catch {
          drawer.focus();
        }
      }
    } else {
      drawer.classList.remove('translate-x-0');
      drawerBtn?.setAttribute('aria-expanded', 'false');
      if (scrim) {
        scrim.classList.add('opacity-0');
        scrim.classList.add('pointer-events-none');
        scrim.classList.remove('opacity-100');
      }
      document.body.classList.remove('overflow-hidden');
      drawer.removeAttribute('data-focus-bound');
      if (drawerBtn instanceof HTMLElement) {
        try {
          drawerBtn.focus({ preventScroll: true });
        } catch {
          drawerBtn.focus();
        }
      }
      drawer.inert = true;
    }
  };

  drawerBtn?.addEventListener('click', () => setDrawerState());
  scrim?.addEventListener('click', () => setDrawerState(false));
  drawer?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-close-drawer]')) {
      setDrawerState(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setDrawerState(false);
    }
  });

  scrollTopBtn?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const isQuickAddVisible = () =>
    isPersistentQuickAdd || quickAddPanel?.dataset.visible === 'true';

  const showQuickAddPanel = (trigger) => {
    if (!(quickAddPanel instanceof HTMLElement)) {
      return false;
    }
    if (isPersistentQuickAdd) {
      if (quickAddInputField instanceof HTMLElement) {
        window.requestAnimationFrame(() => {
          try {
            quickAddInputField.focus({ preventScroll: true });
          } catch {
            quickAddInputField.focus();
          }
        });
      }
      return true;
    }
    activeQuickAddTrigger = trigger instanceof HTMLElement ? trigger : null;
    quickAddPanel.hidden = false;
    quickAddPanel.dataset.visible = 'true';
    quickAddPanel.setAttribute('aria-hidden', 'false');
    activeQuickAddTrigger?.setAttribute('aria-expanded', 'true');
    if (quickAddInputField instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        try {
          quickAddInputField.focus({ preventScroll: true });
        } catch {
          quickAddInputField.focus();
        }
      });
    }
    return true;
  };

  const hideQuickAddPanel = () => {
    if (!(quickAddPanel instanceof HTMLElement) || isPersistentQuickAdd) {
      return false;
    }
    if (quickAddPanel.dataset.visible !== 'true') {
      return false;
    }
    quickAddPanel.hidden = true;
    quickAddPanel.dataset.visible = 'false';
    quickAddPanel.setAttribute('aria-hidden', 'true');
    if (
      activeQuickAddTrigger instanceof HTMLElement &&
      document.body.contains(activeQuickAddTrigger)
    ) {
      activeQuickAddTrigger.setAttribute('aria-expanded', 'false');
      try {
        activeQuickAddTrigger.focus({ preventScroll: true });
      } catch {
        activeQuickAddTrigger.focus();
      }
    }
    activeQuickAddTrigger = null;
    return true;
  };

  document.addEventListener(
    'click',
    (event) => {
      if (!(quickAddPanel instanceof HTMLElement)) {
        return;
      }
      const trigger =
        event.target instanceof Element ? event.target.closest(quickAddSelector) : null;
      if (!trigger) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
      if (isPersistentQuickAdd) {
        showQuickAddPanel(trigger);
        return;
      }
      if (isQuickAddVisible()) {
        hideQuickAddPanel();
      } else {
        showQuickAddPanel(trigger);
      }
    },
    true,
  );

  document.addEventListener('reminder:quick-add:complete', hideQuickAddPanel);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isQuickAddVisible()) {
      hideQuickAddPanel();
    }
  });

  searchBtn?.addEventListener('click', () => {
    const el = document.getElementById('search') || document.querySelector('input[type="search"]');
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
  });

  const THEME_STORAGE_KEY = 'theme';
  const root = document.documentElement;

  const applyTheme = (nextTheme) => {
    const next = nextTheme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    root.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage might be unavailable */
    }
    toggleClass(document.getElementById('icon-sun'), 'hidden', next === 'dark');
    toggleClass(document.getElementById('icon-moon'), 'hidden', next !== 'dark');
  };

  const toggleTheme = () => {
    const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };

  const bindThemeButton = () => {
    const btn = document.getElementById('btn-theme');
    if (!(btn instanceof HTMLElement)) return false;
    if (btn.dataset.themeBound === 'true') return true;
    btn.dataset.themeBound = 'true';
    btn.addEventListener('click', toggleTheme);
    applyTheme(root.getAttribute('data-theme'));
    return true;
  };

  if (!bindThemeButton()) {
    document.addEventListener('DOMContentLoaded', bindThemeButton, { once: true });
  }

  window.__mcApplyTheme = applyTheme;
  window.__mcToggleTheme = toggleTheme;

  (function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (!saved) {
      saved = root.getAttribute('data-theme');
    }
    if (saved) {
      applyTheme(saved);
    }
  })();

  document.addEventListener('cue:sync-status', (event) => {
    const detail = event?.detail;
    if (!detail) return;
    if (typeof detail.message === 'string' && drawerSyncStatus) {
      drawerSyncStatus.textContent = detail.message;
    }
    if (typeof detail.state === 'string' && drawerSyncDot) {
      const isOnline = detail.state !== 'offline' && detail.state !== 'error';
      drawerSyncDot.classList.toggle('online', isOnline);
      drawerSyncDot.classList.toggle('offline', !isOnline);
    }
  });
})();

(function diagnoseHeaderAncestors() {
  function check() {
    const header = document.getElementById('reminders-slim-header');
    if (!header) {
      console.warn('[diagnose-header-ancestors] header not found');
      return;
    }

    const problems = [];
    let el = header.parentElement;
    while (el && el !== document.documentElement) {
      try {
        const cs = window.getComputedStyle(el);
        const hasTransform = cs.transform && cs.transform !== 'none';
        const hasFilter = (cs.filter && cs.filter !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none');
        const hasWillChange = cs.willChange && cs.willChange.indexOf('transform') !== -1;
        const hasContainPaint = cs.contain && (cs.contain.indexOf('paint') !== -1 || cs.contain.indexOf('layout') !== -1);

        if (hasTransform || hasFilter || hasWillChange || hasContainPaint) {
          problems.push({ el, transform: cs.transform, filter: cs.filter, backdropFilter: cs.backdropFilter, willChange: cs.willChange, contain: cs.contain });
          // visually mark the element so it's easy to find in devtools
          try { el.style.outline = '2px dashed rgba(255,0,0,0.7)'; } catch (e) { /* ignore */ }
          console.warn('[diagnose-header-ancestors] problematic ancestor found:', el, problems[problems.length-1]);
        }
      } catch (e) {
        console.warn('[diagnose-header-ancestors] error reading computed style for', el, e);
      }
      el = el.parentElement;
    }

    if (!problems.length) {
      console.info('[diagnose-header-ancestors] no transforms/filters/will-change/contain detected on header ancestors');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check, { once: true });
  } else {
    check();
  }
})();

(function monitorHeaderPosition(){
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function throttle(fn){
    let busy=false;
    return function(...args){ if(busy) return; busy=true; requestAnimationFrame(()=>{ fn(...args); busy=false; }); };
  }

  function attach() {
    const header = document.getElementById('reminders-slim-header');
    if(!header) return console.warn('[diagnose-header-scroll] header not found');

    let lastTop = header.getBoundingClientRect().top;
    let lastStyle = header.getAttribute('style') || '';
    let lastClass = header.className || '';

    const logIfChanged = throttle(()=>{
      try {
        const r = header.getBoundingClientRect();
        const top = Math.round(r.top);
        if (top !== lastTop) {
          console.info('[diagnose-header-scroll] header top changed', { previous: lastTop, now: top, rect: r });
          lastTop = top;
        }

        const s = header.getAttribute('style') || '';
        const c = header.className || '';
        if (s !== lastStyle) {
          console.info('[diagnose-header-scroll] header style changed', s);
          lastStyle = s;
        }
        if (c !== lastClass) {
          console.info('[diagnose-header-scroll] header class changed', c);
          lastClass = c;
        }
      } catch (e) {
        console.warn('[diagnose-header-scroll] error checking header', e);
      }
    });

    // Monitor window scroll and touch events
    window.addEventListener('scroll', logIfChanged, { passive: true });
    window.addEventListener('touchmove', logIfChanged, { passive: true });
    window.addEventListener('pointermove', logIfChanged, { passive: true });

    // Observe mutations to header attributes
    const mo = new MutationObserver((records)=>{
      records.forEach(r=>{
        if (r.type === 'attributes') {
          console.info('[diagnose-header-scroll] mutation observed', r.attributeName, header.getAttribute(r.attributeName));
        }
      });
    });
    mo.observe(header, { attributes: true, attributeFilter: ['style','class'] });

    // Also watch potential scroll containers
    const containers = document.querySelectorAll('main, [data-view], .mobile-view-inner, .reminders-content-shell');
    containers.forEach(c=>{
      try { c.addEventListener('scroll', logIfChanged, { passive: true }); } catch(e){}
    });

    console.info('[diagnose-header-scroll] monitoring attached');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
})();

// Global navigation handler (Phase 3): use navigationService as the single view controller.
(function () {
  const triggerReminderQuickAdd = window.triggerReminderQuickAdd || function triggerReminderQuickAdd() {
    const quickAddTrigger =
      document.getElementById('mobile-footer-new-reminder') ||
      document.querySelector('[data-open-add-task]');

    if (quickAddTrigger) {
      const detail = { mode: 'create', trigger: quickAddTrigger };
      document.dispatchEvent(new CustomEvent('cue:prepare', { detail }));
      document.dispatchEvent(new CustomEvent('cue:open', { detail }));
      return;
    }

    const quickAdd = document.getElementById('thinkingBarInput') || document.getElementById('reminderQuickAdd') || document.getElementById('quickAdd');
    if (quickAdd && typeof quickAdd.focus === 'function') quickAdd.focus();
  };

  window.triggerReminderQuickAdd = triggerReminderQuickAdd;

  window.addEventListener('app:navigate', (ev) => {
    const view = ev?.detail?.view;
    if (!view || !window.navigationService?.navigate) return;
    const activeView = window.navigationService.navigate(view);

    if (activeView === 'capture') {
      const captureInput = document.getElementById('thinkingBarInput') || document.getElementById('captureInput');
      if (captureInput && typeof captureInput.focus === 'function') captureInput.focus();
    }

    if (activeView === 'notebooks' && typeof window.renderNotebookList === 'function') {
      window.renderNotebookList();
    }
  });
})();

(function() {
  const navFooter = document.querySelector('#mobile-nav-shell .floating-footer');
  const fabButton = document.getElementById('mobile-fab-button');
  const fabMenu = document.getElementById('mobile-fab-menu');

  const updateBottomNavHeight = () => {
    if (!navFooter) return;
    const footerRect = navFooter.getBoundingClientRect();
    const styles = getComputedStyle(navFooter);
    const marginBottom = parseFloat(styles.marginBottom) || 0;
    const totalHeight = footerRect.height + marginBottom;

    if (totalHeight > 0) {
      document.documentElement.style.setProperty(
        '--mobile-bottom-nav-height',
        `${Math.ceil(totalHeight)}px`
      );
    }
  };

  updateBottomNavHeight();

  if (navFooter) {
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateBottomNavHeight);
      observer.observe(navFooter);
    } else {
      window.addEventListener('resize', updateBottomNavHeight, { passive: true });
    }
  }

  const focusNotebookInputs = () => {
    // Do not auto-focus notebook fields on navigation to avoid opening mobile keyboards.
  };

  const closeSavedNotesSheet = () => {
    try {
      if (typeof window.hideSavedNotesSheet === 'function') {
        window.hideSavedNotesSheet();
      }
    } catch (error) {
      console.warn(error);
    }
  };

  const setActiveFooterIcon = (buttonId) => {
    document
      .querySelectorAll('#mobile-nav-shell .floating-card')
      .forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        const isActive = btn.id === buttonId;
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('nav-active', isActive);
      });
  };

  const triggerAddReminder = (trigger) => {
    const openQuickAddFallback = () => {
      if (typeof window.triggerReminderQuickAdd === 'function') {
        window.triggerReminderQuickAdd();
        return;
      }

      const quickAdd = document.getElementById('reminderQuickAdd') || document.getElementById('quickAdd');
      if (quickAdd && typeof quickAdd.focus === 'function') {
        quickAdd.focus();
      }
    };

    if (typeof window.openNewReminderSheet === 'function') {
      window.openNewReminderSheet(trigger || null);
    } else {
      const detail = { mode: 'create', trigger: trigger || null };
      const sheet = document.getElementById('create-sheet');

      if (sheet) {
        document.dispatchEvent(new CustomEvent('cue:prepare', { detail }));
        document.dispatchEvent(new CustomEvent('cue:open', { detail }));
      } else {
        openQuickAddFallback();
      }
    }
  };

  const navigateToNotebook = () => {
    window.dispatchEvent(
      new CustomEvent('app:navigate', {
        detail: { view: 'notebooks' }
      })
    );
    setActiveFooterIcon('mobile-footer-notebooks');
    focusNotebookInputs();
    closeSavedNotesSheet();
  };

  const closeFabMenu = () => {
    if (fabMenu instanceof HTMLElement) {
      fabMenu.dataset.open = 'false';
      fabMenu.setAttribute('aria-hidden', 'true');
      fabMenu.setAttribute('hidden', '');
    }
    if (fabButton instanceof HTMLElement) {
      fabButton.setAttribute('aria-expanded', 'false');
    }
  };

  const openFabMenu = () => {
    if (fabMenu instanceof HTMLElement) {
      fabMenu.dataset.open = 'true';
      fabMenu.setAttribute('aria-hidden', 'false');
      fabMenu.removeAttribute('hidden');
    }
    if (fabButton instanceof HTMLElement) {
      fabButton.setAttribute('aria-expanded', 'true');
    }
  };

  fabButton?.addEventListener('click', (event) => {
    event.preventDefault();
    const isOpen = fabMenu?.dataset.open === 'true';
    if (isOpen) {
      closeFabMenu();
    } else {
      openFabMenu();
    }
  });

  fabMenu?.addEventListener('click', (event) => {
    const actionButton = event.target instanceof Element ? event.target.closest('[data-fab-action]') : null;
    if (!actionButton) return;

    event.preventDefault();
    const action = actionButton.getAttribute('data-fab-action');
    closeFabMenu();

    if (action === 'new-reminder') {
      triggerAddReminder(actionButton);
      return;
    }

    if (action === 'new-note') {
      navigateToNotebook();
    }
  });

  document.addEventListener('click', (event) => {
    if (fabMenu?.dataset.open !== 'true') return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('#mobile-fab-container')) return;
    closeFabMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeFabMenu();
    }
  });

  navFooter?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-nav-target]') : null;
    if (!button) return;

    const view = button.getAttribute('data-nav-target');
    if (!view) return;

    closeFabMenu();
    setActiveFooterIcon(button.id);

        if (view === 'notebooks') {
      window.dispatchEvent(new CustomEvent('memorycue:notes:mode', { detail: { mode: 'notebooks' } }));
      navigateToNotebook();
      setActiveFooterIcon('mobile-footer-notebooks');
      return;
    }

    closeSavedNotesSheet();
    window.dispatchEvent(
      new CustomEvent('app:navigate', {
        detail: { view }
      })
    );
  });
})();

(function() {
  // Identify reminders view container and header
  const remindersSection = document.querySelector('section[data-view="reminders"]');
  if (!remindersSection) return;

  const header = remindersSection.querySelector('header') || remindersSection.querySelector('.reminders-header');
  const scrollContainer =
    remindersSection.querySelector('.reminders-scroll-container') ||
    remindersSection.querySelector('#reminders-list') ||
    remindersSection;

  if (!(header instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) {
    return;
  }

  // SAFETY:
  // Do NOT rename elements. We check multiple fallbacks.
  // Whichever scrollable container exists will trigger the shadow.

  scrollContainer.addEventListener('scroll', function() {
    if (scrollContainer.scrollTop > 2) {
      header.classList.add('header-shadow');
    } else {
      header.classList.remove('header-shadow');
    }
  });
})();

document.addEventListener('DOMContentLoaded', function () {
  // Support both original and slim variants
  var menuBtn =
    document.getElementById('overflowMenuBtn') ||
    document.getElementById('headerMenuBtnSlim') ||
    document.getElementById('headerMenuBtn');
  var menu =
    document.getElementById('overflowMenu') ||
    document.getElementById('headerMenuSlim') ||
    document.getElementById('headerMenu');

  // Skip binding when any newer controller has already claimed the menu.
  // The canonical owner now lives in src/ui/mobileShellUi.js.
  if (!menuBtn || !menu || menuBtn.dataset.overflowMenuHandled) return;

  var isClaimedByAnotherController = function () {
    return !!menuBtn.dataset.overflowMenuHandled;
  };

  var isOpen = function () {
    return menuBtn.getAttribute('aria-expanded') === 'true';
  };

  var openMenu = function () {
    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
  };

  var closeMenu = function () {
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
  };

  // Toggle on button click (tap)
  menuBtn.addEventListener('click', function (ev) {
    if (isClaimedByAnotherController()) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (isOpen()) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close when tapping outside the menu
  document.addEventListener('click', function (ev) {
    if (isClaimedByAnotherController()) {
      return;
    }
    var target = ev.target;
    if (!menu.contains(target) && target !== menuBtn) {
      closeMenu();
    }
  });

  // Optional: close on Escape for accessibility
  document.addEventListener('keydown', function (ev) {
    if (isClaimedByAnotherController()) {
      return;
    }
    if (ev.key === 'Escape' && isOpen()) {
      closeMenu();
    }
  });
});
