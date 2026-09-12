/** @jest-environment jsdom */
const { loadReminderController } = require('./helpers/load-reminder-controller');

let changeSession;
let windowListeners;
let documentListeners;
let registration;
let api;
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  delete window.__MEMORY_CUE_PHONE_PUSH_STATUS;
  document.body.innerHTML = '<div id="status"></div><div id="reminders"></div>'
    + '<button id="retryReminderNotifications">Reconnect alerts</button>';
  global.Notification = class { static permission = 'granted'; };
  window.Notification = global.Notification;
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ active: { postMessage: jest.fn() } }),
      addEventListener: jest.fn(),
    },
  });
  windowListeners = jest.spyOn(window, 'addEventListener');
  documentListeners = jest.spyOn(document, 'addEventListener');
  registration = jest.fn().mockResolvedValue(null);
});

async function start() {
  const controller = loadReminderController({
    registerReminderPushDevice: registration,
    initAuth: async ({ onSessionChange }) => {
      changeSession = onSessionChange;
      await onSessionChange({ uid: 'test-user', email: 'test@example.test' });
      return {};
    },
  });
  api = await controller.initReminders({ listSel: '#reminders', statusSel: '#status' });
  await flush();
}

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  api?.closeActiveNotifications();
  for (const [event, listener, options] of windowListeners.mock.calls) {
    window.removeEventListener(event, listener, options);
  }
  for (const [event, listener, options] of documentListeners.mock.calls) {
    document.removeEventListener(event, listener, options);
  }
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  delete window.__MEMORY_CUE_PHONE_PUSH_STATUS;
  delete navigator.serviceWorker;
  delete navigator.onLine;
  delete global.Notification;
  delete window.Notification;
  document.body.innerHTML = '';
});

test('a temporary registration failure retries and stops after success', async () => {
  registration.mockResolvedValueOnce(null).mockResolvedValue({ id: 'phone' });
  await start();
  expect(registration).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(15000);
  expect(registration).toHaveBeenCalledTimes(2);
  expect(window.__MEMORY_CUE_PHONE_PUSH_STATUS).toBe('connected');
  await jest.advanceTimersByTimeAsync(600000);
  expect(registration).toHaveBeenCalledTimes(2);
});

test('offline startup recovers automatically on reconnect', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  await start();
  expect(registration).not.toHaveBeenCalled();
  registration.mockResolvedValue({ id: 'phone' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  window.dispatchEvent(new Event('online'));
  await flush();
  expect(registration).toHaveBeenCalledTimes(1);
  expect(window.__MEMORY_CUE_PHONE_PUSH_STATUS).toBe('connected');
});

test('signing out cancels a pending retry', async () => {
  await start();
  await changeSession(null);
  await jest.advanceTimersByTimeAsync(600000);
  expect(registration).toHaveBeenCalledTimes(1);
  expect(window.__MEMORY_CUE_PHONE_PUSH_STATUS).toBe('unavailable');
});

test('permission revoked before a retry does not register the device', async () => {
  await start();
  Notification.permission = 'denied';
  await jest.advanceTimersByTimeAsync(600000);
  expect(registration).toHaveBeenCalledTimes(1);
});

test('retries are bounded and manual reconnect remains available afterwards', async () => {
  await start();
  await jest.advanceTimersByTimeAsync(1200000);
  expect(registration).toHaveBeenCalledTimes(6);
  registration.mockResolvedValue({ id: 'phone' });
  document.getElementById('retryReminderNotifications').click();
  await flush();
  expect(registration).toHaveBeenCalledTimes(7);
  expect(window.__MEMORY_CUE_PHONE_PUSH_STATUS).toBe('connected');
  expect(document.getElementById('retryReminderNotifications').disabled).toBe(false);
});

test('duplicate recovery events share one registration attempt', async () => {
  await start();
  await jest.advanceTimersByTimeAsync(1200000);
  let resolveRegistration;
  registration.mockImplementation(() => new Promise((resolve) => { resolveRegistration = resolve; }));
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('pageshow'));
  await flush();
  expect(registration).toHaveBeenCalledTimes(7);
  resolveRegistration({ id: 'phone' });
  await flush();
  expect(window.__MEMORY_CUE_PHONE_PUSH_STATUS).toBe('connected');
});

test('reconnecting does not broadcast a data update that closes the unfinished form', async () => {
  registration.mockResolvedValue({ id: 'phone' });
  await start();
  const onReminderUpdate = jest.fn();
  document.addEventListener('memoryCue:remindersUpdated', onReminderUpdate);
  document.getElementById('retryReminderNotifications').click();
  await flush();
  expect(document.getElementById('retryReminderNotifications').disabled).toBe(false);
  expect(onReminderUpdate).not.toHaveBeenCalled();
});
