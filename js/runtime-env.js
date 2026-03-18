window.__ENV = {
  ...(window.__ENV && typeof window.__ENV === 'object' && !Array.isArray(window.__ENV) ? window.__ENV : {}),
  
};

window.textureUrl =
  window.textureUrl ||
  ((filename) => {
    if (typeof filename !== 'string') {
      return '';
    }

    return filename;
  });
