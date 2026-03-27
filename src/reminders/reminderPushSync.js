import { getFirebaseContext, getFirebaseMessagingContext } from '../lib/firebase.js';
import {
  deleteReminderPushDevice,
  listReminderPushDevices,
  saveReminderPushDevice,
} from '../repositories/reminderPushDeviceRepository.js';

const PUSH_DEVICE_ID_KEY = 'memoryCue:pushDeviceId';
const DEFAULT_REMINDER_URL_PATH = 'mobile.html#reminders';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getLocalStorage() {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage;
}

export function getReminderPushDeviceId() {
  const storage = getLocalStorage();
  if (!storage) {
    return '';
  }
  try {
    const existing = normalizeText(storage.getItem(PUSH_DEVICE_ID_KEY));
    if (existing) {
      return existing;
    }
    const nextId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `push-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    storage.setItem(PUSH_DEVICE_ID_KEY, nextId);
    return nextId;
  } catch {
    return '';
  }
}

function isPushRegistrationAvailable() {
  return (
    typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'Notification' in window
  );
}

function buildReminderBody(reminder = {}) {
  const notes = typeof reminder.notes === 'string' ? reminder.notes.trim() : '';
  if (!notes) {
    return '';
  }
  return notes.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function buildReminderSyncPayload(reminder = {}) {
  if (!reminder || typeof reminder !== 'object') {
    return null;
  }
  const reminderId = normalizeText(reminder.id);
  if (!reminderId) {
    return null;
  }
  return {
    id: reminderId,
    title: normalizeText(reminder.title) || normalizeText(reminder.text) || 'Reminder',
    due: normalizeText(reminder.due) || normalizeText(reminder.dueAt) || null,
    notifyAt: normalizeText(reminder.notifyAt) || null,
    snoozedUntil: normalizeText(reminder.snoozedUntil) || null,
    priority: normalizeText(reminder.priority) || 'Medium',
    category: normalizeText(reminder.category) || 'General',
    notes: buildReminderBody(reminder).slice(0, 240),
    updatedAt: Number.isFinite(Number(reminder.updatedAt)) ? Number(reminder.updatedAt) : Date.now(),
    urlPath: normalizeText(reminder.urlPath) || DEFAULT_REMINDER_URL_PATH,
  };
}

async function getCurrentUserIdToken() {
  const firebase = await getFirebaseContext();
  const currentUser = firebase?.auth?.currentUser || null;
  if (!currentUser || typeof currentUser.getIdToken !== 'function') {
    return null;
  }
  return currentUser.getIdToken();
}

export async function registerReminderPushDevice({ userId, serviceWorkerRegistration } = {}) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId || !isPushRegistrationAvailable() || Notification.permission !== 'granted') {
    return null;
  }
  const deviceId = getReminderPushDeviceId();
  if (!deviceId) {
    return null;
  }
  const messagingContext = await getFirebaseMessagingContext();
  if (!messagingContext?.messaging || typeof messagingContext.getToken !== 'function') {
    return null;
  }

  const token = await messagingContext.getToken(messagingContext.messaging, {
    vapidKey: messagingContext.vapidKey,
    serviceWorkerRegistration,
  }).catch((error) => {
    console.warn('[reminder-push] Failed to get registration token', error);
    return null;
  });

  if (!normalizeText(token)) {
    return null;
  }

  return saveReminderPushDevice(normalizedUserId, {
    id: deviceId,
    token,
    updatedAt: Date.now(),
    platform: 'web',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
    notificationPermission: Notification.permission,
  }).catch((error) => {
    console.warn('[reminder-push] Failed to save push device', error);
    return null;
  });
}

export async function unregisterReminderPushDevice({ userId } = {}) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    return false;
  }
  const deviceId = getReminderPushDeviceId();
  if (!deviceId) {
    return false;
  }

  try {
    await deleteReminderPushDevice(normalizedUserId, deviceId);
  } catch (error) {
    console.warn('[reminder-push] Failed to delete push device', error);
  }

  const messagingContext = await getFirebaseMessagingContext();
  if (messagingContext?.messaging && typeof messagingContext.deleteToken === 'function') {
    try {
      await messagingContext.deleteToken(messagingContext.messaging);
    } catch (error) {
      console.warn('[reminder-push] Failed to delete registration token', error);
    }
  }

  return true;
}

export async function syncReminderToOtherDevices({
  userId,
  reminder,
  action = 'upsert',
} = {}) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    return { sent: 0, skipped: true };
  }

  const idToken = await getCurrentUserIdToken().catch(() => null);
  if (!idToken) {
    return { sent: 0, skipped: true };
  }

  const currentDeviceId = getReminderPushDeviceId();
  const devices = await listReminderPushDevices(normalizedUserId).catch((error) => {
    console.warn('[reminder-push] Failed to load push devices', error);
    return [];
  });
  const targets = devices.filter((device) => (
    device
    && device.id !== currentDeviceId
    && normalizeText(device.token)
  ));

  if (!targets.length) {
    return { sent: 0, skipped: true };
  }

  const reminderPayload = buildReminderSyncPayload(reminder);
  const payload = {
    userId: normalizedUserId,
    idToken,
    action: action === 'delete' ? 'delete' : 'upsert',
    targets: targets.map((device) => ({
      deviceId: device.id,
      token: device.token,
    })),
    reminder: reminderPayload,
  };

  const response = await fetch('/api/push-reminder-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.warn('[reminder-push] Push sync request failed', error);
    return null;
  });

  if (!response?.ok) {
    if (response) {
      const message = await response.text().catch(() => '');
      console.warn('[reminder-push] Push sync endpoint failed', response.status, message);
    }
    return { sent: 0, skipped: true };
  }

  return response.json().catch(() => ({ sent: 0 }));
}
