const CSS_VARIABLE = '--vh';
const CSS_VARIABLE_FALLBACK = '1vh';

let isInitialised = false;
let activeTeardown = null;

function supportsCssCustomProperties() {
  if (typeof window === 'undefined') return false;
  const { CSS } = window;
  if (!CSS || typeof CSS.supports !== 'function') {
    return false;
  }
  try {
    return CSS.supports('--fake-var', '1px');
  } catch (error) {
    console.warn('Memory Cue: CSS.supports threw while checking custom property support', error);
    return false;
  }
}

function getViewportUnit() {
  if (typeof window === 'undefined') return null;
  const height = window.innerHeight;
  if (typeof height !== 'number' || Number.isNaN(height) || height <= 0) {
    return null;
  }
  return `${height * 0.01}px`;
}

export function initViewportHeight() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const root = document.documentElement;
  if (!root || root.nodeType !== 1) {
    return () => {};
  }

  if (isInitialised) {
    return activeTeardown || (() => {});
  }

  const canUseCustomProperties = supportsCssCustomProperties();
  if (!canUseCustomProperties) {
    root.style.removeProperty(CSS_VARIABLE);
    return () => {};
  }

  let frame = null;
  const setViewportUnit = () => {
    const value = getViewportUnit();
    if (value) {
      root.style.setProperty(CSS_VARIABLE, value);
    }
  };

  const scheduleUpdate = () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
    }
    frame = window.requestAnimationFrame(() => {
      frame = null;
      setViewportUnit();
    });
  };

  const onResize = () => scheduleUpdate();
  const onOrientationChange = () => scheduleUpdate();

  setViewportUnit();

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onOrientationChange);

  const visualViewport = window.visualViewport;
  if (visualViewport) {
    visualViewport.addEventListener('resize', scheduleUpdate, { passive: true });
    visualViewport.addEventListener('scroll', scheduleUpdate, { passive: true });
  }

  const onFocus = () => scheduleUpdate();
  window.addEventListener('focus', onFocus, true);

  isInitialised = true;

  const teardown = () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }

    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onOrientationChange);
    window.removeEventListener('focus', onFocus, true);

    if (visualViewport) {
      visualViewport.removeEventListener('resize', scheduleUpdate);
      visualViewport.removeEventListener('scroll', scheduleUpdate);
    }
    isInitialised = false;
    activeTeardown = null;
  };

  activeTeardown = teardown;

  return teardown;
}

export function updateViewportHeight() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (!root || root.nodeType !== 1) {
    return;
  }
  const value = getViewportUnit();
  if (value) {
    root.style.setProperty(CSS_VARIABLE, value);
  }
}

export const viewportHeightVariable = {
  name: CSS_VARIABLE,
  fallback: CSS_VARIABLE_FALLBACK,
};
