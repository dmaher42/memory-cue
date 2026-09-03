/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReminderFirestoreSync() {
  const filePath = path.resolve(__dirname, '../../src/reminders/reminderFirestoreSync.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { createReminderFirestoreSync };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    Boolean,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

const { createReminderFirestoreSync } = loadReminderFirestoreSync();

function applySnapshot(localItems, remoteItems, pendingDeletionItems = new Map()) {
  let items = localItems.map((entry) => ({ ...entry }));
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    ensureOrderIndicesInitialized: (entries) => entries,
    getItems: () => items,
    getPendingDeletionItems: () => pendingDeletionItems,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  sync.applyRemoteReminderItems('user-a', remoteItems);
  return items;
}

test('a newer pending local reminder replaces a stale remote copy with the same id', () => {
  const merged = applySnapshot(
    [{
      id: 'appointment',
      title: 'Marked done on phone',
      done: true,
      updatedAt: 200,
      pendingSync: true,
    }],
    [{
      id: 'appointment',
      title: 'Still active in stale snapshot',
      done: false,
      updatedAt: 100,
      pendingSync: false,
    }],
  );

  expect(merged).toEqual([
    expect.objectContaining({
      id: 'appointment',
      title: 'Marked done on phone',
      done: true,
      updatedAt: 200,
      pendingSync: true,
      userId: 'user-a',
    }),
  ]);
});

test('a pending local reminder wins when the remote copy has the same updatedAt', () => {
  const merged = applySnapshot(
    [{
      id: 'appointment',
      title: 'Local action not uploaded yet',
      done: true,
      updatedAt: 200,
      pendingSync: true,
    }],
    [{
      id: 'appointment',
      title: 'Remote copy at equal timestamp',
      done: false,
      updatedAt: 200,
      pendingSync: false,
    }],
  );

  expect(merged[0]).toEqual(expect.objectContaining({
    title: 'Local action not uploaded yet',
    done: true,
    pendingSync: true,
  }));
});

test('a genuinely newer remote reminder wins over an older pending local copy', () => {
  const merged = applySnapshot(
    [{
      id: 'appointment',
      title: 'Older pending local copy',
      done: true,
      updatedAt: 100,
      pendingSync: true,
    }],
    [{
      id: 'appointment',
      title: 'Newer remote edit',
      done: false,
      updatedAt: 200,
      pendingSync: false,
    }],
  );

  expect(merged[0]).toEqual(expect.objectContaining({
    title: 'Newer remote edit',
    done: false,
    updatedAt: 200,
    pendingSync: false,
  }));
});

test('a pending deletion from another account cannot hide the current account reminder', () => {
  const pendingDeletionItems = new Map([[
    'shared-id',
    { id: 'shared-id', userId: 'user-b', title: 'Other account deletion' },
  ]]);
  const merged = applySnapshot([], [{
    id: 'shared-id',
    userId: 'user-a',
    title: 'Current account reminder',
    updatedAt: 200,
  }], pendingDeletionItems);

  expect(merged).toEqual([
    expect.objectContaining({
      id: 'shared-id',
      userId: 'user-a',
      title: 'Current account reminder',
    }),
  ]);
  expect(pendingDeletionItems.has('shared-id')).toBe(true);
});

test('startup does not upload an older pending local copy over a newer remote reminder', async () => {
  let items = [{
    id: 'appointment',
    title: 'Older pending local copy',
    done: true,
    updatedAt: 100,
    pendingSync: true,
  }];
  const saveToFirebase = jest.fn(async () => true);
  const subscribeRemoteReminders = jest.fn(async () => jest.fn());
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [{
      id: 'appointment',
      title: 'Newer remote edit',
      done: false,
      updatedAt: 200,
      pendingSync: false,
    }],
    subscribeRemoteReminders,
    loadReminders: () => items,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(saveToFirebase).not.toHaveBeenCalled();
  expect(items).toEqual([
    expect.objectContaining({
      id: 'appointment',
      title: 'Newer remote edit',
      done: false,
      updatedAt: 200,
      pendingSync: false,
    }),
  ]);
  expect(subscribeRemoteReminders).toHaveBeenCalledTimes(1);
});

test('startup keeps the saved timestamp and clears pending state after uploading a local edit', async () => {
  let items = [{
    id: 'appointment',
    title: 'Pending local edit',
    updatedAt: 100,
    pendingSync: true,
  }];
  const saveToFirebase = jest.fn(async (entry) => {
    entry.updatedAt = 300;
    entry.pendingSync = true;
    return true;
  });
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => items,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(items).toEqual([
    expect.objectContaining({
      id: 'appointment',
      userId: 'user-a',
      updatedAt: 300,
      pendingSync: false,
    }),
  ]);
});

test('a terminal save conflict applies the authoritative remote winner instead of retaining the local pending edit', async () => {
  let items = [{
    id: 'appointment',
    title: 'Local pending edit',
    userId: 'user-a',
    updatedAt: 300,
    pendingSync: true,
  }];
  const saveToFirebase = jest.fn(async () => ({
    terminalConflict: true,
    remoteStateKnown: true,
    remoteReminder: {
      id: 'appointment',
      title: 'Authoritative remote winner',
      userId: 'user-a',
      updatedAt: 200,
      pendingSync: false,
    },
  }));
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => items,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  const result = await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(result).toEqual(expect.objectContaining({
    authoritative: true,
    pendingWork: false,
  }));
  expect(saveToFirebase).toHaveBeenCalledTimes(1);
  expect(items).toEqual([
    expect.objectContaining({
      id: 'appointment',
      title: 'Authoritative remote winner',
      userId: 'user-a',
      updatedAt: 200,
      pendingSync: false,
    }),
  ]);
});

test('a terminal save conflict with authoritative remote absence removes the local pending edit', async () => {
  let items = [{
    id: 'removed-appointment',
    title: 'Local edit of a remotely removed reminder',
    userId: 'user-a',
    updatedAt: 300,
    pendingSync: true,
  }];
  const saveToFirebase = jest.fn(async () => ({
    terminalConflict: true,
    remoteStateKnown: true,
    remoteReminder: null,
  }));
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => items,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  const result = await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(result).toEqual(expect.objectContaining({
    authoritative: true,
    pendingWork: false,
  }));
  expect(saveToFirebase).toHaveBeenCalledTimes(1);
  expect(items).toEqual([]);
});

test('startup abandons a stale account sync before applying or subscribing', async () => {
  let currentUserId = 'user-a';
  let resolveRemote;
  const remotePromise = new Promise((resolve) => {
    resolveRemote = resolve;
  });
  const setItems = jest.fn();
  const saveToFirebase = jest.fn(async () => true);
  const subscribeRemoteReminders = jest.fn(async () => jest.fn());
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: () => remotePromise,
    subscribeRemoteReminders,
    isCurrentUser: (expectedUserId) => currentUserId === expectedUserId,
    loadReminders: () => [{
      id: 'appointment',
      title: 'Pending user A reminder',
      updatedAt: 200,
      pendingSync: true,
    }],
    saveToFirebase,
    getItems: () => [],
    setItems,
  });

  const setupPromise = sync.setupReminderFirestoreSync({ userId: 'user-a' });
  currentUserId = 'user-b';
  resolveRemote([{
    id: 'appointment',
    title: 'Remote user A reminder',
    updatedAt: 100,
  }]);

  const result = await setupPromise;
  expect(result.authoritative).toBe(false);
  expect(result.unsubscribe).toBeNull();
  expect(saveToFirebase).not.toHaveBeenCalled();
  expect(setItems).not.toHaveBeenCalled();
  expect(subscribeRemoteReminders).not.toHaveBeenCalled();
});

