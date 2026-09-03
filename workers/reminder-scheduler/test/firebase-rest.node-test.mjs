import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFcmMessage,
  buildUrgentReminderQuery,
  createDeliveryId,
  createFirebaseRestAdapter,
  fromFirestoreFields,
  parseServiceAccount,
} from '../src/firebase-rest.js';

const PROJECT_ID = 'memory-cue-test';
const USER_ID = 'teacher-1';
const REMINDER_ID = 'appointment-42';
const DEVICE_ID = 'phone-1';
const DUE_AT = Date.parse('2026-09-03T10:30:00+09:30');

function value(item) {
  if (item === null) {
    return { nullValue: null };
  }
  if (typeof item === 'boolean') {
    return { booleanValue: item };
  }
  if (typeof item === 'number') {
    return { integerValue: String(item) };
  }
  return { stringValue: String(item) };
}

function fields(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, value(item)])
  );
}

function createFakeCrypto() {
  let uuidCounter = 0;
  return {
    randomUUID() {
      uuidCounter += 1;
      return 'claim-token-' + uuidCounter;
    },
    subtle: {
      async importKey() {
        return {};
      },
      async sign() {
        return new Uint8Array([1, 2, 3, 4]).buffer;
      },
      async digest(algorithm, input) {
        return globalThis.crypto.subtle.digest(algorithm, input);
      },
    },
  };
}

function createMockFirebaseApi() {
  let deliveryDocument = null;
  let updateCounter = 0;
  let currentNow = DUE_AT - (15 * 60 * 1000);
  let failNextPatchPrecondition = false;
  let deviceNextPageToken = '';
  let fcmFailure = null;
  const deletedDeviceIds = [];
  const requests = [];

  const nextUpdateTime = () => {
    updateCounter += 1;
    return '2026-09-03T01:00:0' + updateCounter + '.000000Z';
  };

  async function fetchImpl(rawUrl, init = {}) {
    const url = String(rawUrl);
    const method = init.method || 'GET';
    const rawBody = init.body ? String(init.body) : '';
    let parsedBody = null;
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }
    const request = {
      url,
      method,
      body: parsedBody,
      headers: init.headers || {},
    };
    requests.push(request);

    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'test-access-token' });
    }
    if (url.endsWith('/documents:runQuery')) {
      const queryFilters = request.body.structuredQuery.where.compositeFilter.filters;
      const isOverdueQuery = queryFilters.some(
        ({ fieldFilter }) => (
          fieldFilter.field.fieldPath === 'due'
          && fieldFilter.op === 'LESS_THAN'
        )
      );
      if (isOverdueQuery) {
        return Response.json([]);
      }
      return Response.json([
        {
          document: {
            name:
              'projects/' + PROJECT_ID
              + '/databases/(default)/documents/users/' + USER_ID
              + '/reminders/' + REMINDER_ID,
            fields: fields({
              title: 'Dentist appointment',
              due: new Date(DUE_AT).toISOString(),
              urgentAlert: true,
              hasExplicitTime: true,
              done: false,
              updatedAt: DUE_AT - 3600000,
            }),
          },
        },
      ]);
    }
    if (
      url.includes('/users/' + USER_ID + '/pushDevices/')
      && method === 'DELETE'
    ) {
      deletedDeviceIds.push(decodeURIComponent(url.split('/').pop()));
      return Response.json({});
    }
    if (
      url.includes('/users/' + USER_ID + '/pushDevices')
      && method === 'GET'
    ) {
      return Response.json({
        documents: [
          {
            name:
              'projects/' + PROJECT_ID
              + '/databases/(default)/documents/users/' + USER_ID
              + '/pushDevices/' + DEVICE_ID,
            fields: fields({
              token: 'private-phone-token',
              platform: 'web',
            }),
          },
        ],
        ...(deviceNextPageToken ? { nextPageToken: deviceNextPageToken } : {}),
      });
    }
    if (
      url.includes('/_memoryCueUrgentDeliveries?documentId=')
      && method === 'POST'
    ) {
      if (deliveryDocument) {
        return Response.json(
          { error: { status: 'ALREADY_EXISTS' } },
          { status: 409 }
        );
      }
      const deliveryId = new URL(url).searchParams.get('documentId');
      deliveryDocument = {
        name:
          'projects/' + PROJECT_ID
          + '/databases/(default)/documents/_memoryCueUrgentDeliveries/'
          + deliveryId,
        fields: request.body.fields,
        updateTime: nextUpdateTime(),
      };
      return Response.json(deliveryDocument);
    }
    if (
      url.includes('/_memoryCueUrgentDeliveries/')
      && method === 'GET'
    ) {
      return deliveryDocument
        ? Response.json(deliveryDocument)
        : Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 });
    }
    if (
      url.includes('/_memoryCueUrgentDeliveries/')
      && method === 'PATCH'
    ) {
      if (!deliveryDocument) {
        return Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 });
      }
      const expectedUpdateTime = new URL(url).searchParams.get(
        'currentDocument.updateTime'
      );
      if (
        failNextPatchPrecondition
        || expectedUpdateTime !== deliveryDocument.updateTime
      ) {
        failNextPatchPrecondition = false;
        return Response.json(
          { error: { status: 'FAILED_PRECONDITION' } },
          { status: 400 }
        );
      }
      deliveryDocument = {
        ...deliveryDocument,
        fields: request.body.fields,
        updateTime: nextUpdateTime(),
      };
      return Response.json(deliveryDocument);
    }
    if (url.endsWith('/messages:send')) {
      if (fcmFailure) {
        return Response.json({
          error: {
            status: fcmFailure.statusName,
            message: fcmFailure.message || 'FCM rejected the message',
            details: fcmFailure.errorCode
              ? [{ errorCode: fcmFailure.errorCode }]
              : [],
          },
        }, {
          status: fcmFailure.status,
          headers: fcmFailure.retryAfter
            ? { 'Retry-After': fcmFailure.retryAfter }
            : {},
        });
      }
      return Response.json({
        name: 'projects/' + PROJECT_ID + '/messages/message-1',
      });
    }
    return Response.json(
      { error: { status: 'UNEXPECTED_TEST_REQUEST', message: url } },
      { status: 500 }
    );
  }

  return {
    fetchImpl,
    requests,
    getDelivery: () => deliveryDocument,
    getNow: () => currentNow,
    setNow: (valueToSet) => {
      currentNow = valueToSet;
    },
    failNextPatchPrecondition: () => {
      failNextPatchPrecondition = true;
    },
    setDeviceNextPageToken: (valueToSet) => {
      deviceNextPageToken = valueToSet;
    },
    setFcmFailure: (valueToSet) => {
      fcmFailure = valueToSet;
    },
    getDeletedDeviceIds: () => [...deletedDeviceIds],
  };
}

