const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_API_ROOT = 'https://firestore.googleapis.com/v1';
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_PUSH_TARGETS = 20;
const PUSH_SYNC_TTL_SECONDS = 7 * 24 * 60 * 60;
const PUSH_SYNC_OUTBOX_COLLECTION = '_memoryCuePushSyncOutbox';
const PUSH_SYNC_RETRY_DELAY_MS = 60 * 1000;
const PUSH_SYNC_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const GOOGLE_AUTH_LOOKUP_URL = (apiKey) => (
  `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`
);

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value) {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBadgeCount(value) {
  if (value == null || value === '') {
    return null;
  }
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

function normalizeHttpUrl(value) {
  const text = normalizeText(value).slice(0, 1024);
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeUrlPath(value) {
  const text = normalizeText(value).slice(0, 512);
  if (!text || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(text) || /[\r\n]/.test(text)) {
    return 'mobile.html#reminders';
  }
  return text;
}

function normalizePrivateKey(value) {
  return normalizeText(value).replace(/\\n/g, '\n');
}

function base64UrlEncodeString(value) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createWebPushTopic(userId, reminderId, reminderUpdatedAt) {
  const identity = [
    'memory-cue',
    normalizeText(userId),
    normalizeText(reminderId),
    String(normalizeTimestamp(reminderUpdatedAt) ?? 0),
  ].join('|');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity)
  );
  return base64UrlEncodeBytes(new Uint8Array(digest)).slice(0, 32);
}

async function createPushSyncOutboxId({ userId, action, reminder } = {}) {
  const identity = [
    'memory-cue-push-sync-v1',
    normalizeText(userId),
    normalizeText(reminder?.id),
    action === 'delete' ? 'delete' : 'upsert',
    String(normalizeTimestamp(reminder?.updatedAt) ?? 0),
  ].join('|');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity)
  );
  return 'v1_' + base64UrlEncodeBytes(new Uint8Array(digest));
}

function toFirestoreValue(value) {
  if (value === null || typeof value === 'undefined') {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { nullValue: null };
    }
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toFirestoreValue),
      },
    };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => typeof item !== 'undefined')
            .map(([key, item]) => [key, toFirestoreValue(item)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function toFirestoreFields(record = {}) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => typeof value !== 'undefined')
      .map(([key, value]) => [key, toFirestoreValue(value)])
  );
}

function pushSyncOutboxDocumentUrl(projectId, outboxId) {
  return FIRESTORE_API_ROOT
    + '/projects/' + encodeURIComponent(projectId)
    + '/databases/(default)/documents/' + PUSH_SYNC_OUTBOX_COLLECTION
    + '/' + encodeURIComponent(outboxId);
}

async function writePushSyncOutbox({ accessToken, projectId, outboxId, record }) {
  const response = await fetch(pushSyncOutboxDocumentUrl(projectId, outboxId), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ fields: toFirestoreFields(record) }),
  });
  return response.ok;
}

async function deletePushSyncOutbox({ accessToken, projectId, outboxId }) {
  const response = await fetch(pushSyncOutboxDocumentUrl(projectId, outboxId), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return response.ok || response.status === 404;
}

async function readBoundedJsonRequest(request, maximumBytes = MAX_REQUEST_BYTES) {
  const contentLengthHeader = request?.headers?.get?.('Content-Length');
  const contentLength = Number(contentLengthHeader);
  if (
    contentLengthHeader !== null
    && contentLengthHeader !== undefined
    && contentLengthHeader !== ''
    && Number.isFinite(contentLength)
    && contentLength > maximumBytes
  ) {
    return { body: null, tooLarge: true };
  }

  let rawBody = '';
  let bodyBytes = 0;
  const reader = request?.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
      bodyBytes += chunk.byteLength;
      if (bodyBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return { body: null, tooLarge: true };
      }
      rawBody += decoder.decode(chunk, { stream: true });
    }
    rawBody += decoder.decode();
  } else {
    rawBody = await request.text();
    bodyBytes = new TextEncoder().encode(rawBody).byteLength;
    if (bodyBytes > maximumBytes) {
      return { body: null, tooLarge: true };
    }
  }

  try {
    return {
      body: rawBody.trim() ? JSON.parse(rawBody) : null,
      tooLarge: false,
    };
  } catch {
    return { body: null, tooLarge: false };
  }
}

