const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_API_ROOT = 'https://firestore.googleapis.com/v1';
const FCM_API_ROOT = 'https://fcm.googleapis.com/v1';
const DELIVERY_COLLECTION = '_memoryCueUrgentDeliveries';
const DELIVERY_LEASE_MS = 2 * 60 * 1000;
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 60 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const DEFAULT_QUERY_LIMIT = 250;
const DEFAULT_SUBREQUEST_BUDGET = 45;
const MAX_PUSH_DEVICE_DOCUMENTS = 100;
const PUSH_TTL_SECONDS = 240;
const FCM_MAX_DATA_BYTES = 4096;
const ACCESS_TOKEN_CACHE_LIFETIME_MS = 45 * 60 * 1000;
const serviceAccountAccessTokenCache = new Map();
const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase.messaging',
].join(' ');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePrivateKey(value) {
  return normalizeText(value).replace(/\\n/g, '\n');
}

function normalizeHttpUrl(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
}

function normalizeUrlPath(value) {
  const text = truncateUtf8(value, 256);
  if (
    !text
    || /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(text)
    || /[\u0000-\u001f\u007f]/.test(text)
  ) {
    return 'mobile.html#reminders';
  }
  return text;
}

function truncateUtf8(value, maximumBytes) {
  const text = normalizeText(value);
  const encoder = new TextEncoder();
  if (encoder.encode(text).byteLength <= maximumBytes) {
    return text;
  }
  let result = '';
  let usedBytes = 0;
  for (const character of text) {
    const characterBytes = encoder.encode(character).byteLength;
    if (usedBytes + characterBytes > maximumBytes) {
      break;
    }
    result += character;
    usedBytes += characterBytes;
  }
  return result;
}

function requireBoundedText(value, label, maximumBytes) {
  const text = normalizeText(value);
  if (!text || new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new TypeError(label + ' is missing or too large');
  }
  return text;
}

function normalizeTimestamp(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
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

function base64UrlEncodeString(value) {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return base64UrlEncodeString(binary);
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

async function signJwt(privateKey, unsignedToken, cryptoImpl) {
  const key = await cryptoImpl.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  const signature = await cryptoImpl.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export function parseServiceAccount(env = {}) {
  const serviceAccountJson = normalizeText(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (serviceAccountJson) {
    let parsed;
    try {
      parsed = JSON.parse(serviceAccountJson);
    } catch (error) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + error.message);
    }
    return {
      projectId: normalizeText(parsed.project_id || env.FIREBASE_PROJECT_ID),
      clientEmail: normalizeText(parsed.client_email),
      privateKey: normalizePrivateKey(parsed.private_key),
    };
  }
  return {
    projectId: normalizeText(env.FIREBASE_PROJECT_ID),
    clientEmail: normalizeText(env.FIREBASE_CLIENT_EMAIL),
    privateKey: normalizePrivateKey(env.FIREBASE_PRIVATE_KEY),
  };
}

export function assertServiceAccount(serviceAccount = {}) {
  const missing = [];
  if (!normalizeText(serviceAccount.projectId)) {
    missing.push('FIREBASE_PROJECT_ID');
  }
  if (!normalizeText(serviceAccount.clientEmail)) {
    missing.push('FIREBASE_CLIENT_EMAIL');
  }
  if (!normalizeText(serviceAccount.privateKey)) {
    missing.push('FIREBASE_PRIVATE_KEY');
  }
  if (missing.length) {
    throw new Error(
      'Missing scheduler Firebase configuration: ' + missing.join(', ')
      + '. FIREBASE_SERVICE_ACCOUNT_JSON may supply all three values.'
    );
  }
}

export async function createServiceAccountAccessToken(
  serviceAccount,
  {
    fetchImpl = fetch,
    cryptoImpl = crypto,
    nowMs = Date.now(),
  } = {}
) {
  assertServiceAccount(serviceAccount);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const encodedHeader = base64UrlEncodeString(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
  }));
  const encodedPayload = base64UrlEncodeString(JSON.stringify({
    iss: serviceAccount.clientEmail,
    scope: GOOGLE_OAUTH_SCOPES,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const unsignedToken = encodedHeader + '.' + encodedPayload;
  const signature = await signJwt(
    serviceAccount.privateKey,
    unsignedToken,
    cryptoImpl
  );
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsignedToken + '.' + signature,
    }),
  });
  if (!response.ok) {
    throw new Error('Firebase scheduler token exchange failed with HTTP ' + response.status);
  }
  const payload = await response.json();
  const accessToken = normalizeText(payload?.access_token);
  if (!accessToken) {
    throw new Error('Firebase scheduler token exchange returned no access token');
  }
  return accessToken;
}