test('a failed remote list reports a non-authoritative offline hydration', async () => {
  const previousUnsubscribe = jest.fn();
  const renderSyncIndicator = jest.fn();
  const setItems = jest.fn();
  const sync = createReminderFirestoreSync({
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => {
      throw new Error('offline');
    },
    loadReminders: () => [],
    setItems,
    renderSyncIndicator,
  });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  const result = await sync.setupReminderFirestoreSync({
    userId: 'user-a',
    currentUnsubscribe: previousUnsubscribe,
  });

  expect(result.authoritative).toBe(false);
  expect(result.unsubscribe).toBeNull();
  expect(previousUnsubscribe).toHaveBeenCalledTimes(1);
  expect(setItems).toHaveBeenCalledWith([]);
  expect(renderSyncIndicator).toHaveBeenCalledWith('offline');
  consoleError.mockRestore();
});

test('listener setup failure keeps the authoritative hydration and reports pending listener work', async () => {
  let items = [{
    id: 'appointment',
    title: 'Stale local copy',
    userId: 'user-a',
    updatedAt: 100,
    pendingSync: false,
  }];
  const onPendingWork = jest.fn();
  const renderSyncIndicator = jest.fn();
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [{
      id: 'appointment',
      title: 'Authoritative server copy',
      userId: 'user-a',
      updatedAt: 200,
      pendingSync: false,
    }],
    subscribeRemoteReminders: async () => {
      throw new Error('listener setup failed');
    },
    loadReminders: () => items,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
    onPendingWork,
    renderSyncIndicator,
  });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  const result = await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(result).toEqual({
    unsubscribe: null,
    authoritative: true,
    pendingWork: true,
  });
  expect(items).toEqual([
    expect.objectContaining({
      id: 'appointment',
      title: 'Authoritative server copy',
      updatedAt: 200,
      pendingSync: false,
    }),
  ]);
  expect(onPendingWork).toHaveBeenCalledTimes(1);
  expect(renderSyncIndicator).toHaveBeenCalledWith('offline');
  consoleError.mockRestore();
});

