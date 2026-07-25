/*
LEGACY HASH ROUTER (DEPRECATED)
The active mobile runtime uses js/services/navigation-service-v2.js.
This file remains only as a compatibility no-op for the legacy 404.html shell.
*/

(function () {
  window.renderRoute = function renderRoute() {
    if (window.navigationService && typeof window.navigationService.navigate === 'function') {
      const current = document.body?.getAttribute('data-active-view') || 'capture';
      window.navigationService.navigate(current);
    }
  };
})();
