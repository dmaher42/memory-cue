import { loadInbox as loadInboxEntries, loadReminders as loadReminderEntries, loadUserCollection } from './firestoreService.js';

const FIREBASE_VERSION = '12.2.1';
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`;
const FIREBASE_AUTH_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`;

let plannerContextPromise = null;

const resolveFirebaseConfig = () => {
  if (typeof globalThis === 'undefined') {
    return null;
  }

  return globalThis?.memoryCueFirebase?.getFirebaseConfig?.() || null;
};

const ensurePlannerContext = async () => {
  if (plannerContextPromise) {
    return plannerContextPromise;
  }

  plannerContextPromise = (async () => {
    const config = resolveFirebaseConfig();
    if (!config?.projectId) {
      console.warn('[planner] Firebase config unavailable.');
      return null;
    }

    const appModule = await import(FIREBASE_APP_URL);
    const authModule = await import(FIREBASE_AUTH_URL);
    const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(config);
    const auth = authModule.getAuth(app);

    return {
      auth,
    };
  })();

  return plannerContextPromise;
};

const resolveUid = async (uid) => {
  if (typeof uid === 'string' && uid.trim()) {
    return uid.trim();
  }

  if (typeof globalThis !== 'undefined' && typeof globalThis.__MEMORY_CUE_AUTH_USER_ID === 'string') {
    const scopedUid = globalThis.__MEMORY_CUE_AUTH_USER_ID.trim();
    if (scopedUid) {
      return scopedUid;
    }
  }

  const context = await ensurePlannerContext();
  return context?.auth?.currentUser?.uid || null;
};

const normalizeItemTitle = (item = {}, fallback = 'Untitled') => {
  if (typeof item?.title === 'string' && item.title.trim()) {
    return item.title.trim();
  }

  if (typeof item?.text === 'string' && item.text.trim()) {
    return item.text.trim();
  }

  if (typeof item?.body === 'string' && item.body.trim()) {
    return item.body.trim();
  }

  return fallback;
};

const parseDueDate = (item = {}) => {
  const rawDue = item?.dueAt || item?.due || item?.reminderDate || item?.metadata?.dueAt || item?.metadata?.due || null;
  if (!rawDue) {
    return null;
  }

  const dueDate = new Date(rawDue);
  return Number.isNaN(dueDate.getTime()) ? null : dueDate;
};

const isToday = (date) => {
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
};

const loadCollection = async (uid, collectionName) => {
  if (!uid) {
    return [];
  }
  return loadUserCollection(uid, collectionName);
};

export const loadReminders = async (uid) => {
  const resolvedUid = await resolveUid(uid);
  return loadReminderEntries(resolvedUid);
};

export const loadNotes = async (uid) => {
  const resolvedUid = await resolveUid(uid);
  return loadCollection(resolvedUid, 'notes');
};

export const loadInbox = async (uid) => {
  const resolvedUid = await resolveUid(uid);
  return loadInboxEntries(resolvedUid);
};

const toPlanItem = (entry, dueDate = null) => ({
  id: entry?.id || null,
  title: normalizeItemTitle(entry),
  dueAt: dueDate ? dueDate.toISOString() : null,
  dueLabel: dueDate
    ? dueDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null,
});

export const generateDailyPlan = async (uid) => {
  console.debug('[planner] generating daily plan');

  const resolvedUid = await resolveUid(uid);
  if (!resolvedUid) {
    return {
      morning: [],
      afternoon: [],
      evening: [],
      suggestedTasks: [],
    };
  }

  const [reminders, inbox, notes] = await Promise.all([
    loadReminders(resolvedUid),
    loadInbox(resolvedUid),
    loadNotes(resolvedUid),
  ]);

  console.debug('[planner] reminders loaded', { count: reminders.length });

  const todayReminders = reminders
    .map((reminder) => ({ reminder, dueDate: parseDueDate(reminder) }))
    .filter(({ dueDate }) => dueDate && isToday(dueDate))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const plan = {
    morning: [],
    afternoon: [],
    evening: [],
    suggestedTasks: [],
  };

  todayReminders.forEach(({ reminder, dueDate }) => {
    const hour = dueDate.getHours();
    const planItem = toPlanItem(reminder, dueDate);

    if (hour < 12) {
      plan.morning.push(planItem);
      return;
    }

    if (hour < 17) {
      plan.afternoon.push(planItem);
      return;
    }

    plan.evening.push(planItem);
  });

  const inboxSuggestions = inbox
    .filter((item) => !parseDueDate(item))
    .map((item) => toPlanItem(item));

  const noteSuggestions = notes
    .slice(0, 3)
    .map((item) => toPlanItem(item));

  plan.suggestedTasks = [...inboxSuggestions, ...noteSuggestions]
    .filter((item, index, list) => list.findIndex((candidate) => candidate.title === item.title) === index)
    .slice(0, 8);

  if (inboxSuggestions.length) {
    console.debug('[planner] inbox suggestions added', { count: inboxSuggestions.length });
  }

  return plan;
};

export const renderDailyPlan = (plan = {}) => {
  const sections = [
    ['Morning', plan?.morning],
    ['Afternoon', plan?.afternoon],
    ['Evening', plan?.evening],
  ];

  const lines = ['Today\'s Plan', ''];

  sections.forEach(([label, items]) => {
    lines.push(label);
    if (Array.isArray(items) && items.length) {
      items.forEach((item) => {
        const duePart = item?.dueLabel ? ` ${item.dueLabel}` : '';
        lines.push(`• ${normalizeItemTitle(item)}${duePart}`);
      });
    } else {
      lines.push('• No scheduled items');
    }
    lines.push('');
  });

  if (Array.isArray(plan?.suggestedTasks) && plan.suggestedTasks.length) {
    lines.push('Suggested Tasks');
    plan.suggestedTasks.forEach((item) => {
      lines.push(`• ${normalizeItemTitle(item)}`);
    });
  }

  return lines.join('\n').trim();
};
