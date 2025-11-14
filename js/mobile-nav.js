function initMobileNav() {
  const toggleButton = document.getElementById('mobile-nav-toggle');
  const mobileMenu = document.getElementById('mobile-nav-menu');

  if (!toggleButton || !mobileMenu) {
    return;
  }

  toggleButton.addEventListener('click', () => {
    const isHidden = mobileMenu.hasAttribute('hidden');

    if (isHidden) {
      mobileMenu.removeAttribute('hidden');
      toggleButton.setAttribute('aria-expanded', 'true');
    } else {
      mobileMenu.setAttribute('hidden', '');
      toggleButton.setAttribute('aria-expanded', 'false');
    }
  });

  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      mobileMenu.setAttribute('hidden', '');
      toggleButton.setAttribute('aria-expanded', 'false');
      const parentDetails = link.closest('details');
      if (parentDetails) {
        parentDetails.removeAttribute('open');
        const summary = parentDetails.querySelector('summary');
        if (summary) {
          summary.setAttribute('aria-expanded', 'false');
          summary.classList.remove('more-active');
        }
      }
    });
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initMobileNav, { once: true });
} else {
  initMobileNav();
}