async function createAdapter(api, envOverrides = {}, adapterOptions = {}) {
  return createFirebaseRestAdapter({
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: 'scheduler@memory-cue-test.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
    ...envOverrides,
  }, {
    fetchImpl: api.fetchImpl,
    cryptoImpl: createFakeCrypto(),
    now: api.getNow,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    accessTokenCache: adapterOptions.accessTokenCache || new Map(),
  });
}

test('builds the collection-group query required for the exact urgent window', () => {
  const lowerBoundMs = DUE_AT - (15 * 60 * 1000);
  const query = buildUrgentReminderQuery({
    lowerBoundMs,
    upperBoundMs: DUE_AT,
  });
  const structured = query.structuredQuery;
  const filters = structured.where.compositeFilter.filters;

  assert.deepEqual(structured.from, [{
    collectionId: 'reminders',
    allDescendants: true,
  }]);
  assert.deepEqual(
    filters.map(({ fieldFilter }) => [
      fieldFilter.field.fieldPath,
      fieldFilter.op,
    ]),
    [
      ['urgentAlert', 'EQUAL'],
      ['hasExplicitTime', 'EQUAL'],
      ['done', 'EQUAL'],
      ['due', 'GREATER_THAN_OR_EQUAL'],
      ['due', 'LESS_THAN_OR_EQUAL'],
    ]
  );
  assert.equal(
    filters[3].fieldFilter.value.stringValue,
    new Date(lowerBoundMs).toISOString()
  );
  assert.equal(
    filters[4].fieldFilter.value.stringValue,
    new Date(DUE_AT).toISOString()
  );
});

