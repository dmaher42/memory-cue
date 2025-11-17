const groupedRoutes = new Set(['notes', 'resources', 'templates']);
const workspaceRoutes = new Set(['reminders', 'planner', 'notes']);
const staticBreadcrumbs = new Map([
  ['dashboard', [{ label: 'Dashboard', href: '#dashboard' }]],
  ['workspace', [{ label: 'Workspace', href: '#workspace' }]],
  ['resources', [{ label: 'Resources', href: '#resources' }]],
  ['templates', [{ label: 'Templates', href: '#templates' }]],
]);

function getBreadcrumbsForRoute(route) {
  if (workspaceRoutes.has(route)) {
    const capitalised = route.charAt(0).toUpperCase() + route.slice(1);
    return [
      { label: 'Workspace', href: '#workspace' },
      { label: capitalised, href: `#${route}` },
    ];
  }
  if (staticBreadcrumbs.has(route)) {
    return staticBreadcrumbs.get(route);
  }
  if (groupedRoutes.has(route)) {
    const capitalised = route.charAt(0).toUpperCase() + route.slice(1);
    return [{ label: capitalised, href: `#${route}` }];
  }
  return [{ label: 'Dashboard', href: '#dashboard' }];
}

function updateWorkspaceBreadcrumbs(route) {
  const breadcrumbList = document.querySelector('[data-breadcrumb-list]');
  if (!breadcrumbList) {
    return;
  }

  breadcrumbList.innerHTML = '';
  const crumbs = getBreadcrumbsForRoute(route);
  crumbs.forEach((crumb, index) => {
    const listItem = document.createElement('li');
    listItem.className = 'workspace-breadcrumb';
    const isCurrent = index === crumbs.length - 1;
    if (isCurrent) {
      const current = document.createElement('span');
      current.className = 'badge workspace-breadcrumb__current';
      current.textContent = crumb.label;
      current.setAttribute('aria-current', 'page');
      listItem.appendChild(current);
    } else {
      const link = document.createElement('a');
      link.className = 'badge workspace-breadcrumb__link';
      link.textContent = crumb.label;
      link.href = crumb.href || '#';
      listItem.appendChild(link);
    }
    breadcrumbList.appendChild(listItem);
  });
}