test('a live reminder listener error reports pending reconciliation work', async () => {
  let listenerError = null;
  const onPendingWork = jest.fn();
  const renderSyncIndicator = jest.fn();
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [],
    subscribeRemoteReminders: async (_userId, _onSnapshot, onError) => {
      listenerError = onError;
      return jest.fn();
    },
    loadReminders: () => [],
    getItems: () => [],
    onPendingWork,
    renderSyncIndicator,
  });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  const result = await sync.setupReminderFirestoreSync({ userId: 'user-a' });
  expect(result.authoritative).toBe(true);
  expect(onPendingWork).not.toHaveBeenCalled();

  listenerError(new Error('listener disconnected'));

  expect(onPendingWork).toHaveBeenCalledTimes(1);
  expect(renderSyncIndicator).toHaveBeenCalledWith('offline');
  consoleError.mockRestore();
});

test('a stale subscription callback cannot apply the previous account snapshot', async () => {
  let currentUserId = 'user-a';
  let subscriptionCallback = null;
  const setItems = jest.fn();
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [],
    subscribeRemoteReminders: async (_userId, onSnapshot) => {
      subscriptionCallback = onSnapshot;
      return jest.fn();
    },
    isCurrentUser: (expectedUserId) => currentUserId === expectedUserId,
    loadReminders: () => [],
    getItems: () => [],
    setItems,
  });

  const result = await sync.setupReminderFirestoreSync({ userId: 'user-a' });
  expect(result.authoritative).toBe(true);
  expect(typeof result.unsubscribe).toBe('function');
  const callsAfterInitialHydration = setItems.mock.calls.length;
  currentUserId = 'user-b';
  subscriptionCallback([{
    id: 'late-user-a-reminder',
    title: 'Late User A snapshot',
    userId: 'user-a',
    updatedAt: 500,
  }]);

  expect(setItems).toHaveBeenCalledTimes(callsAfterInitialHydration);
});