test('overdue query is newest-first so stale items cannot hide recent ones', () => {
  const query = buildUrgentReminderQuery({
    upperBoundMs: DUE_AT,
    upperBoundInclusive: false,
    direction: 'DESCENDING',
    limit: 50,
  });
  const structured = query.structuredQuery;
  const dueFilter = structured.where.compositeFilter.filters.at(-1).fieldFilter;

  assert.equal(dueFilter.field.fieldPath, 'due');
  assert.equal(dueFilter.op, 'LESS_THAN');
  assert.equal(structured.orderBy[0].direction, 'DESCENDING');
  assert.equal(structured.limit, 50);
});

test('decodes Firestore fields without losing nested urgency metadata', () => {
  const decoded = fromFirestoreFields({
    urgentAlert: { booleanValue: true },
    updatedAt: { integerValue: '1234' },
    metadata: {
      mapValue: {
        fields: {
          suppressNotification: { booleanValue: true },
        },
      },
    },
  });

  assert.deepEqual(decoded, {
    urgentAlert: true,
    updatedAt: 1234,
    metadata: {
      suppressNotification: true,
    },
  });
});

test('delivery identifiers are deterministic, stage-specific, and hide user data', async () => {
  const cryptoImpl = createFakeCrypto();
  const base = {
    userId: USER_ID,
    reminderId: REMINDER_ID,
    dueAt: DUE_AT,
    stageKey: 't-15',
    deviceId: DEVICE_ID,
  };
  const first = await createDeliveryId(base, cryptoImpl);
  const second = await createDeliveryId(base, cryptoImpl);
  const nextStage = await createDeliveryId({
    ...base,
    stageKey: 't-5',
  }, cryptoImpl);

  assert.equal(first, second);
  assert.notEqual(first, nextStage);
  assert.equal(first.includes(USER_ID), false);
  assert.equal(first.includes(REMINDER_ID), false);
  assert.equal(first.includes(DEVICE_ID), false);
});

test('builds a high-urgency, short-lived, collapsible FCM data message', async () => {
  const message = await buildFcmMessage({
    claim: {
      userId: USER_ID,
      deliveryId: 'delivery-1',
    },
    device: {
      id: DEVICE_ID,
      token: 'private-phone-token',
    },
    reminder: {
      id: REMINDER_ID,
      title: 'Dentist appointment',
      due: new Date(DUE_AT).toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
      done: false,
      updatedAt: null,
    },
    urgency: {
      stage: { key: 't-15' },
    },
    badgeCount: 2,
  }, createFakeCrypto());

  assert.equal(message.message.token, 'private-phone-token');
  assert.equal(message.message.data.type, 'memoryCue:reminder-sync');
  assert.equal(message.message.data.deliveryStageKey, 't-15');
  assert.equal(message.message.data.badgeCount, '2');
  assert.equal(message.message.webpush.headers.Urgency, 'high');
  assert.equal(message.message.webpush.headers.TTL, '240');
  assert.equal(message.message.webpush.headers.Topic.length, 32);
  assert.equal(
    JSON.parse(message.message.data.reminder).urgentAlert,
    true
  );
  assert.ok(JSON.parse(message.message.data.reminder).updatedAt > 0);
});

test('bounds untrusted reminder text below the FCM data payload limit', async () => {
  const message = await buildFcmMessage({
    claim: {
      userId: USER_ID,
      deliveryId: 'delivery-oversized-input',
    },
    device: {
      id: DEVICE_ID,
      token: 'private-phone-token',
    },
    reminder: {
      id: REMINDER_ID,
      title: '🧠'.repeat(5000),
      due: new Date(DUE_AT).toISOString(),
      notes: '\n'.repeat(5000),
      urgentAlert: true,
      hasExplicitTime: true,
    },
    urgency: {
      stage: { key: 't-15' },
    },
    badgeCount: 1,
  }, createFakeCrypto());

  const dataBytes = new TextEncoder().encode(
    JSON.stringify(message.message.data)
  ).byteLength;
  const reminder = JSON.parse(message.message.data.reminder);

  assert.ok(dataBytes <= 4096);
  assert.ok(new TextEncoder().encode(reminder.title).byteLength <= 400);
  assert.ok(new TextEncoder().encode(reminder.notes).byteLength <= 600);
});