function serviceAccountAccessTokenCacheKey(serviceAccount = {}) {
  return [
    normalizeText(serviceAccount.projectId),
    normalizeText(serviceAccount.clientEmail),
  ].join('|');
}

async function getCachedServiceAccountAccessToken(
  serviceAccount,
  {
    fetchImpl,
    cryptoImpl,
    nowMs,
    cache = serviceAccountAccessTokenCache,
  }
) {
  if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') {
    return createServiceAccountAccessToken(serviceAccount, {
      fetchImpl,
      cryptoImpl,
      nowMs,
    });
  }

  const key = serviceAccountAccessTokenCacheKey(serviceAccount);
  const existing = cache.get(key);
  if (
    normalizeText(existing?.accessToken)
    && Number(existing.expiresAt) > Number(nowMs)
  ) {
    return existing.accessToken;
  }
  if (existing?.pending && typeof existing.pending.then === 'function') {
    return existing.pending;
  }

  const pending = createServiceAccountAccessToken(serviceAccount, {
    fetchImpl,
    cryptoImpl,
    nowMs,
  });
  cache.set(key, { pending });
  try {
    const accessToken = await pending;
    cache.set(key, {
      accessToken,
      expiresAt: Number(nowMs) + ACCESS_TOKEN_CACHE_LIFETIME_MS,
    });
    return accessToken;
  } catch (error) {
    if (cache.get(key)?.pending === pending && typeof cache.delete === 'function') {
      cache.delete(key);
    }
    throw error;
  }
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
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

export function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if ('nullValue' in value) {
    return null;
  }
  if ('stringValue' in value) {
    return value.stringValue;
  }
  if ('booleanValue' in value) {
    return value.booleanValue;
  }
  if ('integerValue' in value) {
    const integer = Number(value.integerValue);
    return Number.isFinite(integer) ? integer : null;
  }
  if ('doubleValue' in value) {
    return Number.isFinite(Number(value.doubleValue)) ? Number(value.doubleValue) : null;
  }
  if ('timestampValue' in value) {
    return value.timestampValue;
  }
  if ('arrayValue' in value) {
    return (value.arrayValue?.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in value) {
    return fromFirestoreFields(value.mapValue?.fields || {});
  }
  return null;
}

export function fromFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)])
  );
}

function toFirestoreFields(record = {}) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => typeof value !== 'undefined')
      .map(([key, value]) => [key, toFirestoreValue(value)])
  );
}

function firestoreDocumentsRoot(projectId) {
  return FIRESTORE_API_ROOT
    + '/projects/' + encodeURIComponent(projectId)
    + '/databases/(default)/documents';
}

function authorizationHeaders(accessToken, json = false) {
  const headers = {
    Authorization: 'Bearer ' + accessToken,
  };
  if (json) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

function fieldFilter(fieldPath, op, value) {
  return {
    fieldFilter: {
      field: { fieldPath },
      op,
      value: toFirestoreValue(value),
    },
  };
}

export function buildUrgentReminderQuery({
  lowerBoundMs = null,
  upperBoundMs,
  upperBoundInclusive = true,
  direction = 'ASCENDING',
  limit = DEFAULT_QUERY_LIMIT,
} = {}) {
  const upperBound = new Date(Number(upperBoundMs));
  if (!Number.isFinite(upperBound.getTime())) {
    throw new TypeError('upperBoundMs must be a valid timestamp');
  }
  const lowerBound = lowerBoundMs === null
    ? null
    : new Date(Number(lowerBoundMs));
  if (lowerBound && !Number.isFinite(lowerBound.getTime())) {
    throw new TypeError('lowerBoundMs must be a valid timestamp');
  }
  const resolvedLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(1000, Math.floor(Number(limit))))
    : DEFAULT_QUERY_LIMIT;
  const resolvedDirection = direction === 'DESCENDING'
    ? 'DESCENDING'
    : 'ASCENDING';
  const filters = [
    fieldFilter('urgentAlert', 'EQUAL', true),
    fieldFilter('hasExplicitTime', 'EQUAL', true),
    fieldFilter('done', 'EQUAL', false),
  ];
  if (lowerBound) {
    filters.push(
      fieldFilter('due', 'GREATER_THAN_OR_EQUAL', lowerBound.toISOString())
    );
  }
  filters.push(
    fieldFilter(
      'due',
      upperBoundInclusive ? 'LESS_THAN_OR_EQUAL' : 'LESS_THAN',
      upperBound.toISOString()
    )
  );
  return {
    structuredQuery: {
      from: [
        {
          collectionId: 'reminders',
          allDescendants: true,
        },
      ],
      where: {
        compositeFilter: {
          op: 'AND',
          filters,
        },
      },
      orderBy: [
        {
          field: { fieldPath: 'due' },
          direction: resolvedDirection,
        },
      ],
      limit: resolvedLimit,
    },
  };
}

