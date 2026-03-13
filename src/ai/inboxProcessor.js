import { createNote, loadAllNotes, saveAllNotes } from '../../js/modules/notes-storage.js';
import { ensureFolderExistsByName } from '../../js/modules/ai-capture-save.js';
import { suggestNotebookAndTags } from '../services/taggingEngine.js';

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
};

const getEntryText = (entry) => {
  if (!entry || typeof entry !== 'object') return '';
  return normalizeText(entry.title || entry.text || entry.content || entry.body || '');
};

const reminderPattern = /\b(remind|reminder|tomorrow|today|tonight|next week|next month|call|schedule|due|deadline|meeting|appointment|follow up)\b/i;
const ideaPattern = /\b(idea|brainstorm|concept|prototype|invent|explore|maybe build)\b/i;
const trainingPattern = /\b(training|workout|practice|drill|exercise|run|gym|conditioning)\b/i;
const personalPattern = /\b(personal|family|mom|dad|parent|home|self|doctor|health)\b/i;
const teachingPattern = /\b(lesson|teaching|classroom|student|curriculum|pompeii)\b/i;

const classifyEntry = (text) => {
  if (!text) {
    return { type: 'note', tags: [] };
  }

  if (reminderPattern.test(text)) {
    return { type: 'reminder', tags: [] };
  }

  if (trainingPattern.test(text)) {
    return { type: 'training', tags: ['training'] };
  }

  if (personalPattern.test(text)) {
    return { type: 'personal', tags: ['personal'] };
  }

  if (teachingPattern.test(text)) {
    return { type: 'note', tags: ['teaching'] };
  }

  if (ideaPattern.test(text)) {
    return { type: 'idea', tags: ['idea'] };
  }

  return { type: 'note', tags: [] };
};

const addNotes = (notes) => {
  if (!Array.isArray(notes) || !notes.length) {
    return;
  }

  const existing = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
  saveAllNotes([...notes, ...existing]);
};

export const processInbox = async (entries = [], options = {}) => {
  const createReminder = typeof options.createReminder === 'function' ? options.createReminder : null;
  const removeInboxEntry = typeof options.removeInboxEntry === 'function' ? options.removeInboxEntry : null;
  const aiClassifier = typeof options.aiClassifier === 'function' ? options.aiClassifier : null;

  const counts = {
    note: 0,
    reminder: 0,
    idea: 0,
    training: 0,
    personal: 0,
  };

  const notesToSave = [];
  const processedItems = [];

  for (const entry of entries) {
    const text = getEntryText(entry);
    if (!text) {
      continue;
    }

    const { type, tags } = classifyEntry(text);
    const organization = await suggestNotebookAndTags(text, { aiClassifier });
    const combinedTags = Array.from(new Set([...(Array.isArray(tags) ? tags : []), ...organization.tags]));

    counts[type] += 1;
    processedItems.push({ ...entry, type, text, tags: combinedTags, notebook: organization.notebook });

    if (type === 'reminder') {
      if (createReminder) {
        createReminder({ title: text, notes: 'Created from Inbox processing.' });
      }
    } else {
      const folderId = ensureFolderExistsByName(organization.notebook);
      notesToSave.push(
        createNote(text.split(/\s+/).slice(0, 8).join(' '), text, {
          folderId,
          metadata: {
            type,
            tags: combinedTags,
          },
        }),
      );
    }

    if (removeInboxEntry && entry?.id != null) {
      removeInboxEntry(String(entry.id));
    }
  }

  addNotes(notesToSave);

  return {
    processedCount: processedItems.length,
    counts,
    processedItems,
    summary: [
      `Processed ${processedItems.length} notes.`,
      `${counts.idea + counts.training} teaching ideas`,
      `${counts.reminder} reminders`,
      `${counts.note + counts.personal} notes`,
    ].join('\n'),
  };
};
