(function () {
  const VIEW_ORDER = ['capture', 'reminders', 'notebooks'];

  const normalizeViewName = (name) => {
    if (!name) return 'capture';
    const value = String(name).toLowerCase();
    if (value === 'notebook') return 'notebooks';
    if (value === 'notes') return 'notebooks';
    return value;
  };

  const getViewNodes = () => {
    const nodes = Array.from(document.querySelectorAll('[data-view]'));
    return nodes.filter((node) => VIEW_ORDER.includes(normalizeViewName(node.dataset.view)));
  };

  const updateActiveNav = (viewName) => {
    document.querySelectorAll('[data-nav-target]').forEach((button) => {
      const target = normalizeViewName(button.getAttribute('data-nav-target'));
      const active = target === viewName;
      button.classList.toggle('active', active);
      button.classList.toggle('nav-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  };

  const navigate = (requestedViewName) => {
    const viewName = normalizeViewName(requestedViewName);
    const viewNodes = getViewNodes();

    viewNodes.forEach((node) => {
      const nodeView = normalizeViewName(node.dataset.view);
      const isActive = nodeView === viewName;
      node.classList.toggle('hidden', !isActive);
      node.hidden = !isActive;
      node.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    document.body?.setAttribute('data-active-view', viewName);
    document.getElementById('main')?.setAttribute('data-active-view', viewName);
    updateActiveNav(viewName);

    window.dispatchEvent(new CustomEvent('memorycue:navigation:changed', { detail: { view: viewName } }));
    return viewName;
  };

  const navigationService = { navigate, VIEW_ORDER: [...VIEW_ORDER] };
  window.navigationService = navigationService;

  window.addEventListener('app:navigate', (event) => {
    const view = event?.detail?.view;
    if (!view) return;
    navigate(view);
  });

  const bindNavButtons = () => {
    document.querySelectorAll('[data-nav-target]').forEach((button) => {
      if (!(button instanceof HTMLElement) || button.dataset.navigationBound === 'true') {
        return;
      }

      button.dataset.navigationBound = 'true';
      button.addEventListener('click', (event) => {
        const targetView = button.getAttribute('data-nav-target');
        if (!targetView) {
          return;
        }

        event.preventDefault();
        navigate(targetView);
      });
    });
  };

  const init = () => {
    bindNavButtons();
    const initial = document.querySelector('[data-nav-target].active')?.getAttribute('data-nav-target') || 'capture';
    navigate(initial);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