test('signing into another account quarantines foreign pending reminders instead of uploading them', async () => {
  let items = [{
    id: 'user-a-appointment',
    title: 'User A pending edit',
    userId: 'user-a',
    updatedAt: 300,
    pendingSync: true,
  }];
  const saveToFirebase = jest.fn(async () => true);
  const quarantinePendingReminders = jest.fn(() => true);
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [{
      id: 'user-b-appointment',
      title: 'User B reminder',
      userId: 'user-b',
      updatedAt: 200,
      pendingSync: false,
    }],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => items,
    quarantinePendingReminders,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-b' });

  expect(saveToFirebase).not.toHaveBeenCalled();
  expect(quarantinePendingReminders).toHaveBeenCalledWith([
    expect.objectContaining({
      id: 'user-a-appointment',
      userId: 'user-a',
      pendingSync: true,
    }),
  ]);
  expect(items).toEqual([
    expect.objectContaining({
      id: 'user-b-appointment',
      userId: 'user-b',
    }),
  ]);
});

test('restores a quarantined pending reminder only for its matching account', async () => {
  let items = [];
  const saveToFirebase = jest.fn(async () => true);
  const clearQuarantinedPendingReminders = jest.fn();
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => [],
    loadQuarantinedPendingReminders: () => [{
      id: 'user-a-appointment',
      title: 'User A pending edit',
      userId: 'user-a',
      updatedAt: 300,
      pendingSync: true,
    }],
    clearQuarantinedPendingReminders,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(saveToFirebase).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'user-a-appointment',
      userId: 'user-a',
    }),
    { expectedUserId: 'user-a' }
  );
  expect(clearQuarantinedPendingReminders).toHaveBeenCalledWith(
    'user-a',
    ['user-a-appointment']
  );
  expect(items).toEqual([
    expect.objectContaining({
      id: 'user-a-appointment',
      userId: 'user-a',
      pendingSync: false,
    }),
  ]);
});

test('a failed quarantined reminder upload stays pending and is not cleared', async () => {
  let items = [];
  const quarantinedReminder = {
    id: 'user-a-offline-appointment',
    title: 'Still waiting to upload',
    userId: 'user-a',
    updatedAt: 300,
    pendingSync: true,
  };
  const clearQuarantinedPendingReminders = jest.fn();
  const saveToFirebase = jest.fn(async () => false);
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => [],
    loadQuarantinedPendingReminders: () => [quarantinedReminder],
    clearQuarantinedPendingReminders,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  const result = await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(result.authoritative).toBe(true);
  expect(result.pendingWork).toBe(true);
  expect(saveToFirebase).toHaveBeenCalledTimes(1);
  expect(clearQuarantinedPendingReminders).not.toHaveBeenCalled();
  expect(items).toEqual([
    expect.objectContaining({
      id: 'user-a-offline-appointment',
      userId: 'user-a',
      updatedAt: 300,
      pendingSync: true,
    }),
  ]);
});

test('account switching aborts safely when foreign pending reminders cannot be quarantined', async () => {
  const listRemoteReminders = jest.fn(async () => []);
  const setItems = jest.fn();
  const previousUnsubscribe = jest.fn();
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders,
    loadReminders: () => [{
      id: 'user-a-unsynced',
      userId: 'user-a',
      title: 'Must not be discarded',
      updatedAt: 300,
      pendingSync: true,
    }],
    quarantinePendingReminders: () => false,
    getItems: () => [],
    setItems,
  });

  const result = await sync.setupReminderFirestoreSync({
    userId: 'user-b',
    currentUnsubscribe: previousUnsubscribe,
  });

  expect(result).toEqual(expect.objectContaining({
    authoritative: false,
    pendingWork: true,
  }));
  expect(previousUnsubscribe).toHaveBeenCalledTimes(1);
  expect(listRemoteReminders).not.toHaveBeenCalled();
  expect(setItems).not.toHaveBeenCalled();
});

