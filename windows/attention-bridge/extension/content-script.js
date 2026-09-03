(() => {
  'use strict';

  const MESSAGE_SOURCE = 'memory-cue';
  const MESSAGE_TYPE = 'memoryCue:windowsAttention';
  const ALLOWED_ACTIONS = new Set(['urgent', 'acknowledged', 'clear']);
  const ALLOWED_HOSTS = new Set(['memory-cue.pages.dev', 'localhost', '127.0.0.1']);
  const SAFE_STAGE = /^[A-Za-z0-9:_-]{1,32}$/;

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function normalizeCommand(value) {
    if (!isPlainObject(value)) return null;
    if (value.source !== MESSAGE_SOURCE || value.type !== MESSAGE_TYPE) return null;
    if (!ALLOWED_ACTIONS.has(value.action)) return null;
    if (!Number.isInteger(value.count) || value.count < 0 || value.count > 999) return null;
    if ((value.action === 'urgent' || value.action === 'acknowledged') && value.count === 0) return null;
    if (value.action === 'clear' && value.count !== 0) return null;
    if (value.stage !== undefined && (typeof value.stage !== 'string' || !SAFE_STAGE.test(value.stage))) return null;

    const command = {
      action: value.action,
      count: value.count,
    };
    if (value.stage !== undefined) command.stage = value.stage;
    return command;
  }

  if (!ALLOWED_HOSTS.has(window.location.hostname.toLowerCase())) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const command = normalizeCommand(event.data);
    if (!command) return;

    chrome.runtime.sendMessage(
      { type: MESSAGE_TYPE, command },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Memory Cue Windows Attention] Bridge unavailable:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.ok === false) {
          console.warn('[Memory Cue Windows Attention] Native command failed:', response.error || 'Unknown error');
        }
      },
    );
  });
})();
