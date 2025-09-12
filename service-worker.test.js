const { test, expect, beforeEach } = require('@jest/globals');

function createMockCaches() {
  const store = new Map();
  const key = (req) => (typeof req === 'string' ? req : req.url);
  const cache = {
    match: jest.fn(async (req) => store.get(key(req))),
    put: jest.fn(async (req, res) => store.set(key(req), res)),
  };
  return {
    _store: store,
    open: jest.fn(async () => cache),
    match: jest.fn(async (req) => store.get(key(req))),
    keys: jest.fn(async () => []),
    delete: jest.fn(async () => true),
  };
}

let listeners;
let mockCaches;

function setupSW() {
  jest.resetModules();
  listeners = {};
  mockCaches = createMockCaches();
  global.caches = mockCaches;
  global.fetch = jest.fn();
  global.self = {
    location: { origin: 'https://example.com' },
    addEventListener: (type, cb) => { listeners[type] = cb; },
    skipWaiting: jest.fn(),
    clients: { claim: jest.fn() },
  };
  require('./service-worker.js');
}

beforeEach(() => {
  setupSW();
});

test('serves cached shell for navigation when network fails', async () => {
  // Install and precache shell
  fetch.mockImplementation(async (url) => {
    if (typeof url === 'string' && url.endsWith('index.html')) {
      return new Response('offline shell');
    }
    return new Response('other');
  });
  await listeners.install({ waitUntil: (p) => p });

  // Network fails for navigation request
  fetch.mockReset();
  fetch.mockRejectedValue(new Error('network fail'));
  const respondWith = jest.fn((p) => p);
  await listeners.fetch({
    request: { url: 'https://example.com/any', mode: 'navigate' },
    respondWith,
  });
  const res = await respondWith.mock.calls[0][0];
  await expect(res.text()).resolves.toBe('offline shell');
});

test('caches static assets via stale-while-revalidate', async () => {
  fetch.mockResolvedValue(new Response('asset'));
  const respondWith = jest.fn((p) => p);
  await listeners.fetch({
    request: { url: 'https://example.com/memory-cue/app.js', mode: 'no-cors' },
    respondWith,
  });
  const res = await respondWith.mock.calls[0][0];
  await expect(res.text()).resolves.toBe('asset');
  expect(mockCaches._store.has('https://example.com/memory-cue/app.js')).toBe(true);
});

test('does not cache Google Fonts requests', async () => {
  fetch.mockResolvedValue(new Response('font-css'));
  const respondWith = jest.fn((p) => p);
  await listeners.fetch({
    request: { url: 'https://fonts.googleapis.com/css?family=Roboto', mode: 'no-cors' },
    respondWith,
  });
  await respondWith.mock.calls[0][0];
  expect(mockCaches.open).not.toHaveBeenCalled();
  expect(mockCaches._store.size).toBe(0);
});