function parseReminderDocument(document) {
  const name = normalizeText(document?.name);
  const marker = '/documents/';
  const markerIndex = name.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const path = name.slice(markerIndex + marker.length);
  const parts = path.split('/');
  if (
    parts.length !== 4
    || parts[0] !== 'users'
    || parts[2] !== 'reminders'
  ) {
    return null;
  }
  const userId = decodeURIComponent(parts[1]);
  const reminderId = decodeURIComponent(parts[3]);
  if (!userId || !reminderId) {
    return null;
  }
  return {
    ...fromFirestoreFields(document.fields || {}),
    id: reminderId,
    userId,
    firestoreName: name,
  };
}

function parseDeviceDocument(document) {
  const name = normalizeText(document?.name);
  const id = name.split('/').pop() || '';
  const fields = fromFirestoreFields(document?.fields || {});
  const token = normalizeText(fields.token);
  if (!id || !token) {
    return null;
  }
  return {
    ...fields,
    id: decodeURIComponent(id),
    token,
  };
}

async function responseError(response, label, suppliedBody = null) {
  let body = suppliedBody;
  if (!body) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  const detail = normalizeText(
    body?.error?.status || body?.error?.message || body?.error
  );
  return new Error(
    label + ' failed with HTTP ' + response.status + (detail ? ' (' + detail + ')' : '')
  );
}

async function sha256Base64Url(value, cryptoImpl) {
  const digest = await cryptoImpl.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value))
  );
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

export async function createDeliveryId(delivery, cryptoImpl = crypto) {
  const rawIdentity = [
    'v1',
    normalizeText(delivery?.userId),
    normalizeText(delivery?.reminderId),
    String(Number(delivery?.dueAt)),
    normalizeText(delivery?.stageKey),
    normalizeText(delivery?.deviceId),
  ].join('|');
  return 'v1_' + await sha256Base64Url(rawIdentity, cryptoImpl);
}

async function createWebPushTopic(userId, reminderId, cryptoImpl) {
  const digest = await sha256Base64Url(
    'memory-cue|' + normalizeText(userId) + '|' + normalizeText(reminderId),
    cryptoImpl
  );
  return digest.slice(0, 32);
}

function buildReminderPushRecord(reminder = {}) {
  const meetingUrl = normalizeHttpUrl(reminder.meetingUrl);
  return {
    id: requireBoundedText(reminder.id, 'Reminder ID', 256),
    title: truncateUtf8(reminder.title, 400) || 'Reminder',
    due: truncateUtf8(reminder.due, 96) || null,
    notifyAt: truncateUtf8(reminder.notifyAt, 96) || null,
    snoozedUntil: truncateUtf8(reminder.snoozedUntil, 96) || null,
    urgentAlert: reminder.urgentAlert === true,
    hasExplicitTime: reminder.hasExplicitTime === true,
    urgentAcknowledgedAt: normalizeTimestamp(reminder.urgentAcknowledgedAt),
    urgentStartedAt: normalizeTimestamp(reminder.urgentStartedAt),
    done: reminder.done === true || reminder.completed === true,
    priority: truncateUtf8(reminder.priority, 64) || 'Medium',
    category: truncateUtf8(reminder.category, 128) || 'General',
    notes: truncateUtf8(reminder.notes, 600),
    meetingUrl: new TextEncoder().encode(meetingUrl).byteLength <= 768
      ? meetingUrl
      : '',
    updatedAt: normalizeTimestamp(reminder.updatedAt) ?? Date.now(),
    urlPath: normalizeUrlPath(reminder.urlPath),
  };
}

