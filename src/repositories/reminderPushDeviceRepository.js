import { getFirebaseContext, requireUid } from '../lib/firebase.js';

const pushDevicesCollection = (firebase, uid) => (
  firebase.collection(firebase.db, 'users', requireUid(uid), 'pushDevices')
);

const requirePushDeviceFirebase = async (uid, action) => {
  const firebase = await getFirebaseContext();
  const normalizedUid = requireUid(uid);
  if (!firebase) {
    const error = new Error(`Firebase unavailable for reminder push device ${action}`);
    error.code = 'firebase-unavailable';
    throw error;
  }
  return {
    firebase,
    uid: normalizedUid,
  };
};

const normalizeDeviceRecord = (device = {}) => {
  const record = device && typeof device === 'object' ? device : {};
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  if (!id || !token) {
    return null;
  }
  return {
    id,
    token,
    updatedAt: Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : Date.now(),
    platform: typeof record.platform === 'string' && record.platform.trim() ? record.platform.trim() : 'web',
    userAgent: typeof record.userAgent === 'string' ? record.userAgent : '',
    notificationPermission:
      typeof record.notificationPermission === 'string' && record.notificationPermission.trim()
        ? record.notificationPermission.trim()
        : 'default',
  };
};

export const listReminderPushDevices = async (uid) => {
  const { firebase, uid: normalizedUid } = await requirePushDeviceFirebase(uid, 'list');
  const snapshot = await firebase.getDocs(pushDevicesCollection(firebase, normalizedUid));
  return snapshot.docs
    .map((entry) => normalizeDeviceRecord({ id: entry.id, ...entry.data() }))
    .filter(Boolean);
};

export const saveReminderPushDevice = async (uid, device) => {
  const { firebase, uid: normalizedUid } = await requirePushDeviceFirebase(uid, 'save');
  const normalizedDevice = normalizeDeviceRecord(device);
  if (!normalizedDevice) {
    throw new Error('Invalid push device record');
  }
  await firebase.setDoc(
    firebase.doc(firebase.db, 'users', normalizedUid, 'pushDevices', requireUid(normalizedDevice.id)),
    normalizedDevice,
    { merge: true }
  );
  return normalizedDevice;
};

export const deleteReminderPushDevice = async (uid, deviceId) => {
  const { firebase, uid: normalizedUid } = await requirePushDeviceFirebase(uid, 'delete');
  await firebase.deleteDoc(
    firebase.doc(firebase.db, 'users', normalizedUid, 'pushDevices', requireUid(deviceId))
  );
};