test('rejects an unusably large reminder ID before calling FCM', async () => {
  await assert.rejects(
    buildFcmMessage({
      claim: { userId: USER_ID, deliveryId: 'delivery-invalid-id' },
      device: { id: DEVICE_ID, token: 'private-phone-token' },
      reminder: { id: 'x'.repeat(257), title: 'Reminder' },
      urgency: { stage: { key: 'due' } },
      badgeCount: 1,
    }, createFakeCrypto()),
    /Reminder ID is missing or too large/
  );
});

test('rejects external or control-character notification paths', async () => {
  for (const urlPath of [
    'https://example.test/phish',
    '//example.test/phish',
    '\\\\example.test\\phish',
    'mobile.html\nhttps://example.test',
  ]) {
    const message = await buildFcmMessage({
      claim: { userId: USER_ID, deliveryId: 'delivery-safe-path' },
      device: { id: DEVICE_ID, token: 'private-phone-token' },
      reminder: { id: REMINDER_ID, title: 'Reminder', urlPath },
      urgency: { stage: { key: 'due' } },
      badgeCount: 1,
    }, createFakeCrypto());

    assert.equal(
      JSON.parse(message.message.data.reminder).urlPath,
      'mobile.html#reminders'
    );
  }
});

test('uses one idempotent claim per stage and finalises successful FCM delivery', async () => {
  const api = createMockFirebaseApi();
  const adapter = await createAdapter(api);
  const reminders = await adapter.queryUrgentReminders(
    DUE_AT - (15 * 60 * 1000),
    DUE_AT
  );
  const devices = await adapter.listPushDevices(USER_ID);
  const delivery = {
    userId: USER_ID,
    reminderId: REMINDER_ID,
    dueAt: DUE_AT,
    stageKey: 't-15',
    deviceId: DEVICE_ID,
    nowMs: api.getNow(),
  };

  const claim = await adapter.claimDelivery(delivery);
  const overlappingClaim = await adapter.claimDelivery(delivery);
  const result = await adapter.sendReminderPush({
    claim,
    device: devices[0],
    reminder: reminders[0],
    urgency: { stage: { key: 't-15' } },
    badgeCount: 1,
  });
  await adapter.markDeliveryDelivered(claim, result);
  api.setNow(api.getNow() + (10 * 60 * 1000));
  const afterDelivery = await adapter.claimDelivery({
    ...delivery,
    nowMs: api.getNow(),
  });

  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].userId, USER_ID);
  assert.equal(devices.length, 1);
  assert.equal(claim.claimed, true);
  assert.equal(overlappingClaim.claimed, false);
  assert.equal(overlappingClaim.reason, 'active-lease');
  assert.equal(result.ok, true);
  assert.equal(afterDelivery.claimed, false);
  assert.equal(afterDelivery.reason, 'delivered');
  assert.equal(
    fromFirestoreFields(api.getDelivery().fields).status,
    'delivered'
  );
  assert.equal('userId' in api.getDelivery().fields, false);
  assert.equal('reminderId' in api.getDelivery().fields, false);
  assert.equal('deviceId' in api.getDelivery().fields, false);
  assert.match(api.getDelivery().fields.expireAt.timestampValue, /Z$/);
  const fcmRequest = api.requests.find(({ url }) => url.endsWith('/messages:send'));
  assert.equal(fcmRequest.body.message.data.deliveryStageKey, 't-15');
});