function pemToArrayBuffer(pem) {
  const normalized = normalizePrivateKey(pem)
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function signJwt(privateKey, value) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(value)
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function parseServiceAccount(env) {
  const serviceAccountJson = normalizeText(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      return {
        clientEmail: normalizeText(parsed.client_email),
        privateKey: normalizePrivateKey(parsed.private_key),
        projectId: normalizeText(parsed.project_id || env.FIREBASE_PROJECT_ID),
      };
    } catch (error) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`);
    }
  }

  return {
    clientEmail: normalizeText(env.FIREBASE_CLIENT_EMAIL),
    privateKey: normalizePrivateKey(env.FIREBASE_PRIVATE_KEY),
    projectId: normalizeText(env.FIREBASE_PROJECT_ID),
  };
}

async function createAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncodeString(JSON.stringify({
    iss: serviceAccount.clientEmail,
    scope: [
      'https://www.googleapis.com/auth/datastore',
      'https://www.googleapis.com/auth/firebase.messaging',
    ].join(' '),
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const assertionBase = `${header}.${payload}`;
  const signature = await signJwt(serviceAccount.privateKey, assertionBase);
  const assertion = `${assertionBase}.${signature}`;
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Token exchange failed (${response.status}): ${details}`);
  }

  const data = await response.json();
  return normalizeText(data.access_token);
}

async function verifyUserIdToken({ apiKey, idToken, expectedUserId }) {
  const response = await fetch(GOOGLE_AUTH_LOOKUP_URL(apiKey), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    return false;
  }

  const payload = await response.json().catch(() => null);
  const user = Array.isArray(payload?.users) ? payload.users[0] : null;
  return normalizeText(user?.localId) === normalizeText(expectedUserId);
}

function normalizeReminderPayload(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const reminderId = normalizeText(source.id).slice(0, 128);
  if (!reminderId) {
    return null;
  }
  const hasExplicitTime = source.hasExplicitTime === true;
  return {
    id: reminderId,
    title: normalizeText(source.title).slice(0, 160) || 'Reminder',
    due: normalizeText(source.due).slice(0, 80) || null,
    notifyAt: normalizeText(source.notifyAt).slice(0, 80) || null,
    snoozedUntil: normalizeText(source.snoozedUntil).slice(0, 80) || null,
    urgentAlert: hasExplicitTime && source.urgentAlert === true,
    hasExplicitTime,
    urgentAcknowledgedAt: normalizeTimestamp(source.urgentAcknowledgedAt),
    urgentStartedAt: normalizeTimestamp(source.urgentStartedAt),
    done: source.done === true || source.completed === true,
    priority: normalizeText(source.priority).slice(0, 32) || 'Medium',
    category: normalizeText(source.category).slice(0, 64) || 'General',
    notes: normalizeText(source.notes).slice(0, 240),
    meetingUrl: normalizeHttpUrl(source.meetingUrl),
    updatedAt: normalizeTimestamp(source.updatedAt) ?? Date.now(),
    urlPath: normalizeUrlPath(source.urlPath),
  };
}

function parsePushDeviceDocument(document) {
  const name = normalizeText(document?.name);
  const deviceId = name.split('/').pop() || '';
  const token = normalizeText(document?.fields?.token?.stringValue).slice(0, 4096);
  if (!deviceId || !token) {
    return null;
  }
  return {
    deviceId: decodeURIComponent(deviceId),
    token,
  };
}