export async function buildFcmMessage(
  {
    claim,
    device,
    reminder,
    urgency,
    badgeCount,
  },
  cryptoImpl = crypto
) {
  const reminderRecord = buildReminderPushRecord(reminder);
  const deliveryStageKey = requireBoundedText(
    urgency?.stage?.key,
    'Delivery stage key',
    128
  );
  const deliveryId = requireBoundedText(
    claim?.deliveryId,
    'Delivery ID',
    128
  );
  const topic = await createWebPushTopic(
    claim.userId,
    reminderRecord.id,
    cryptoImpl
  );
  const result = {
    message: {
      token: normalizeText(device.token),
      data: {
        type: 'memoryCue:reminder-sync',
        action: 'upsert',
        reminder: JSON.stringify(reminderRecord),
        badgeCount: String(Math.max(0, Math.floor(Number(badgeCount) || 0))),
        deliveryStageKey,
        deliveryId,
      },
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: String(PUSH_TTL_SECONDS),
          Topic: topic,
        },
      },
    },
  };
  const dataBytes = new TextEncoder().encode(
    JSON.stringify(result.message.data)
  ).byteLength;
  if (dataBytes > FCM_MAX_DATA_BYTES) {
    throw new TypeError('Reminder push data exceeds the FCM size limit');
  }
  return result;
}

function findFcmErrorCode(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const fcmDetail = details.find((entry) => normalizeText(entry?.errorCode));
  return normalizeText(fcmDetail?.errorCode || body?.error?.status);
}

function isPermanentSendFailure(errorCode, { payloadKnownValid = false } = {}) {
  return (
    errorCode === 'UNREGISTERED'
    || errorCode === 'SENDER_ID_MISMATCH'
    || (payloadKnownValid && errorCode === 'INVALID_ARGUMENT')
  );
}

function shouldRetireToken(errorCode) {
  return (
    errorCode === 'UNREGISTERED'
    || errorCode === 'SENDER_ID_MISMATCH'
  );
}

function randomClaimToken(cryptoImpl) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return cryptoImpl.randomUUID();
  }
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

function retryAfterDelay(value, nowMs) {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const retryAt = Date.parse(text);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : 0;
}

function randomUnitInterval(cryptoImpl) {
  try {
    const values = new Uint32Array(1);
    cryptoImpl.getRandomValues(values);
    return values[0] / 0x100000000;
  } catch {
    return 0.5;
  }
}

function calculateRetryDelay(attemptCount, retryAfterMs, cryptoImpl) {
  const exponent = Math.max(0, Math.min(4, Number(attemptCount) - 1));
  const baseDelay = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * (2 ** exponent)
  );
  const jitteredDelay = Math.round(
    baseDelay * (0.75 + (randomUnitInterval(cryptoImpl) * 0.5))
  );
  return Math.max(jitteredDelay, Math.max(0, Number(retryAfterMs) || 0));
}

