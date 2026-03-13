/*
LEGACY HASH ROUTER (DEPRECATED)
Phase 3 unified runtime navigation uses js/services/navigation-service.js.
This file remains as a compatibility no-op for legacy shells.
*/

(function () {
  window.renderRoute = function renderRoute() {
    if (window.navigationService && typeof window.navigationService.navigate === 'function') {
      const current = document.body?.getAttribute('data-active-view') || 'capture';
      window.navigationService.navigate(current);
    }
  };
})();
