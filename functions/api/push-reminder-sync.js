const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
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
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
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
  const reminderId = normalizeText(source.id);
  if (!reminderId) {
    return null;
  }
  return {
    id: reminderId,
    title: normalizeText(source.title) || 'Reminder',
    due: normalizeText(source.due) || null,
    notifyAt: normalizeText(source.notifyAt) || null,
    snoozedUntil: normalizeText(source.snoozedUntil) || null,
    priority: normalizeText(source.priority) || 'Medium',
    category: normalizeText(source.category) || 'General',
    notes: normalizeText(source.notes).slice(0, 240),
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now(),
    urlPath: normalizeText(source.urlPath) || 'mobile.html#reminders',
  };
}

async function sendPushMessage({ accessToken, projectId, token, action, reminder }) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: {
        token,
        data: {
          type: 'memoryCue:reminder-sync',
          action,
          reminder: JSON.stringify(reminder || {}),
        },
        webpush: {
          headers: {
            Urgency: 'high',
          },
          fcm_options: {
            link: reminder?.urlPath || 'mobile.html#reminders',
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

    const body = await context.request.json().catch(() => null);
    const userId = normalizeText(body?.userId);
    const idToken = normalizeText(body?.idToken);
    const action = normalizeText(body?.action) === 'delete' ? 'delete' : 'upsert';
    const reminder = normalizeReminderPayload(body?.reminder || {});
    const targets = Array.isArray(body?.targets)
      ? body.targets
          .map((entry) => ({
            deviceId: normalizeText(entry?.deviceId),
            token: normalizeText(entry?.token),
          }))
          .filter((entry) => entry.token)
      : [];

    if (!userId || !idToken || !targets.length) {
      return jsonResponse({ error: 'Missing push sync payload' }, { status: 400 });
    }
    if (action !== 'delete' && !reminder) {
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

    let sent = 0;
    const failures = [];
    for (const target of targets.slice(0, 20)) {
      const result = await sendPushMessage({
        accessToken,
        projectId: serviceAccount.projectId,
        token: target.token,
        action,
        reminder,
      });
      if (result.ok) {
        sent += 1;
      } else {
        failures.push({
          deviceId: target.deviceId,
          status: result.status,
        });
      }
    }

    return jsonResponse({ sent, failures });
  } catch (error) {
    return jsonResponse(
      { error: 'Push sync failed', details: error.message },
      { status: 500 }
    );
  }
}