test('a latency-compensated listener absence cannot clear a durable delete', async () => {
  let items = [];
  let tombstones = [{
    type: 'delete',
    id: 'delete-awaiting-server',
    userId: 'user-a',
    updatedAt: 200,
  }];
  let onSnapshot = null;
  const clearPendingReminderDeletions = jest.fn((ownerUserId, reminderIds) => {
    tombstones = tombstones.filter((record) => (
      record.userId !== ownerUserId || !reminderIds.includes(record.id)
    ));
    return true;
  });
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [{
      id: 'delete-awaiting-server',
      userId: 'user-a',
      title: 'Still on the server',
      updatedAt: 100,
    }],
    subscribeRemoteReminders: async (_userId, callback) => {
      onSnapshot = callback;
      return jest.fn();
    },
    loadReminders: () => [],
    loadPendingReminderDeletions: () => tombstones,
    clearPendingReminderDeletions,
    retryPendingReminderDeletion: async () => false,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  const result = await sync.setupReminderFirestoreSync({ userId: 'user-a' });
  expect(result.pendingWork).toBe(true);
  expect(tombstones).toHaveLength(1);

  onSnapshot([], {
    fromCache: false,
    hasPendingWrites: true,
    serverAuthoritative: false,
  });
  expect(tombstones).toHaveLength(1);
  expect(clearPendingReminderDeletions).not.toHaveBeenCalled();

  onSnapshot([], {
    fromCache: false,
    hasPendingWrites: false,
    serverAuthoritative: true,
  });
  expect(tombstones).toEqual([]);
});

test('a delete tombstone is cleared only after quarantined upsert cleanup succeeds', () => {
  const tombstone = {
    type: 'delete',
    id: 'delete-after-offline-upsert',
    userId: 'user-a',
    updatedAt: 200,
  };
  let cleanupSucceeds = false;
  const cleanupOrder = [];
  const onPendingWork = jest.fn();
  const clearQuarantinedPendingReminders = jest.fn(() => {
    cleanupOrder.push('upsert');
    return cleanupSucceeds;
  });
  const clearPendingReminderDeletions = jest.fn(() => {
    cleanupOrder.push('delete');
    return true;
  });
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    ensureOrderIndicesInitialized: (entries) => entries,
    loadPendingReminderDeletions: () => [tombstone],
    clearQuarantinedPendingReminders,
    clearPendingReminderDeletions,
    getItems: () => [],
    onPendingWork,
  });

  const failedCleanup = sync.applyRemoteReminderItems('user-a', [], {
    allowAbsenceConfirmation: true,
  });

  expect(failedCleanup).toEqual({ pendingWork: true });
  expect(cleanupOrder).toEqual(['upsert']);
  expect(clearPendingReminderDeletions).not.toHaveBeenCalled();
  expect(onPendingWork).toHaveBeenCalledTimes(1);

  cleanupSucceeds = true;
  cleanupOrder.length = 0;
  onPendingWork.mockClear();
  const completedCleanup = sync.applyRemoteReminderItems('user-a', [], {
    allowAbsenceConfirmation: true,
  });

  expect(completedCleanup).toEqual({ pendingWork: false });
  expect(cleanupOrder).toEqual(['upsert', 'delete']);
  expect(onPendingWork).not.toHaveBeenCalled();
});

test('Firestore collection ownership overrides a conflicting payload user id', () => {
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
  });

  expect(sync.mapFirestoreReminder('user-a', 'appointment', {
    id: 'appointment',
    userId: 'user-b',
    title: 'Malformed owner payload',
  })).toEqual(expect.objectContaining({
    id: 'appointment',
    userId: 'user-a',
  }));
});

test('Firestore document identity overrides a conflicting payload id', () => {
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
  });

  expect(sync.mapFirestoreReminder('user-a', 'path-appointment', {
    id: 'stale-payload-id',
    userId: 'user-a',
    title: 'Malformed identity payload',
  })).toEqual(expect.objectContaining({
    id: 'path-appointment',
    userId: 'user-a',
  }));
});

