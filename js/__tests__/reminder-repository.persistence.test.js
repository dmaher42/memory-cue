/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPOSITORY_PATH = path.resolve(
  __dirname,
  '../../src/repositories/reminderRepository.js',
);

function loadReminderRepository(firebase) {
  let source = fs.readFileSync(REPOSITORY_PATH, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { listReminders, saveReminder, removeReminder, subscribeReminders };\n';

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    Map,
    Boolean,
    getFirebaseContext: async () => firebase,
    requireUid: (value) => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('A uid is required');
      }
      return value.trim();
    },
    normalizeReminder: (reminder) => ({ ...reminder }),
    normalizeReminderList: (reminders) => reminders.map((reminder) => ({ ...reminder })),
  };

  new vm.Script(source, { filename: REPOSITORY_PATH }).runInNewContext(sandbox);
  return module.exports;
}

function createFirebase(overrides = {}) {
  return {
    db: { name: 'reminder-db' },
    collection: jest.fn((...segments) => ({ type: 'collection', segments })),
    orderBy: jest.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    query: jest.fn((...parts) => ({ type: 'query', parts })),
    doc: jest.fn((...segments) => ({ type: 'doc', segments })),
    getDocs: jest.fn(),
    getDocsFromServer: jest.fn(),
    runTransaction: jest.fn(),
    onSnapshot: jest.fn(),
    ...overrides,
  };
}