test('expired leases can be reclaimed but retry backoff prevents a hot loop', async () => {
  const api = createMockFirebaseApi();
  const adapter = await createAdapter(api);
  const delivery = {
    userId: USER_ID,
    reminderId: REMINDER_ID,
    dueAt: DUE_AT,
    stageKey: 'due',
    deviceId: DEVICE_ID,
    nowMs: api.getNow(),
  };

  const firstClaim = await adapter.claimDelivery(delivery);
  api.setNow(api.getNow() + (3 * 60 * 1000));
  const reclaimed = await adapter.claimDelivery({
    ...delivery,
    nowMs: api.getNow(),
  });
  await adapter.markDeliveryFailed(reclaimed, {
    ok: false,
    retryable: true,
    status: 503,
    error: 'temporary failure',
  });
  const duringBackoff = await adapter.claimDelivery({
    ...delivery,
    nowMs: api.getNow(),
  });
  api.setNow(api.getNow() + (3 * 60 * 1000));
  const afterBackoff = await adapter.claimDelivery({
    ...delivery,
    nowMs: api.getNow(),
  });

  assert.equal(firstClaim.claimed, true);
  assert.equal(reclaimed.claimed, true);
  assert.equal(reclaimed.attemptCount, 2);
  assert.equal(duringBackoff.claimed, false);
  assert.equal(duringBackoff.reason, 'retry-backoff');
  assert.equal(afterBackoff.claimed, true);
  assert.equal(afterBackoff.attemptCount, 3);
});

test('a Firestore FAILED_PRECONDITION response is treated as a lost claim race', async () => {
  const api = createMockFirebaseApi();
  const adapter = await createAdapter(api);
  const delivery = {
    userId: USER_ID,
    reminderId: REMINDER_ID,
    dueAt: DUE_AT,
    stageKey: 'due',
    deviceId: DEVICE_ID,
    nowMs: api.getNow(),
  };

  await adapter.claimDelivery(delivery);
  api.setNow(api.getNow() + (3 * 60 * 1000));
  api.failNextPatchPrecondition();
  const racedClaim = await adapter.claimDelivery({
    ...delivery,
    nowMs: api.getNow(),
  });

  assert.equal(racedClaim.claimed, false);
  assert.equal(racedClaim.reason, 'claim-race');
});

test('device listing fails explicitly instead of silently ignoring another page', async () => {
  const api = createMockFirebaseApi();
  api.setDeviceNextPageToken('more-devices-exist');
  const adapter = await createAdapter(api);

  await assert.rejects(
    adapter.listPushDevices(USER_ID),
    /Push device safety cap exceeded/
  );
});

test('UNREGISTERED is permanent and retires every duplicate registration record', async () => {
  const api = createMockFirebaseApi();
  const adapter = await createAdapter(api);
  const devices = await adapter.listPushDevices(USER_ID);
  const claim = await adapter.claimDelivery({
    userId: USER_ID,
    reminderId: REMINDER_ID,
    dueAt: DUE_AT,
    stageKey: 't-15',
    deviceId: DEVICE_ID,
    nowMs: api.getNow(),
  });
  api.setFcmFailure({
    status: 404,
    statusName: 'NOT_FOUND',
    errorCode: 'UNREGISTERED',
  });

  const result = await adapter.sendReminderPush({
    claim,
    device: devices[0],
    reminder: {
      id: REMINDER_ID,
      title: 'Dentist appointment',
      due: new Date(DUE_AT).toISOString(),
    },
    urgency: { stage: { key: 't-15' } },
    badgeCount: 1,
  });
  await adapter.markDeliveryFailed(claim, result, {
    ...devices[0],
    registrationIds: [DEVICE_ID, 'stale-phone-record'],
  });

  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, 'UNREGISTERED');
  assert.equal(
    fromFirestoreFields(api.getDelivery().fields).status,
    'permanent-failure'
  );
  assert.deepEqual(
    api.getDeletedDeviceIds().sort(),
    [DEVICE_ID, 'stale-phone-record'].sort()
  );
});