async function listRegisteredPushDevices({ accessToken, projectId, userId }) {
  const root = FIRESTORE_API_ROOT
    + '/projects/' + encodeURIComponent(projectId)
    + '/databases/(default)/documents/users/' + encodeURIComponent(userId)
    + '/pushDevices?pageSize=100';
  const response = await fetch(root, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Push device lookup failed (${response.status})`);
  }
  const payload = await response.json().catch(() => ({}));
  const seenTokens = new Set();
  return (Array.isArray(payload.documents) ? payload.documents : [])
    .map(parsePushDeviceDocument)
    .filter((device) => {
      if (!device || seenTokens.has(device.token)) {
        return false;
      }
      seenTokens.add(device.token);
      return true;
    });
}

async function sendPushMessage({
  accessToken,
  projectId,
  userId,
  token,
  action,
  reminder,
  badgeCount,
}) {
  const data = {
    type: 'memoryCue:reminder-sync',
    action,
    reminder: JSON.stringify(reminder || {}),
    ownerUserId: userId,
  };
  if (badgeCount !== null) {
    data.badgeCount = String(badgeCount);
  }
  const topic = await createWebPushTopic(userId, reminder?.id, reminder?.updatedAt);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token,
        data,
        webpush: {
          headers: {
            Urgency: 'high',
            TTL: String(PUSH_SYNC_TTL_SECONDS),
            Topic: topic,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      details,
    };
  }

  return { ok: true };
}

export async function onRequestPost(context) {
  try {
    const env = context.env || {};
    const apiKey = normalizeText(env.FIREBASE_API_KEY);
    const serviceAccount = parseServiceAccount(env);
    if (!apiKey || !serviceAccount.clientEmail || !serviceAccount.privateKey || !serviceAccount.projectId) {
      return jsonResponse(
        { error: 'Missing Firebase push configuration' },
        { status: 503 }
      );
    }

    const parsedRequest = await readBoundedJsonRequest(context.request);
    if (parsedRequest.tooLarge) {
      return jsonResponse({ error: 'Invalid or oversized push sync payload' }, { status: 413 });
    }
    const body = parsedRequest.body;
    if (!body) {
      return jsonResponse({ error: 'Invalid push sync payload' }, { status: 400 });
    }
    const userId = normalizeText(body?.userId);
    const idToken = normalizeText(body?.idToken);
    const currentDeviceId = normalizeText(body?.currentDeviceId).slice(0, 128);
    const action = normalizeText(body?.action) === 'delete' ? 'delete' : 'upsert';
    const badgeCount = normalizeBadgeCount(body?.badgeCount);
    const reminder = normalizeReminderPayload(body?.reminder || {});

    if (!userId || !idToken || !currentDeviceId) {
      return jsonResponse({ error: 'Missing push sync payload' }, { status: 400 });
    }
    if (!reminder) {
      return jsonResponse({ error: 'Missing reminder payload' }, { status: 400 });
    }

    const verified = await verifyUserIdToken({
      apiKey,
      idToken,
      expectedUserId: userId,
    });
    if (!verified) {
      return jsonResponse({ error: 'Unauthorized push sync request' }, { status: 401 });
    }

    const accessToken = await createAccessToken(serviceAccount);
    if (!accessToken) {
      return jsonResponse({ error: 'Unable to authorise push send' }, { status: 502 });
    }

    const targets = (await listRegisteredPushDevices({
      accessToken,
      projectId: serviceAccount.projectId,
      userId,
    }))
      .filter((device) => device.deviceId !== currentDeviceId)
      .slice(0, MAX_PUSH_TARGETS);

    if (!targets.length) {
      return jsonResponse({ sent: 0, failures: [] });
    }

    const now = Date.now();
    const outboxId = await createPushSyncOutboxId({ userId, action, reminder });
    const baseOutboxRecord = {
      schemaVersion: 1,
      userId,
      action,
      reminder,
      badgeCount,
      targets,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now + PUSH_SYNC_RETRY_DELAY_MS,
      expiresAt: now + PUSH_SYNC_OUTBOX_RETENTION_MS,
    };
    const outboxSaved = await writePushSyncOutbox({
      accessToken,
      projectId: serviceAccount.projectId,
      outboxId,
      record: baseOutboxRecord,
    });
    if (!outboxSaved) {
      return jsonResponse(
        { error: 'Unable to queue cross-device reminder sync', retryable: true },
        { status: 503 }
      );
    }

    let sent = 0;
    const failures = [];
    const failedTargets = [];
    for (const target of targets) {
      const result = await sendPushMessage({
        accessToken,
        projectId: serviceAccount.projectId,
        userId,
        token: target.token,
        action,
        reminder,
        badgeCount,
      });
      if (result.ok) {
        sent += 1;
      } else {
        failedTargets.push(target);
        failures.push({
          deviceId: target.deviceId,
          status: result.status,
        });
      }
    }

    if (!failedTargets.length) {
      const cleared = await deletePushSyncOutbox({
        accessToken,
        projectId: serviceAccount.projectId,
        outboxId,
      });
      return jsonResponse({ sent, failures, queued: !cleared }, {
        status: cleared ? 200 : 202,
      });
    }

    const retryQueued = await writePushSyncOutbox({
      accessToken,
      projectId: serviceAccount.projectId,
      outboxId,
      record: {
        ...baseOutboxRecord,
        targets: failedTargets,
        attemptCount: 1,
        updatedAt: Date.now(),
        nextAttemptAt: Date.now() + PUSH_SYNC_RETRY_DELAY_MS,
      },
    });
    if (!retryQueued) {
      // The pre-send record still contains every target, so a later scheduler run
      // can retry safely even if narrowing the record to failures did not persist.
      return jsonResponse({ sent, failures, queued: true }, { status: 202 });
    }
    return jsonResponse({ sent, failures, queued: true }, { status: 202 });
  } catch (error) {
    return jsonResponse(
      { error: 'Push sync failed', details: error.message },
      { status: 500 }
    );
  }
}
