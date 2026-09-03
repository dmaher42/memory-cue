const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHash } = require('crypto');
const { TextDecoder, TextEncoder } = require('util');

const API_PATH = path.join(__dirname, '..', '..', 'functions', 'api', 'push-reminder-sync.js');

function loadPushApi(fetchMock) {
  let source = fs.readFileSync(API_PATH, 'utf8')
    .replace(/export\s+async\s+function\s+/g, 'async function ');
  source += '\nmodule.exports = { onRequestPost, normalizeReminderPayload };\n';
  const module = { exports: {} };
  const fakeCrypto = {
    subtle: {
      digest: jest.fn(async (_algorithm, input) => {
        const digest = createHash('sha256').update(Buffer.from(input)).digest();
        return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
      }),
      importKey: jest.fn().mockResolvedValue({}),
      sign: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    },
  };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    fetch: fetchMock,
    crypto: fakeCrypto,
    Response,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Date,
    Number,
    JSON,
    Math,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  }, { filename: API_PATH });
  return module.exports;
}

function makeContext(body, { headers = {} } = {}) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const bodyBuffer = new TextEncoder().encode(rawBody);
  let bodyRead = false;
  return {
    env: {
      FIREBASE_API_KEY: 'test-api-key',
      FIREBASE_PROJECT_ID: 'memory-cue-test',
      FIREBASE_CLIENT_EMAIL: 'push@memory-cue-test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
    },
    request: {
      headers: {
        get(name) {
          const match = Object.entries(headers).find(
            ([key]) => key.toLowerCase() === String(name).toLowerCase()
          );
          return match ? match[1] : null;
        },
      },
      body: {
        getReader() {
          return {
            async read() {
              if (bodyRead) {
                return { done: true, value: undefined };
              }
              bodyRead = true;
              return { done: false, value: bodyBuffer };
            },
            async cancel() {},
          };
        },
      },
      text: jest.fn().mockResolvedValue(rawBody),
    },
  };
}

function mockJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('push reminder sync API authorization', () => {
  test('resolves push tokens from the verified user and ignores client-supplied tokens', async () => {
    const requests = [];
    const fetchMock = jest.fn(async (rawUrl, init = {}) => {
      const url = String(rawUrl);
      requests.push({ url, init });
      if (url.includes('identitytoolkit.googleapis.com')) {
        return mockJson({ users: [{ localId: 'teacher-1' }] });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        return mockJson({ access_token: 'server-access-token' });
      }
      if (url.includes('/users/teacher-1/pushDevices')) {
        return mockJson({
          documents: [
            {
              name: 'projects/memory-cue-test/databases/(default)/documents/users/teacher-1/pushDevices/laptop-1',
              fields: { token: { stringValue: 'registered-laptop-token' } },
            },
            {
              name: 'projects/memory-cue-test/databases/(default)/documents/users/teacher-1/pushDevices/phone-1',
              fields: { token: { stringValue: 'registered-current-token' } },
            },
          ],
        });
      }
      if (url.endsWith('/messages:send')) {
        return mockJson({ name: 'message-1' });
      }
      if (url.includes('/_memoryCuePushSyncOutbox/') && init.method === 'PATCH') {
        return mockJson({ updateTime: '2026-09-04T00:00:00.000000Z' });
      }
      if (url.includes('/_memoryCuePushSyncOutbox/') && init.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return mockJson({ error: 'unexpected request' }, 500);
    });
    const { onRequestPost } = loadPushApi(fetchMock);

    const response = await onRequestPost(makeContext({
      userId: 'teacher-1',
      idToken: 'verified-user-token',
      currentDeviceId: 'phone-1',
      action: 'upsert',
      targets: [{ deviceId: 'attacker-device', token: 'attacker-supplied-token' }],
      reminder: {
        id: 'appointment-42',
        title: 'Dentist appointment',
        due: '2026-09-03T10:30:00+09:30',
        urgentAlert: true,
        hasExplicitTime: true,
        updatedAt: 1788400800000,
      },
    }));

    const responseBody = await response.json();
    expect({ status: response.status, body: responseBody }).toEqual({
      status: 200,
      body: { sent: 1, failures: [], queued: false },
    });
    const fcmRequests = requests.filter(({ url }) => url.endsWith('/messages:send'));
    expect(fcmRequests).toHaveLength(1);
    const fcmBody = JSON.parse(fcmRequests[0].init.body);
    expect(fcmBody.message.token).toBe('registered-laptop-token');
    expect(fcmBody.message.token).not.toBe('attacker-supplied-token');
    expect(fcmBody.message.data.ownerUserId).toBe('teacher-1');
    expect(fcmBody.message.webpush.fcm_options).toBeUndefined();
    expect(fcmBody.message.webpush.headers).toEqual(expect.objectContaining({
      Urgency: 'high',
      TTL: '604800',
    }));
    expect(fcmBody.message.webpush.headers.Topic).toHaveLength(32);
  });

  test('uses a different collapse topic for a newer reminder revision', async () => {
    const topics = [];
    const fetchMock = jest.fn(async (rawUrl, init = {}) => {
      const url = String(rawUrl);
      if (url.includes('identitytoolkit.googleapis.com')) {
        return mockJson({ users: [{ localId: 'teacher-1' }] });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        return mockJson({ access_token: 'server-access-token' });
      }
      if (url.includes('/users/teacher-1/pushDevices')) {
        return mockJson({
          documents: [{
            name: 'projects/memory-cue-test/databases/(default)/documents/users/teacher-1/pushDevices/laptop-1',
            fields: { token: { stringValue: 'registered-laptop-token' } },
          }],
        });
      }
      if (url.includes('/_memoryCuePushSyncOutbox/') && init.method === 'PATCH') {
        return mockJson({ updateTime: '2026-09-04T00:00:00.000000Z' });
      }
      if (url.includes('/_memoryCuePushSyncOutbox/') && init.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/messages:send')) {
        topics.push(JSON.parse(init.body).message.webpush.headers.Topic);
        return mockJson({ name: 'message-' + topics.length });
      }
      return mockJson({ error: 'unexpected request' }, 500);
    });
    const { onRequestPost } = loadPushApi(fetchMock);
    const base = {
      userId: 'teacher-1',
      idToken: 'verified-user-token',
      currentDeviceId: 'phone-1',
      action: 'upsert',
      reminder: {
        id: 'appointment-42',
        title: 'Dentist appointment',
        due: '2026-09-03T10:30:00+09:30',
        urgentAlert: true,
        hasExplicitTime: true,
        updatedAt: 1788400800000,
      },
    };

    await onRequestPost(makeContext(base));
    await onRequestPost(makeContext({
      ...base,
      reminder: { ...base.reminder, updatedAt: base.reminder.updatedAt + 1 },
    }));

    expect(topics).toHaveLength(2);
    expect(topics[0]).not.toBe(topics[1]);
  });

  test('durably queues failed target sends before returning an accepted response', async () => {
    const requests = [];
    const fetchMock = jest.fn(async (rawUrl, init = {}) => {
      const url = String(rawUrl);
      requests.push({ url, init });
      if (url.includes('identitytoolkit.googleapis.com')) {
        return mockJson({ users: [{ localId: 'teacher-1' }] });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        return mockJson({ access_token: 'server-access-token' });
      }
      if (url.includes('/users/teacher-1/pushDevices')) {
        return mockJson({
          documents: [{
            name: 'projects/memory-cue-test/databases/(default)/documents/users/teacher-1/pushDevices/laptop-1',
            fields: { token: { stringValue: 'registered-laptop-token' } },
          }],
        });
      }
      if (url.includes('/_memoryCuePushSyncOutbox/') && init.method === 'PATCH') {
        return mockJson({ updateTime: '2026-09-04T00:00:00.000000Z' });
      }
      if (url.endsWith('/messages:send')) {
        return mockJson({ error: { status: 'UNAVAILABLE' } }, 503);
      }
      return mockJson({ error: 'unexpected request' }, 500);
    });
    const { onRequestPost } = loadPushApi(fetchMock);

    const response = await onRequestPost(makeContext({
      userId: 'teacher-1',
      idToken: 'verified-user-token',
      currentDeviceId: 'phone-1',
      action: 'delete',
      reminder: {
        id: 'appointment-42',
        title: 'Dentist appointment',
        due: '2026-09-03T10:30:00+09:30',
        urgentAlert: true,
        hasExplicitTime: true,
        updatedAt: 1788400800001,
      },
    }));
    const body = await response.json();
    const outboxWrites = requests.filter(
      ({ url, init }) => url.includes('/_memoryCuePushSyncOutbox/') && init.method === 'PATCH'
    );
    const fcmIndex = requests.findIndex(({ url }) => url.endsWith('/messages:send'));
    const firstOutboxIndex = requests.findIndex(({ url }) => url.includes('/_memoryCuePushSyncOutbox/'));

    expect(response.status).toBe(202);
    expect(body).toEqual({
      sent: 0,
      failures: [{ deviceId: 'laptop-1', status: 503 }],
      queued: true,
    });
    expect(outboxWrites).toHaveLength(2);
    expect(firstOutboxIndex).toBeLessThan(fcmIndex);
    const queuedFields = JSON.parse(outboxWrites[1].init.body).fields;
    expect(queuedFields.action.stringValue).toBe('delete');
    expect(queuedFields.reminder.mapValue.fields.updatedAt.integerValue).toBe('1788400800001');
    expect(queuedFields.targets.arrayValue.values).toHaveLength(1);
  });

  test('rejects an oversized payload before contacting Firebase', async () => {
    const fetchMock = jest.fn();
    const { onRequestPost } = loadPushApi(fetchMock);

    const response = await onRequestPost(makeContext({
      userId: 'teacher-1',
      idToken: 'x'.repeat(33 * 1024),
      currentDeviceId: 'phone-1',
      reminder: { id: 'appointment-42' },
    }));

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects a declared oversized payload without reading or contacting Firebase', async () => {
    const fetchMock = jest.fn();
    const { onRequestPost } = loadPushApi(fetchMock);

    const response = await onRequestPost(makeContext({}, {
      headers: { 'Content-Length': String(33 * 1024) },
    }));

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns a client error for malformed JSON without contacting Firebase', async () => {
    const fetchMock = jest.fn();
    const { onRequestPost } = loadPushApi(fetchMock);

    const response = await onRequestPost(makeContext('{not-json'));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
