const groupedRoutes = new Set(['notes', 'resources', 'templates']);

function renderRoute() {
  const route = (window.location.hash || '#dashboard').replace('#', '');
  document.querySelectorAll('[data-route]').forEach((node) => {
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
  document
    .querySelectorAll('#nav-more-menu [data-nav], #mobile-more-menu [data-nav]')
    .forEach((link) => {
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

  document.querySelectorAll('.mobile-nav-more').forEach((details) => {
    const summary = details.querySelector('summary');
    if (!summary) {
      return;
    }
    if (isGroupedRoute) {
      details.setAttribute('open', '');
    } else {
      details.removeAttribute('open');
    }
    summary.classList.toggle('btn-active', isGroupedRoute);
    summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
    summary.classList.toggle('more-active', details.open);
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

  document.querySelectorAll('.mobile-nav-more').forEach((details) => {
    const summary = details.querySelector('summary');
    if (!summary) {
      return;
    }
    summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
    summary.classList.toggle('more-active', details.open);
    details.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', details.open ? 'true' : 'false');
      summary.classList.toggle('more-active', details.open);
    });
  });
}

function initRouter() {
  initGroupedNavHandlers();
  renderRoute();
}

window.addEventListener('hashchange', renderRoute);

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initRouter, { once: true });
} else {
  initRouter();
}
