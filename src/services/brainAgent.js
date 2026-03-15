import { getRecentMemories } from './memoryService.js';

const REMINDERS_STORAGE_KEY = 'memoryCue:offlineReminders';
const NOTES_STORAGE_KEY = 'memoryCueNotes';
const DEFAULT_RECENT_NOTES_LIMIT = 5;
const DEFAULT_IMPORTANT_MEMORIES_LIMIT = 5;

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const toTimestamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const readLocalArray = (key) => {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[brain-agent] Failed to read local storage key', key, error);
    return [];
  }
};

const isToday = (value, now = Date.now()) => {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return false;
  }

  const date = new Date(timestamp);
  const current = new Date(now);

  return date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate();
};

const scoreMemoryImportance = (memory = {}) => {
  const tags = Array.isArray(memory.tags) ? memory.tags.length : 0;
  const updatedAt = toTimestamp(memory.updatedAt || memory.createdAt || 0);
  const recencyScore = updatedAt ? Math.max(0, Date.now() - updatedAt) : Number.MAX_SAFE_INTEGER;
  return tags * 10 - Math.floor(recencyScore / (1000 * 60 * 60));
};

const formatPlannerOutput = ({ reminders = [], notesSummary = '' } = {}) => {
  const lines = [
    "Today's plan",
    '',
    '1 retrieve today\'s reminders',
    '2 retrieve recent notes',
    '3 generate summary',
    '',
  ];

  if (reminders.length) {
    lines.push('Today\'s reminders:');
    reminders.forEach((reminder, index) => {
      const title = normalizeText(reminder?.title) || `Reminder ${index + 1}`;
      lines.push(`- ${title}`);
    });
    lines.push('');
  }

  lines.push(notesSummary || 'No recent notes available.');
  return lines.join('\n');
};

export const retrieveTodaysReminders = (now = Date.now()) => readLocalArray(REMINDERS_STORAGE_KEY)
  .filter((reminder) => isToday(reminder?.due, now));

export const retrieveRecentNotes = (limit = DEFAULT_RECENT_NOTES_LIMIT) => {
  const notes = readLocalArray(NOTES_STORAGE_KEY);

  return notes
    .slice()
    .sort((left, right) => toTimestamp(right?.updatedAt || right?.createdAt) - toTimestamp(left?.updatedAt || left?.createdAt))
    .slice(0, Math.max(0, limit));
};

export const summarizeNotes = (notes = []) => {
  if (!Array.isArray(notes) || !notes.length) {
    return 'No recent notes available.';
  }

  const noteSummaries = notes.map((note, index) => {
    const title = normalizeText(note?.title) || `Note ${index + 1}`;
    const preview = normalizeText(note?.bodyText || note?.body).slice(0, 120);
    return preview ? `${title}: ${preview}` : title;
  });

  return `Recent notes summary: ${noteSummaries.join(' | ')}`;
};

export const detectOverdueReminders = (now = Date.now()) => readLocalArray(REMINDERS_STORAGE_KEY)
  .filter((reminder) => {
    const dueAt = toTimestamp(reminder?.due);
    return dueAt > 0 && dueAt < now && reminder?.done !== true;
  });

export const surfaceImportantMemories = (limit = DEFAULT_IMPORTANT_MEMORIES_LIMIT) => getRecentMemories(100)
  .slice()
  .sort((left, right) => scoreMemoryImportance(right) - scoreMemoryImportance(left))
  .slice(0, Math.max(0, limit));

export const suggestTasks = ({ overdueReminders = [], importantMemories = [] } = {}) => {
  const tasks = [];

  overdueReminders.forEach((reminder) => {
    const title = normalizeText(reminder?.title);
    if (title) {
      tasks.push(`Review overdue reminder: ${title}`);
    }
  });

  importantMemories.forEach((memory) => {
    const text = normalizeText(memory?.text);
    if (text) {
      tasks.push(`Revisit important memory: ${text.slice(0, 80)}`);
    }
  });

  return tasks;
};

export const generateDailyPlan = (now = Date.now()) => {
  const todaysReminders = retrieveTodaysReminders(now);
  const recentNotes = retrieveRecentNotes();
  const notesSummary = summarizeNotes(recentNotes);

  return {
    title: "Today's plan",
    reminders: todaysReminders,
    notes: recentNotes,
    summary: notesSummary,
    output: formatPlannerOutput({ reminders: todaysReminders, notesSummary }),
  };
};

export const createBrainAgent = () => {
  let latestObservation = null;
  let latestAnalysis = null;
  let latestDecision = null;

  const observe = () => {
    latestObservation = {
      now: Date.now(),
      reminders: readLocalArray(REMINDERS_STORAGE_KEY),
      notes: retrieveRecentNotes(),
      memories: getRecentMemories(100),
    };

    return latestObservation;
  };

  const analyze = (observation = latestObservation || observe()) => {
    latestAnalysis = {
      overdueReminders: detectOverdueReminders(observation.now),
      importantMemories: surfaceImportantMemories(),
      notesSummary: summarizeNotes(observation.notes),
    };

    return latestAnalysis;
  };

  const decide = (analysis = latestAnalysis || analyze()) => {
    latestDecision = {
      tasks: suggestTasks({
        overdueReminders: analysis.overdueReminders,
        importantMemories: analysis.importantMemories,
      }),
      dailyPlan: generateDailyPlan(),
    };

    return latestDecision;
  };

  const act = (decision = latestDecision || decide()) => ({
    ...decision,
    generatedAt: Date.now(),
  });

  const run = () => act(decide(analyze(observe())));

  return {
    observe,
    analyze,
    decide,
    act,
    run,
  };
};

export const brainAgent = createBrainAgent();