test('an owner-scoped delete tombstone hides only its account when ids collide', () => {
  const tombstone = {
    type: 'delete',
    id: 'shared-id',
    userId: 'user-a',
    updatedAt: 200,
  };
  let userAItems = [];
  const userASync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    ensureOrderIndicesInitialized: (entries) => entries,
    loadPendingReminderDeletions: () => [tombstone],
    getItems: () => userAItems,
    setItems: (nextItems) => {
      userAItems = nextItems;
    },
  });
  userASync.applyRemoteReminderItems('user-a', [{
    id: 'shared-id',
    userId: 'user-a',
    title: 'User A remote reminder',
    updatedAt: 100,
  }]);
  expect(userAItems).toEqual([]);

  let userBItems = [];
  const clearPendingReminderDeletions = jest.fn(() => true);
  const userBSync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    ensureOrderIndicesInitialized: (entries) => entries,
    loadPendingReminderDeletions: () => [tombstone],
    clearPendingReminderDeletions,
    getItems: () => userBItems,
    setItems: (nextItems) => {
      userBItems = nextItems;
    },
  });
  userBSync.applyRemoteReminderItems('user-b', [{
    id: 'shared-id',
    userId: 'user-a',
    title: 'User B remote reminder',
    updatedAt: 100,
  }]);

  expect(userBItems).toEqual([
    expect.objectContaining({
      id: 'shared-id',
      userId: 'user-b',
      title: 'User B remote reminder',
    }),
  ]);
  expect(clearPendingReminderDeletions).not.toHaveBeenCalled();
});

test('matching-account startup retries a durable delete without uploading the cached reminder', async () => {
  const tombstone = {
    type: 'delete',
    id: 'pending-delete',
    userId: 'user-a',
    updatedAt: 200,
  };
  let items = [{
    id: 'pending-delete',
    userId: 'user-a',
    title: 'Crash-left cached reminder',
    updatedAt: 100,
    pendingSync: true,
  }];
  const retryPendingReminderDeletion = jest.fn(async () => true);
  const clearPendingReminderDeletions = jest.fn();
  const saveToFirebase = jest.fn(async () => true);
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [{
      id: 'pending-delete',
      userId: 'user-a',
      title: 'Remote reminder awaiting delete',
      updatedAt: 100,
    }],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => items,
    loadPendingReminderDeletions: () => [tombstone],
    clearPendingReminderDeletions,
    retryPendingReminderDeletion,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(retryPendingReminderDeletion).toHaveBeenCalledWith(tombstone);
  expect(clearPendingReminderDeletions).toHaveBeenCalledWith('user-a', ['pending-delete']);
  expect(saveToFirebase).not.toHaveBeenCalled();
  expect(items).toEqual([]);
});

test('a failed matching-account delete retry remains hidden through listener replay', async () => {
  const tombstone = {
    type: 'delete',
    id: 'pending-delete',
    userId: 'user-a',
    updatedAt: 200,
  };
  const remoteReminder = {
    id: 'pending-delete',
    userId: 'user-a',
    title: 'Remote reminder awaiting retry',
    updatedAt: 100,
  };
  let items = [{ ...remoteReminder, pendingSync: true }];
  let onSnapshot = null;
  const clearPendingReminderDeletions = jest.fn();
  const saveToFirebase = jest.fn(async () => true);
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [remoteReminder],
    subscribeRemoteReminders: async (_userId, callback) => {
      onSnapshot = callback;
      return jest.fn();
    },
    loadReminders: () => items,
    loadPendingReminderDeletions: () => [tombstone],
    clearPendingReminderDeletions,
    retryPendingReminderDeletion: async () => false,
    saveToFirebase,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-a' });
  expect(items).toEqual([]);
  expect(saveToFirebase).not.toHaveBeenCalled();
  expect(clearPendingReminderDeletions).not.toHaveBeenCalled();

  onSnapshot([remoteReminder]);
  expect(items).toEqual([]);
  expect(clearPendingReminderDeletions).not.toHaveBeenCalled();
});

