const groupedRoutes = new Set(['notes', 'resources', 'templates']);

function renderRoute() {
  const route = (window.location.hash || '#dashboard').replace('#', '');
  const workspace = document.querySelector('[data-workspace]');
  const routeNodes = workspace ? workspace.querySelectorAll('[data-route]') : document.querySelectorAll('[data-route]');
  routeNodes.forEach((node) => {
    const isDashboardFallback = route === '' && node.dataset.route === 'dashboard';
    node.style.display = node.dataset.route === route || isDashboardFallback ? '' : 'none';
  });

  const activeRoute = route === '' ? 'dashboard' : route;
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

function initRouter() {
  initGroupedNavHandlers();
  initMobileNavHandlers();
  renderRoute();
}

window.addEventListener('hashchange', renderRoute);

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initRouter, { once: true });
} else {
  initRouter();
}
