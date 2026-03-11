import { loadAllNotes } from './notes-storage.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toTimestamp = (value) => {
  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeType = (note) => {
  const metadata = note && typeof note.metadata === 'object' && note.metadata ? note.metadata : {};
  const type = typeof metadata.type === 'string' && metadata.type.trim()
    ? metadata.type.trim()
    : typeof note?.type === 'string' && note.type.trim()
      ? note.type.trim()
      : 'note';
  return type;
};

const getRecentEntries = () => {
  const cutoff = Date.now() - (7 * MS_PER_DAY);
  const notes = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];

  return notes
    .map((note) => {
      const timestamp = toTimestamp(note?.updatedAt) || toTimestamp(note?.createdAt);
      return {
        id: typeof note?.id === 'string' ? note.id : '',
        title: typeof note?.title === 'string' && note.title.trim() ? note.title.trim() : 'Untitled note',
        body: typeof note?.bodyText === 'string' ? note.bodyText.trim() : '',
        type: normalizeType(note),
        createdAt: timestamp ? new Date(timestamp).toISOString() : null,
        timestamp,
      };
    })
    .filter((entry) => entry.timestamp >= cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);
};

const groupByType = (entries) => entries.reduce((groups, entry) => {
  const key = entry.type || 'note';
  if (!groups[key]) {
    groups[key] = [];
  }
  groups[key].push(entry);
  return groups;
}, {});

const buildContextFromGroups = (groupedEntries) => {
  const typeNames = Object.keys(groupedEntries);
  if (!typeNames.length) {
    return 'No entries were captured in the last 7 days.';
  }

  return typeNames
    .map((typeName) => {
      const rows = groupedEntries[typeName]
        .map((entry) => {
          const preview = entry.body ? ` — ${entry.body.slice(0, 220)}` : '';
          return `- ${entry.title}${preview}`;
        })
        .join('\n');
      return `Type: ${typeName}\n${rows}`;
    })
    .join('\n\n');
};

export const generateWeeklySummary = async () => {
  const recentEntries = getRecentEntries();
  const groupedEntries = groupByType(recentEntries);
  const memoryContext = buildContextFromGroups(groupedEntries);

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: [
        'Summarise the week.',
        'Return exactly these sections as markdown headings:',
        'Teaching observations',
        'Student conversations',
        'Ideas generated',
        'Outstanding tasks',
      ].join('\n'),
      history: [],
      memoryContext,
      memoryEntries: recentEntries,
    }),
  });

  if (!response.ok) {
    throw new Error(`Weekly summary request failed (${response.status})`);
  }

  const payload = await response.json();
  const summary = typeof payload?.reply === 'string' ? payload.reply.trim() : '';

  return {
    summary,
    groupedEntries,
  };
};