test('a strictly newer remote reminder supersedes an older pending delete', async () => {
  const tombstone = {
    type: 'delete',
    id: 'recreated-reminder',
    userId: 'user-a',
    updatedAt: 200,
  };
  let items = [];
  const retryPendingReminderDeletion = jest.fn(async () => true);
  const clearPendingReminderDeletions = jest.fn(() => true);
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders: async () => [{
      id: 'recreated-reminder',
      userId: 'user-a',
      title: 'Recreated after deletion',
      updatedAt: 300,
    }],
    subscribeRemoteReminders: async () => jest.fn(),
    loadReminders: () => [],
    loadPendingReminderDeletions: () => [tombstone],
    clearPendingReminderDeletions,
    retryPendingReminderDeletion,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(retryPendingReminderDeletion).not.toHaveBeenCalled();
  expect(clearPendingReminderDeletions).toHaveBeenCalledWith('user-a', ['recreated-reminder']);
  expect(items).toEqual([
    expect.objectContaining({
      id: 'recreated-reminder',
      userId: 'user-a',
      title: 'Recreated after deletion',
    }),
  ]);
});

test('multiple account A deletes wait through account B and retry only when A returns', async () => {
  let currentUserId = 'user-b';
  let items = [];
  let tombstones = [
    { type: 'delete', id: 'completed-1', userId: 'user-a', updatedAt: 200 },
    { type: 'delete', id: 'completed-2', userId: 'user-a', updatedAt: 201 },
  ];
  const retryPendingReminderDeletion = jest.fn(async () => true);
  const clearPendingReminderDeletions = jest.fn((ownerUserId, reminderIds) => {
    tombstones = tombstones.filter((record) => (
      record.userId !== ownerUserId || !reminderIds.includes(record.id)
    ));
    return true;
  });
  const listRemoteReminders = jest.fn(async (ownerUserId) => (
    ownerUserId === 'user-b'
      ? [
          { id: 'completed-1', title: 'User B one', updatedAt: 100 },
          { id: 'completed-2', title: 'User B two', updatedAt: 100 },
        ]
      : [
          { id: 'completed-1', title: 'User A one', updatedAt: 100 },
          { id: 'completed-2', title: 'User A two', updatedAt: 100 },
        ]
  ));
  const sync = createReminderFirestoreSync({
    normalizeReminderRecord: (entry) => ({ ...entry }),
    normalizeReminderList: (entries) => entries.map((entry) => ({ ...entry })),
    ensureOrderIndicesInitialized: (entries) => entries,
    listRemoteReminders,
    subscribeRemoteReminders: async () => jest.fn(),
    isCurrentUser: (expectedUserId) => expectedUserId === currentUserId,
    loadReminders: () => items,
    loadPendingReminderDeletions: () => tombstones,
    clearPendingReminderDeletions,
    retryPendingReminderDeletion,
    getItems: () => items,
    setItems: (nextItems) => {
      items = nextItems;
    },
  });

  await sync.setupReminderFirestoreSync({ userId: 'user-b' });
  expect(retryPendingReminderDeletion).not.toHaveBeenCalled();
  expect(items).toEqual([
    expect.objectContaining({ id: 'completed-1', userId: 'user-b' }),
    expect.objectContaining({ id: 'completed-2', userId: 'user-b' }),
  ]);
  expect(tombstones).toHaveLength(2);

  currentUserId = 'user-a';
  await sync.setupReminderFirestoreSync({ userId: 'user-a' });

  expect(retryPendingReminderDeletion).toHaveBeenCalledTimes(2);
  expect(retryPendingReminderDeletion.mock.calls.map(([record]) => record.userId))
    .toEqual(['user-a', 'user-a']);
  expect(tombstones).toEqual([]);
  expect(items).toEqual([]);
});