function renderRoute() {
  const rawRoute = (window.location.hash || '#dashboard').replace('#', '');
  const activeRoute = rawRoute === '' ? 'dashboard' : rawRoute;
  const isWorkspaceView = workspaceRoutes.has(activeRoute) || activeRoute === 'workspace';
  const routeNodes = document.querySelectorAll('[data-route]');
  routeNodes.forEach((node) => {
    const nodeRoute = node.dataset.route;
    const isDashboardFallback = rawRoute === '' && nodeRoute === 'dashboard';
    const isWorkspaceSection = nodeRoute === 'workspace';
    const shouldShow =
      isDashboardFallback ||
      (!isWorkspaceView && nodeRoute === activeRoute) ||
      (isWorkspaceView && isWorkspaceSection);

    node.style.display = shouldShow ? '' : 'none';
    node.hidden = !shouldShow;
    node.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  });

  syncWorkspacePanels(activeRoute);

  document.querySelectorAll('[data-nav]').forEach((link) => {
    const isActive = link.dataset.nav === activeRoute;
    link.classList.toggle('btn-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  const isGroupedRoute = groupedRoutes.has(activeRoute);
  document.querySelectorAll('#nav-more-menu [data-nav]').forEach((link) => {
    const isActive = link.dataset.nav === activeRoute;
    link.classList.toggle('btn-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  const moreSummary = document.querySelector('[data-nav-group="more"]');
  const moreDetails = moreSummary ? moreSummary.closest('details') : null;
  if (moreSummary && moreDetails) {
    if (isGroupedRoute) {
      moreDetails.setAttribute('open', '');
    } else {
      moreDetails.removeAttribute('open');
    }
    moreSummary.classList.toggle('btn-active', isGroupedRoute);
    moreSummary.setAttribute('aria-expanded', moreDetails.open ? 'true' : 'false');
    moreSummary.classList.toggle('more-active', moreDetails.open);
  }

  updateWorkspaceBreadcrumbs(activeRoute);
}

function syncWorkspacePanels(route) {
  const workspace = document.querySelector('[data-workspace]');
  if (!workspace) {
    return;
  }

  const activePanel = workspaceRoutes.has(route) ? route : 'reminders';
  workspace.dataset.workspaceActive = activePanel;

  workspace.querySelectorAll('[data-workspace-panel]').forEach((panel) => {
    const isActive = panel.dataset.workspacePanel === activePanel;
    panel.hidden = !isActive;
    panel.classList.toggle('hidden', !isActive);
    panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
  });

  workspace.querySelectorAll('[data-workspace-tab]').forEach((tab) => {
    const isActive = tab.dataset.workspaceTab === activePanel;
    tab.classList.toggle('btn-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function initGroupedNavHandlers() {
  const navMoreDetails = document.querySelector('.nav-more-details');
  const navMoreSummary = document.querySelector('[data-nav-group="more"]');
  if (navMoreDetails && navMoreSummary) {
    navMoreSummary.setAttribute('aria-expanded', navMoreDetails.open ? 'true' : 'false');
    navMoreSummary.classList.toggle('more-active', navMoreDetails.open);
    navMoreDetails.addEventListener('toggle', () => {
      navMoreSummary.setAttribute('aria-expanded', navMoreDetails.open ? 'true' : 'false');
      navMoreSummary.classList.toggle('more-active', navMoreDetails.open);
    });
  }
}

function initMobileNavHandlers() {
  const navMobileDetails = document.querySelector('.nav-mobile');
  if (!navMobileDetails) {
    return;
  }

  const navMobileSummary = navMobileDetails.querySelector('.nav-mobile-summary');
  const syncExpanded = () => {
    if (navMobileSummary) {
      navMobileSummary.setAttribute('aria-expanded', navMobileDetails.open ? 'true' : 'false');
    }
  };

  syncExpanded();

  navMobileDetails.addEventListener('toggle', syncExpanded);

  const navMobileMoreDetails = navMobileDetails.querySelector('.nav-mobile-more');
  if (navMobileMoreDetails) {
    const navMobileMoreSummary = navMobileMoreDetails.querySelector('.nav-mobile-more-summary');
    const syncMobileMoreExpanded = () => {
      if (navMobileMoreSummary) {
        navMobileMoreSummary.setAttribute('aria-expanded', navMobileMoreDetails.open ? 'true' : 'false');
      }
    };

    syncMobileMoreExpanded();

    navMobileMoreDetails.addEventListener('toggle', syncMobileMoreExpanded);

    navMobileDetails.addEventListener('toggle', () => {
      if (!navMobileDetails.open) {
        navMobileMoreDetails.removeAttribute('open');
        syncMobileMoreExpanded();
      }
    });

    navMobileMoreDetails.querySelectorAll('[data-nav]').forEach((link) => {
      link.addEventListener('click', () => {
        navMobileMoreDetails.removeAttribute('open');
        syncMobileMoreExpanded();
      });
    });
  }

  navMobileDetails.querySelectorAll('[data-nav]').forEach((link) => {
    link.addEventListener('click', () => {
      navMobileDetails.removeAttribute('open');
      syncExpanded();
    });
  });
}

function initWorkspaceTabs() {
  const workspace = document.querySelector('[data-workspace]');
  if (!workspace) {
    return;
  }

  workspace.querySelectorAll('[data-workspace-tab]').forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      const targetRoute = tab.dataset.workspaceTab;
      if (!targetRoute) {
        return;
      }
      const targetHash = `#${targetRoute}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
        return;
      }
      renderRoute();
    });
  });
}

function initRouter() {
  initGroupedNavHandlers();
  initMobileNavHandlers();
  initWorkspaceTabs();
  renderRoute();
}

window.addEventListener('hashchange', renderRoute);

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initRouter, { once: true });
} else {
  initRouter();
}
