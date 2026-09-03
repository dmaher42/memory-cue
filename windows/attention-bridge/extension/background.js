'use strict';

const NATIVE_HOST_NAME = 'com.memorycue.windows_attention';
const MESSAGE_TYPE = 'memoryCue:windowsAttention';
const ALLOWED_ACTIONS = new Set(['urgent', 'acknowledged', 'clear']);
const ALLOWED_HOSTS = new Set(['memory-cue.pages.dev', 'localhost', '127.0.0.1']);
const SAFE_STAGE = /^[A-Za-z0-9:_-]{1,32}$/;

function isAllowedPageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return false;
    if (url.hostname === 'memory-cue.pages.dev') return url.protocol === 'https:';
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeCommand(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return null;
  if (!ALLOWED_ACTIONS.has(value.action)) return null;
  if (!Number.isInteger(value.count) || value.count < 0 || value.count > 999) return null;
  if ((value.action === 'urgent' || value.action === 'acknowledged') && value.count === 0) return null;
  if (value.action === 'clear' && value.count !== 0) return null;
  if (value.stage !== undefined && (typeof value.stage !== 'string' || !SAFE_STAGE.test(value.stage))) return null;

  const command = { action: value.action, count: value.count };
  if (value.stage !== undefined) command.stage = value.stage;
  return command;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderUrl = sender.url || sender.tab?.url || '';
  if (sender.id !== chrome.runtime.id || !isAllowedPageUrl(senderUrl)) return false;
  if (!message || message.type !== MESSAGE_TYPE) return false;

  const command = normalizeCommand(message.command);
  if (!command) {
    sendResponse({ ok: false, error: 'Rejected invalid Memory Cue attention command.' });
    return false;
  }

  chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, command, (nativeResponse) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    sendResponse(nativeResponse || { ok: false, error: 'The native host returned no response.' });
  });
  return true;
});