export async function createFirebaseRestAdapter(
  env,
  {
    fetchImpl = fetch,
    cryptoImpl = crypto,
    now = () => Date.now(),
    logger = console,
    accessTokenCache = serviceAccountAccessTokenCache,
  } = {}
) {
  const serviceAccount = parseServiceAccount(env);
  assertServiceAccount(serviceAccount);
  const configuredSubrequestBudget = Number(env?.SCHEDULER_MAX_SUBREQUESTS);
  const maximumSubrequests = Number.isFinite(configuredSubrequestBudget)
    && configuredSubrequestBudget > 0
    ? Math.min(900, Math.floor(configuredSubrequestBudget))
    : DEFAULT_SUBREQUEST_BUDGET;
  let subrequestCount = 0;
  let activeAccessToken = '';
  const accessTokenCacheKey = serviceAccountAccessTokenCacheKey(serviceAccount);
  const request = async (...args) => {
    if (subrequestCount >= maximumSubrequests) {
      const error = new Error(
        'Scheduler external-subrequest budget exhausted ('
        + maximumSubrequests + ')'
      );
      error.code = 'SUBREQUEST_BUDGET_EXHAUSTED';
      throw error;
    }
    subrequestCount += 1;
    const response = await fetchImpl(...args);
    if (
      response?.status === 401
      && activeAccessToken
      && typeof accessTokenCache?.get === 'function'
      && typeof accessTokenCache?.delete === 'function'
    ) {
      const cached = accessTokenCache.get(accessTokenCacheKey);
      if (!cached?.accessToken || cached.accessToken === activeAccessToken) {
        accessTokenCache.delete(accessTokenCacheKey);
      }
    }
    return response;
  };
  const accessToken = await getCachedServiceAccountAccessToken(serviceAccount, {
    fetchImpl: request,
    cryptoImpl,
    nowMs: now(),
    cache: accessTokenCache,
  });
  activeAccessToken = accessToken;
  const projectId = serviceAccount.projectId;
  const documentsRoot = firestoreDocumentsRoot(projectId);
  const deviceCache = new Map();

  async function retirePushDeviceRegistrations(userId, device) {
    const registrationIds = [...new Set([
      normalizeText(device?.id),
      ...(Array.isArray(device?.registrationIds)
        ? device.registrationIds.map(normalizeText)
        : []),
    ].filter(Boolean))];
    for (const deviceId of registrationIds) {
      try {
        const deviceUrl = documentsRoot
          + '/users/' + encodeURIComponent(normalizeText(userId))
          + '/pushDevices/' + encodeURIComponent(deviceId);
        const response = await request(deviceUrl, {
          method: 'DELETE',
          headers: authorizationHeaders(accessToken),
        });
        if (!response.ok && response.status !== 404) {
          throw await responseError(response, 'Retiring rejected push device');
        }
      } catch (error) {
        logger.error('Unable to retire a rejected reminder push device', {
          userId: normalizeText(userId),
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (error?.code === 'SUBREQUEST_BUDGET_EXHAUSTED') {
          break;
        }
      }
    }
    deviceCache.delete(normalizeText(userId));
  }

  async function readDeliveryDocument(documentUrl) {
    const response = await request(documentUrl, {
      headers: authorizationHeaders(accessToken),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw await responseError(response, 'Reading urgent delivery claim');
    }
    const document = await response.json();
    return {
      ...fromFirestoreFields(document.fields || {}),
      name: document.name,
      updateTime: document.updateTime,
    };
  }

  async function replaceDeliveryDocument(documentUrl, existing, nextFields) {
    const query = existing?.updateTime
      ? '?currentDocument.updateTime=' + encodeURIComponent(existing.updateTime)
      : '';
    const response = await request(documentUrl + query, {
      method: 'PATCH',
      headers: authorizationHeaders(accessToken, true),
      body: JSON.stringify({
        fields: toFirestoreFields(nextFields),
      }),
    });
    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const errorStatus = normalizeText(body?.error?.status);
      if (
        response.status === 409
        || response.status === 412
        || errorStatus === 'ABORTED'
        || errorStatus === 'FAILED_PRECONDITION'
      ) {
        return null;
      }
      throw await responseError(
        response,
        'Updating urgent delivery claim',
        body
      );
    }
    return response.json();
  }

  return {
    getBudgetState() {
      return {
        used: subrequestCount,
        maximum: maximumSubrequests,
        remaining: Math.max(0, maximumSubrequests - subrequestCount),
      };
    },

    async queryUrgentReminders(nowMs, cutoffMs, limit = DEFAULT_QUERY_LIMIT) {
      const resolvedLimit = Number.isFinite(Number(limit))
        ? Math.max(1, Math.min(1000, Math.floor(Number(limit))))
        : DEFAULT_QUERY_LIMIT;
      const runReminderQuery = async (query) => {
        const response = await request(documentsRoot + ':runQuery', {
          method: 'POST',
          headers: authorizationHeaders(accessToken, true),
          body: JSON.stringify(query),
        });
        if (!response.ok) {
          throw await responseError(response, 'Querying urgent reminders');
        }
        const rows = await response.json();
        return (Array.isArray(rows) ? rows : [])
          .map((row) => parseReminderDocument(row.document))
          .filter(Boolean);
      };

      // Query the current/future window first so a backlog of old unfinished
      // reminders can never push an imminent appointment past the safety limit.
      const upcoming = await runReminderQuery(buildUrgentReminderQuery({
        lowerBoundMs: nowMs,
        upperBoundMs: cutoffMs,
        upperBoundInclusive: true,
        direction: 'ASCENDING',
        limit: resolvedLimit,
      }));
      const remaining = Math.max(0, resolvedLimit - upcoming.length);
      if (!remaining) {
        return upcoming;
      }
      // Within the overdue partition, newest items are the most actionable.
      const overdue = await runReminderQuery(buildUrgentReminderQuery({
        upperBoundMs: nowMs,
        upperBoundInclusive: false,
        direction: 'DESCENDING',
        limit: remaining,
      }));
      return [...upcoming, ...overdue];
    },

    async listPushDevices(userId) {
      const normalizedUserId = normalizeText(userId);
      if (deviceCache.has(normalizedUserId)) {
        return deviceCache.get(normalizedUserId);
      }
      const url = documentsRoot
        + '/users/' + encodeURIComponent(normalizedUserId)
        + '/pushDevices?pageSize=100';
      const response = await request(url, {
        headers: authorizationHeaders(accessToken),
      });
      if (!response.ok) {
        throw await responseError(response, 'Listing reminder push devices');
      }
      const body = await response.json();
      if (normalizeText(body?.nextPageToken)) {
        throw new Error(
          'Push device safety cap exceeded for user; maximum '
          + MAX_PUSH_DEVICE_DOCUMENTS + ' registration records are supported'
        );
      }
      const devices = (Array.isArray(body?.documents) ? body.documents : [])
        .map(parseDeviceDocument)
        .filter(Boolean);
      deviceCache.set(normalizedUserId, devices);
      return devices;
    },

    async claimDelivery(delivery) {
      const deliveryId = await createDeliveryId(delivery, cryptoImpl);
      const collectionUrl = documentsRoot + '/' + DELIVERY_COLLECTION;
      const documentUrl = collectionUrl + '/' + deliveryId;
      const claimToken = randomClaimToken(cryptoImpl);
      const claimNow = Number.isFinite(Number(delivery.nowMs))
        ? Number(delivery.nowMs)
        : now();
      const initialFields = {
        schemaVersion: 1,
        dueAt: Number(delivery.dueAt),
        stageKey: normalizeText(delivery.stageKey),
        status: 'claimed',
        claimToken,
        claimedAt: claimNow,
        leaseUntil: claimNow + DELIVERY_LEASE_MS,
        attemptCount: 1,
        expireAt: new Date(claimNow + DELIVERY_RETENTION_MS),
      };
      const createResponse = await request(
        collectionUrl + '?documentId=' + encodeURIComponent(deliveryId),
        {
          method: 'POST',
          headers: authorizationHeaders(accessToken, true),
          body: JSON.stringify({
            fields: toFirestoreFields(initialFields),
          }),
        }
      );
      if (createResponse.ok) {
        const document = await createResponse.json();
        return {
          ...delivery,
          ...initialFields,
          claimed: true,
          deliveryId,
          documentUrl,
          updateTime: document.updateTime,
        };
      }
      if (createResponse.status !== 409) {
        throw await responseError(createResponse, 'Creating urgent delivery claim');
      }

      const existing = await readDeliveryDocument(documentUrl);
      if (!existing) {
        return { ...delivery, claimed: false, deliveryId, reason: 'claim-race' };
      }
      if (existing.status === 'delivered' || existing.status === 'permanent-failure') {
        return { ...delivery, claimed: false, deliveryId, reason: existing.status };
      }
      if (
        existing.status === 'claimed'
        && Number(existing.leaseUntil) > claimNow
      ) {
        return { ...delivery, claimed: false, deliveryId, reason: 'active-lease' };
      }
      if (
        existing.status === 'failed'
        && Number(existing.nextAttemptAt) > claimNow
      ) {
        return { ...delivery, claimed: false, deliveryId, reason: 'retry-backoff' };
      }

      const attemptCount = Math.max(0, Number(existing.attemptCount) || 0) + 1;
      const reclaimedFields = {
        ...initialFields,
        attemptCount,
      };
      const updated = await replaceDeliveryDocument(
        documentUrl,
        existing,
        reclaimedFields
      );
      if (!updated) {
        return { ...delivery, claimed: false, deliveryId, reason: 'claim-race' };
      }
      return {
        ...delivery,
        ...reclaimedFields,
        claimed: true,
        deliveryId,
        documentUrl,
        updateTime: updated.updateTime,
      };
    },

    async sendReminderPush(input) {
      let fcmMessage;
      try {
        fcmMessage = await buildFcmMessage(input, cryptoImpl);
      } catch (error) {
        return {
          ok: false,
          status: 400,
          errorCode: 'INVALID_ARGUMENT',
          retryable: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const response = await request(
        FCM_API_ROOT
          + '/projects/' + encodeURIComponent(projectId)
          + '/messages:send',
        {
          method: 'POST',
          headers: authorizationHeaders(accessToken, true),
          body: JSON.stringify(fcmMessage),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        return {
          ok: true,
          messageName: normalizeText(body.name),
          status: response.status,
        };
      }
      const errorCode = findFcmErrorCode(body);
      return {
        ok: false,
        status: response.status,
        errorCode,
        retryable: !isPermanentSendFailure(errorCode, {
          payloadKnownValid: true,
        }),
        retryAfterMs: retryAfterDelay(
          response.headers.get('Retry-After'),
          now()
        ),
        error: normalizeText(body?.error?.message) || 'FCM send failed',
      };
    },

    async markDeliveryDelivered(claim, result = {}) {
      const existing = await readDeliveryDocument(claim.documentUrl);
      if (
        !existing
        || existing.status !== 'claimed'
        || existing.claimToken !== claim.claimToken
      ) {
        throw new Error('Urgent delivery claim lease is no longer owned');
      }
      const deliveredAt = now();
      const updated = await replaceDeliveryDocument(claim.documentUrl, existing, {
        ...existing,
        name: undefined,
        updateTime: undefined,
        status: 'delivered',
        deliveredAt,
        leaseUntil: deliveredAt,
        messageName: normalizeText(result.messageName),
        lastStatus: Number(result.status) || 200,
        lastError: '',
        nextAttemptAt: null,
        expireAt: new Date(deliveredAt + DELIVERY_RETENTION_MS),
      });
      if (!updated) {
        throw new Error('Urgent delivery completion lost an update race');
      }
      return true;
    },

    async markDeliveryFailed(claim, result = {}, device = null) {
      const existing = await readDeliveryDocument(claim.documentUrl);
      if (
        !existing
        || existing.status !== 'claimed'
        || existing.claimToken !== claim.claimToken
      ) {
        throw new Error('Urgent delivery claim lease is no longer owned');
      }
      const failedAt = now();
      const retryable = result.retryable !== false;
      const updated = await replaceDeliveryDocument(claim.documentUrl, existing, {
        ...existing,
        name: undefined,
        updateTime: undefined,
        status: retryable ? 'failed' : 'permanent-failure',
        failedAt,
        leaseUntil: failedAt,
        nextAttemptAt: retryable
          ? failedAt + calculateRetryDelay(
            existing.attemptCount,
            result.retryAfterMs,
            cryptoImpl
          )
          : null,
        lastStatus: Number(result.status) || null,
        lastError: normalizeText(result.error || result.errorCode).slice(0, 240),
        expireAt: new Date(failedAt + DELIVERY_RETENTION_MS),
      });
      if (!updated) {
        throw new Error('Urgent delivery failure lost an update race');
      }
      if (!retryable) {
        logger.warn('A reminder push token was rejected permanently', {
          userId: claim.userId,
          deviceId: claim.deviceId,
          errorCode: normalizeText(result.errorCode),
        });
        if (shouldRetireToken(normalizeText(result.errorCode))) {
          await retirePushDeviceRegistrations(claim.userId, device || {
            id: claim.deviceId,
          });
        }
      }
      return true;
    },
  };
}

export const firebaseRestDefaults = Object.freeze({
  deliveryCollection: DELIVERY_COLLECTION,
  deliveryLeaseMs: DELIVERY_LEASE_MS,
  deliveryRetentionMs: DELIVERY_RETENTION_MS,
  queryLimit: DEFAULT_QUERY_LIMIT,
  subrequestBudget: DEFAULT_SUBREQUEST_BUDGET,
  maxPushDeviceDocuments: MAX_PUSH_DEVICE_DOCUMENTS,
  pushTtlSeconds: PUSH_TTL_SECONDS,
});