describe('reminder repository persistence safeguards', () => {
  test('saveReminder refuses to overwrite a strictly newer remote reminder', async () => {
    const transaction = {
      get: jest.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ updatedAt: 200 }),
      }),
      set: jest.fn(),
    };
    const firebase = createFirebase({
      runTransaction: jest.fn((_db, update) => update(transaction)),
    });
    const { saveReminder } = loadReminderRepository(firebase);

    const result = await saveReminder('owner-a', {
      id: 'reminder-a',
      text: 'Older local copy',
      createdAt: 50,
      updatedAt: 100,
    });

    expect(result).toEqual(expect.objectContaining({
      saved: false,
      reason: 'newer-remote-version',
      remoteStateKnown: true,
      remoteReminder: expect.objectContaining({
        id: 'reminder-a',
        userId: 'owner-a',
        updatedAt: 200,
      }),
    }));
    expect(transaction.set).not.toHaveBeenCalled();
  });

  test('a phone action compares against its notification version, not its later click time', async () => {
    const transaction = {
      get: jest.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ updatedAt: 200, title: 'Newer edit' }),
      }),
      set: jest.fn(),
    };
    const firebase = createFirebase({
      runTransaction: jest.fn((_db, update) => update(transaction)),
    });
    const { saveReminder } = loadReminderRepository(firebase);

    const result = await saveReminder('owner-a', {
      id: 'reminder-a',
      title: 'Done from older notification',
      updatedAt: 300,
      done: true,
    }, {
      expectedUpdatedAt: 100,
      requireExisting: true,
    });

    expect(result).toEqual(expect.objectContaining({
      saved: false,
      reason: 'newer-remote-version',
    }));
    expect(transaction.set).not.toHaveBeenCalled();
  });

  test('a phone action cannot recreate a reminder removed after the notification was shown', async () => {
    const transaction = {
      get: jest.fn().mockResolvedValue({ exists: () => false }),
      set: jest.fn(),
    };
    const firebase = createFirebase({
      runTransaction: jest.fn((_db, update) => update(transaction)),
    });
    const { saveReminder } = loadReminderRepository(firebase);

    const result = await saveReminder('owner-a', {
      id: 'reminder-a',
      updatedAt: 300,
      done: true,
    }, {
      expectedUpdatedAt: 100,
      requireExisting: true,
    });

    expect(result).toEqual({
      saved: false,
      reason: 'remote-reminder-missing',
      remoteReminder: null,
      remoteStateKnown: true,
    });
    expect(transaction.set).not.toHaveBeenCalled();
  });

  test.each([
    ['an equal', 200],
    ['a newer', 201],
  ])('saveReminder permits %s incoming version', async (_label, incomingUpdatedAt) => {
    const transaction = {
      get: jest.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ updatedAt: 200 }),
      }),
      set: jest.fn(),
    };
    const firebase = createFirebase({
      runTransaction: jest.fn((_db, update) => update(transaction)),
    });
    const { saveReminder } = loadReminderRepository(firebase);

    const result = await saveReminder('owner-a', {
      id: 'reminder-a',
      text: 'Current local copy',
      createdAt: 50,
      updatedAt: incomingUpdatedAt,
    });

    expect(transaction.set).toHaveBeenCalledTimes(1);
    expect(transaction.set).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'doc',
        segments: expect.arrayContaining(['owner-a', 'reminder-a']),
      }),
      expect.objectContaining({
        id: 'reminder-a',
        userId: 'owner-a',
        updatedAt: incomingUpdatedAt,
      }),
      { merge: true },
    );
    expect(result).toEqual(expect.objectContaining({
      id: 'reminder-a',
      userId: 'owner-a',
      updatedAt: incomingUpdatedAt,
    }));
  });

  test('listReminders performs a server-only read and trusts the Firestore path ID', async () => {
    const firebase = createFirebase({
      getDocsFromServer: jest.fn().mockResolvedValue({
        docs: [{
          id: 'path-reminder-id',
          data: () => ({
            id: 'payload-reminder-id',
            text: 'Server reminder',
            updatedAt: 300,
          }),
        }],
      }),
    });
    const { listReminders } = loadReminderRepository(firebase);

    const reminders = await listReminders('owner-a');

    expect(firebase.getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(firebase.getDocs).not.toHaveBeenCalled();
    expect(reminders).toEqual([
      expect.objectContaining({
        id: 'path-reminder-id',
        text: 'Server reminder',
      }),
    ]);
  });

  test('subscribeReminders passes snapshot authority metadata to its listener', async () => {
    let deliverSnapshot;
    const unsubscribe = jest.fn();
    const firebase = createFirebase({
      onSnapshot: jest.fn((_query, onItems) => {
        deliverSnapshot = onItems;
        return unsubscribe;
      }),
    });
    const { subscribeReminders } = loadReminderRepository(firebase);
    const onItems = jest.fn();

    const returnedUnsubscribe = await subscribeReminders('owner-a', onItems);
    deliverSnapshot({
      docs: [{
        id: 'path-reminder-id',
        data: () => ({ id: 'payload-reminder-id', text: 'Subscribed reminder' }),
      }],
      metadata: { fromCache: false, hasPendingWrites: false },
    });
    deliverSnapshot({
      docs: [],
      metadata: { fromCache: true, hasPendingWrites: true },
    });

    expect(returnedUnsubscribe).toBe(unsubscribe);
    expect(onItems).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ id: 'path-reminder-id' })],
      {
        fromCache: false,
        hasPendingWrites: false,
        serverAuthoritative: true,
      },
    );
    expect(onItems).toHaveBeenNthCalledWith(
      2,
      [],
      {
        fromCache: true,
        hasPendingWrites: true,
        serverAuthoritative: false,
      },
    );
  });

  test('pending delete retry cannot remove a reminder recreated with a newer version', async () => {
    const transaction = {
      get: jest.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ updatedAt: 500, title: 'Recreated elsewhere' }),
      }),
      delete: jest.fn(),
    };
    const firebase = createFirebase({
      runTransaction: jest.fn((_db, update) => update(transaction)),
      deleteDoc: jest.fn(),
    });
    const { removeReminder } = loadReminderRepository(firebase);

    const result = await removeReminder('owner-a', 'reminder-a', { maxUpdatedAt: 400 });

    expect(result).toEqual(expect.objectContaining({
      removed: false,
      reason: 'newer-remote-version',
      remoteReminder: expect.objectContaining({
        id: 'reminder-a',
        userId: 'owner-a',
        updatedAt: 500,
      }),
    }));
    expect(transaction.delete).not.toHaveBeenCalled();
    expect(firebase.deleteDoc).not.toHaveBeenCalled();
  });
});
