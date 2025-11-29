// docs/mobile.js — loader to expose a stable /mobile.js path for GitHub Pages
// Delegates to the hashed build asset in ./assets/
(function () {
  try {
    var src = './assets/mobile-AARWRGNU.js';
    var s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
    console.debug && console.debug('[docs/mobile.js] injected', src);
  } catch (err) {
    console.error('[docs/mobile.js] failed to inject runtime', err);
  }
})();
