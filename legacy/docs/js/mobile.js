// docs/js/mobile.js — loader that delegates to the hashed build asset
// This ensures GitHub Pages can serve a stable path at /js/mobile.js
(function () {
  try {
    var src = './assets/mobile-AARWRGNU.js';
    var s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
    // small console hint to help debugging in production
    if (window && window.console && typeof window.console.debug === 'function') {
      console.debug('[docs/js/mobile.js] injected', src);
    }
  } catch (err) {
    console.error('[docs/js/mobile.js] failed to inject runtime', err);
  }
})();
