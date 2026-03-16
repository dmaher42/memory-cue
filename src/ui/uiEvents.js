export const onDomReady = (handler) => {
  if (typeof handler !== 'function') return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handler, { once: true });
    return;
  }
  handler();
};

export const addDelegatedEvent = (eventName, selector, handler, options) => {
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (!(target instanceof HTMLElement)) return;
    handler(event, target);
  };
  document.addEventListener(eventName, listener, options);
  return () => document.removeEventListener(eventName, listener, options);
};
