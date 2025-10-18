/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadRemindersModule() {
  const filePath = path.resolve(__dirname, '../reminders.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export\s+async\s+function\s+initReminders/, 'async function initReminders');
  source += '\nmodule.exports = { initReminders };\n';
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    setTimeout,
    clearTimeout,
    window,
    document,
    localStorage,
    navigator,
    Notification,
    fetch: global.fetch,
    Blob: global.Blob,
    Response: global.Response,
    URL: global.URL,
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

class MockNotification {
  static permission = 'granted';
  static requestPermission = jest.fn().mockResolvedValue('granted');

  constructor(title, options) {
    this.title = title;
    this.options = options;
    this.onclose = null;
    this.onclick = null;
    this._listeners = { close: [], click: [] };
    this.close = jest.fn(() => {
      this.closed = true;
      if (typeof this.onclose === 'function') {
        this.onclose();
      }
      this._listeners.close.forEach((handler) => handler());
    });
  }

  addEventListener(event, handler) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(handler);
  }
}

describe('reminder note management', () => {
  let api;
  let firebaseDeps;
  let emitSnapshot;
  let setRemoteReminders;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = '<div id="status"></div>';
    global.fetch = jest.fn();
    window.fetch = global.fetch;
    global.Notification = MockNotification;
    window.Notification = MockNotification;
    navigator.clipboard = navigator.clipboard || { writeText: jest.fn().mockResolvedValue() };

    let snapshotDocs = [];
    const buildSnapshot = () => ({
      forEach: (cb) => {
        snapshotDocs.forEach((entry) => {
          cb({
            id: entry.id,
            data: () => entry.data,
          });
        });
      },
    });

    emitSnapshot = () => {};

    firebaseDeps = {
      initializeApp: jest.fn(() => ({})),
      initializeFirestore: jest.fn(() => ({})),
      getFirestore: jest.fn(() => ({})),
      enableMultiTabIndexedDbPersistence: jest.fn(() => Promise.resolve()),
      enableIndexedDbPersistence: jest.fn(() => Promise.resolve()),
      doc: jest.fn(() => ({})),
      setDoc: jest.fn(() => Promise.resolve()),
      deleteDoc: jest.fn(() => Promise.resolve()),
      onSnapshot: jest.fn((queryRef, onNext) => {
        emitSnapshot = () => onNext(buildSnapshot());
        onNext(buildSnapshot());
        return jest.fn();
      }),
      collection: jest.fn(() => ({})),
      query: jest.fn(() => ({})),
      orderBy: jest.fn(() => ({})),
      persistentLocalCache: jest.fn(() => ({})),
      serverTimestamp: jest.fn(() => new Date()),
      getAuth: jest.fn(() => ({})),
      onAuthStateChanged: jest.fn((auth, cb) => {
        cb({ uid: 'user-1' });
        return jest.fn();
      }),
      GoogleAuthProvider: jest.fn(function Provider() {}),
      signInWithPopup: jest.fn(() => Promise.resolve()),
      signInWithRedirect: jest.fn(() => Promise.resolve()),
      getRedirectResult: jest.fn(() => Promise.resolve(null)),
      signOut: jest.fn(() => Promise.resolve()),
    };

    setRemoteReminders = (reminders) => {
      snapshotDocs = reminders.map((reminder) => ({
        id: reminder.id,
        data: {
          title: reminder.title,
          priority: reminder.priority || 'Medium',
          notes: reminder.notes || '',
          done: !!reminder.done,
          due: reminder.due || null,
          createdAt: { toMillis: () => reminder.createdAt ?? 0 },
          updatedAt: { toMillis: () => reminder.updatedAt ?? 0 },
        },
      }));
      emitSnapshot();
    };

    const remindersModule = loadRemindersModule();
    api = await remindersModule.initReminders({ statusSel: '#status', firebaseDeps });
  });

  afterEach(() => {
    api?.closeActiveNotifications();
    localStorage.clear();
    jest.clearAllTimers();
  });

  test('appends notes to an existing reminder and saves to firestore', () => {
    setRemoteReminders([
      {
        id: 'rem-1',
        title: 'Prepare lesson plan',
        priority: 'High',
        notes: 'Review objectives',
        done: false,
      },
    ]);

    firebaseDeps.setDoc.mockClear();

    const updated = api.addNoteToReminder('rem-1', 'Add warm-up activity');

    expect(updated).toBeDefined();
    expect(updated.notes).toBe('Review objectives\nAdd warm-up activity');
    expect(firebaseDeps.setDoc).toHaveBeenCalledTimes(1);
    const [, payload, options] = firebaseDeps.setDoc.mock.calls[0];
    expect(payload.notes).toBe('Review objectives\nAdd warm-up activity');
    expect(options).toEqual({ merge: true });
  });

  test('returns null when reminder is not found', () => {
    firebaseDeps.setDoc.mockClear();
    const result = api.addNoteToReminder('missing', 'Follow up');
    expect(result).toBeNull();
    expect(firebaseDeps.setDoc).not.toHaveBeenCalled();
  });
});