test('transient FCM errors honour Retry-After while validated payload errors do not retry', async () => {
  const api = createMockFirebaseApi();
  const adapter = await createAdapter(api);
  const device = { id: DEVICE_ID, token: 'private-phone-token' };
  const reminder = {
    id: REMINDER_ID,
    title: 'Dentist appointment',
    due: new Date(DUE_AT).toISOString(),
  };
  const claim = await adapter.claimDelivery({
    userId: USER_ID,
    reminderId: REMINDER_ID,
    dueAt: DUE_AT,
    stageKey: 't-5',
    deviceId: DEVICE_ID,
    nowMs: api.getNow(),
  });
  api.setFcmFailure({
    status: 503,
    statusName: 'UNAVAILABLE',
    errorCode: 'UNAVAILABLE',
    retryAfter: '600',
  });
  const transient = await adapter.sendReminderPush({
    claim,
    device,
    reminder,
    urgency: { stage: { key: 't-5' } },
    badgeCount: 1,
  });
  await adapter.markDeliveryFailed(claim, transient, device);

  assert.equal(transient.retryable, true);
  assert.equal(transient.retryAfterMs, 600000);
  assert.ok(
    fromFirestoreFields(api.getDelivery().fields).nextAttemptAt
      >= api.getNow() + 600000
  );

  api.setFcmFailure({
    status: 400,
    statusName: 'INVALID_ARGUMENT',
    errorCode: 'INVALID_ARGUMENT',
  });
  const invalid = await adapter.sendReminderPush({
    claim: { ...claim, deliveryId: 'another-delivery' },
    device,
    reminder,
    urgency: { stage: { key: 'due' } },
    badgeCount: 1,
  });
  assert.equal(invalid.retryable, false);
});

test('generic authentication and permission failures retry after configuration recovers', async () => {
  const api = createMockFirebaseApi();
  const accessTokenCache = new Map();
  const adapter = await createAdapter(api, {}, { accessTokenCache });
  const input = {
    claim: {
      userId: USER_ID,
      deliveryId: 'v1_retryable-auth-failure',
    },
    device: { id: DEVICE_ID, token: 'private-phone-token' },
    reminder: {
      id: REMINDER_ID,
      title: 'Dentist appointment',
      due: new Date(DUE_AT).toISOString(),
    },
    urgency: { stage: { key: 't-5' } },
    badgeCount: 1,
  };

  for (const status of [401, 403]) {
    api.setFcmFailure({
      status,
      statusName: status === 401 ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED',
    });
    const result = await adapter.sendReminderPush(input);
    assert.equal(result.retryable, true);
  }

  api.setFcmFailure(null);
  const recoveredAdapter = await createAdapter(api, {}, { accessTokenCache });
  const recovered = await recoveredAdapter.sendReminderPush(input);
  assert.equal(recovered.ok, true);
  assert.equal(
    api.requests.filter(({ url }) => url === 'https://oauth2.googleapis.com/token').length,
    2
  );
});

test('warm scheduler invocations reuse a short-lived service-account access token', async () => {
  const api = createMockFirebaseApi();
  const accessTokenCache = new Map();

  await createAdapter(api, {}, { accessTokenCache });
  await createAdapter(api, {}, { accessTokenCache });
  assert.equal(
    api.requests.filter(({ url }) => url === 'https://oauth2.googleapis.com/token').length,
    1
  );

  api.setNow(api.getNow() + (46 * 60 * 1000));
  await createAdapter(api, {}, { accessTokenCache });
  assert.equal(
    api.requests.filter(({ url }) => url === 'https://oauth2.googleapis.com/token').length,
    2
  );
});

test('the adapter stops before its configured external-subrequest ceiling', async () => {
  const api = createMockFirebaseApi();
  const adapter = await createAdapter(api, {
    SCHEDULER_MAX_SUBREQUESTS: '3',
  });

  await adapter.queryUrgentReminders(
    DUE_AT - (15 * 60 * 1000),
    DUE_AT
  );
  assert.deepEqual(adapter.getBudgetState(), {
    used: 3,
    maximum: 3,
    remaining: 0,
  });
  await assert.rejects(
    adapter.listPushDevices(USER_ID),
    /external-subrequest budget exhausted/
  );
});

test('service-account JSON is supported without exposing its private values', () => {
  const parsed = parseServiceAccount({
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: PROJECT_ID,
      client_email: 'scheduler@example.test',
      private_key: 'line-one\\nline-two',
    }),
  });

  assert.equal(parsed.projectId, PROJECT_ID);
  assert.equal(parsed.clientEmail, 'scheduler@example.test');
  assert.equal(parsed.privateKey, 'line-one\nline-two');
});
