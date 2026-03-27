import { createNote, loadAllNotes, saveAllNotes } from '../../js/modules/notes-storage.js';
import { requestAssistantChat } from './assistantOrchestrator.js';

const ACTIVE_LESSON_NOTE_ID_KEY = 'memoryCue:activeLessonNoteId';

const dispatchActiveLessonUpdated = (noteId = null) => {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }

  document.dispatchEvent(new CustomEvent('memoryCue:activeLessonUpdated', {
    detail: {
      noteId: typeof noteId === 'string' && noteId.trim() ? noteId.trim() : null,
    },
  }));
};

const normalizeText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\r/g, '').trim();
};

const toPlainText = (note = {}) => {
  const bodyText = typeof note?.bodyText === 'string' ? note.bodyText.trim() : '';
  if (bodyText) {
    return bodyText;
  }
  const body = typeof note?.body === 'string' ? note.body : '';
  if (!body) {
    return '';
  }
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

const extractLines = (text = '') => normalizeText(text)
  .split('\n')
  .map((line) => line.replace(/^[\s\-*•\d.)]+/, '').trim())
  .filter(Boolean);

const findLine = (lines = [], patterns = []) => {
  if (!Array.isArray(lines) || !lines.length) {
    return '';
  }
  const matcher = Array.isArray(patterns) ? patterns : [];
  return lines.find((line) => matcher.some((pattern) => pattern.test(line))) || '';
};

const firstQuestionLine = (lines = []) => (
  Array.isArray(lines)
    ? lines.find((line) => line.includes('?') || /\b(ask|question|discuss)\b/i.test(line))
    : ''
) || '';

const buildFallbackCueBody = (note = {}) => {
  const title = normalizeText(note?.title) || 'Lesson';
  const text = toPlainText(note);
  const lines = extractLines(text);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const goal = findLine(lines, [/\b(goal|objective|learning intention|success criteria)\b/i])
    || lines[0]
    || `Teach the main idea in ${title}.`;

  const say = findLine(lines, [/^say[:\s-]/i, /\b(explain|introduce|model)\b/i])
    || sentences[0]
    || `Introduce ${title} clearly and simply.`;

  const teachCandidates = lines.filter((line) => line !== goal && line !== say && !line.includes('?'));
  const teach = teachCandidates.slice(0, 3).join(' | ') || `Focus on the most important example from ${title}.`;

  const ask = firstQuestionLine(lines) || `Ask students what they notice about ${title.toLowerCase()}.`;

  const next = findLine(lines, [/\b(next|then|after that|independent|guided|practice|plenary|closing)\b/i])
    || teachCandidates[3]
    || 'Model one example, then move students into guided practice.';

  const materials = findLine(lines, [/\b(materials|resources|bring|worksheet|slides)\b/i]) || 'Use the materials already prepared for this lesson.';
  const reminder = findLine(lines, [/\b(remind|check|collect|follow up|before class|after class)\b/i]) || 'Pause to check understanding before moving on.';

  return [
    `Goal: ${goal}`,
    `Say: ${say}`,
    `Teach: ${teach}`,
    `Ask: ${ask}`,
    `Next: ${next}`,
    `Materials: ${materials}`,
    `Reminder: ${reminder}`,
  ].join('\n');
};

const buildCueRequest = (note = {}) => {
  const title = normalizeText(note?.title) || 'Lesson';
  const sourceText = toPlainText(note).slice(0, 6000);

  return {
    messages: [
      {
        role: 'system',
        content: [
          'You are Memory Cue in Teacher Mode.',
          'Turn lesson material into a short cue card for a teacher under pressure.',
          'Be concise, spoken-language friendly, and practical.',
          'Return exactly these seven lines:',
          'Goal: ...',
          'Say: ...',
          'Teach: ...',
          'Ask: ...',
          'Next: ...',
          'Materials: ...',
          'Reminder: ...',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Lesson title: ${title}`,
          '',
          'Lesson source:',
          sourceText || title,
        ].join('\n'),
      },
    ],
    message: `Create lesson cue for ${title}`,
  };
};

const normalizeCueBody = (text = '', note = {}) => {
  const normalized = normalizeText(text);
  if (!normalized) {
    return buildFallbackCueBody(note);
  }

  const lines = extractLines(normalized);
  const requiredLabels = ['Goal', 'Say', 'Teach', 'Ask', 'Next', 'Materials', 'Reminder'];
  const hasAllLabels = requiredLabels.every((label) => lines.some((line) => new RegExp(`^${label}:`, 'i').test(line)));
  if (hasAllLabels) {
    return lines.join('\n');
  }

  return buildFallbackCueBody({
    ...note,
    bodyText: normalized,
  });
};

const buildCueTitle = (note = {}) => {
  const title = normalizeText(note?.title) || 'Lesson';
  return title.endsWith(' Cue') ? title : `${title} Cue`;
};

const ensureTeacherMetadata = (note = {}, noteType = 'lesson-source', extra = {}) => ({
  ...(note.metadata && typeof note.metadata === 'object' ? note.metadata : {}),
  teaching: true,
  noteType,
  ...extra,
});

export const getActiveLessonNoteId = () => {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const value = localStorage.getItem(ACTIVE_LESSON_NOTE_ID_KEY);
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
};

export const isActiveLessonNoteId = (noteId) => {
  if (typeof noteId !== 'string' || !noteId.trim()) {
    return false;
  }
  return getActiveLessonNoteId() === noteId.trim();
};

export const setActiveLessonNoteId = (noteId) => {
  const normalizedId = typeof noteId === 'string' && noteId.trim() ? noteId.trim() : null;
  if (typeof localStorage !== 'undefined') {
    try {
      if (normalizedId) {
        localStorage.setItem(ACTIVE_LESSON_NOTE_ID_KEY, normalizedId);
      } else {
        localStorage.removeItem(ACTIVE_LESSON_NOTE_ID_KEY);
      }
    } catch {
      /* ignore storage errors */
    }
  }
  dispatchActiveLessonUpdated(normalizedId);
  return normalizedId;
};

export const getActiveLessonNote = (notes = null) => {
  const activeLessonNoteId = getActiveLessonNoteId();
  if (!activeLessonNoteId) {
    return null;
  }
  const sourceNotes = Array.isArray(notes) ? notes : loadAllNotes();
  return sourceNotes.find((note) => note?.id === activeLessonNoteId) || null;
};

export const createLessonCueFromNote = async (noteId) => {
  const normalizedId = typeof noteId === 'string' ? noteId.trim() : '';
  if (!normalizedId) {
    return null;
  }

  const notes = loadAllNotes();
  const sourceNote = notes.find((note) => note?.id === normalizedId);
  if (!sourceNote) {
    return null;
  }

  let cueBody = '';
  try {
    cueBody = await requestAssistantChat(buildCueRequest(sourceNote), {
      fallbackReply: '',
    });
  } catch {
    cueBody = '';
  }

  const normalizedCueBody = normalizeCueBody(cueBody, sourceNote);
  const timestamp = new Date().toISOString();
  const cueNote = createNote(buildCueTitle(sourceNote), normalizedCueBody, {
    folderId: sourceNote.folderId,
    bodyText: normalizedCueBody,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: ensureTeacherMetadata(sourceNote, 'lesson-cue', {
      sourceNoteId: sourceNote.id,
    }),
  });

  const updatedNotes = notes.map((note) => (
    note?.id === sourceNote.id
      ? {
        ...note,
        metadata: ensureTeacherMetadata(note, 'lesson-source'),
        updatedAt: note.updatedAt || timestamp,
      }
      : note
  ));

  saveAllNotes([cueNote, ...updatedNotes]);
  setActiveLessonNoteId(cueNote.id);
  return cueNote;
};

const getCueLine = (note, prefix) => {
  const lines = extractLines(toPlainText(note));
  const match = lines.find((line) => line.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
  return match ? match.slice(prefix.length + 1).trim() : '';
};

const buildLessonFallbackAnswer = (question, note) => {
  const normalizedQuestion = normalizeText(question).toLowerCase();
  const title = normalizeText(note?.title) || 'this lesson';
  const next = getCueLine(note, 'Next');
  const say = getCueLine(note, 'Say');
  const ask = getCueLine(note, 'Ask');
  const teach = getCueLine(note, 'Teach');
  const goal = getCueLine(note, 'Goal');

  if (/\bnext\b/.test(normalizedQuestion) && next) {
    return next;
  }
  if (/\b(say|explain|simpler|simple)\b/.test(normalizedQuestion) && say) {
    return say;
  }
  if (/\b(question|ask)\b/.test(normalizedQuestion) && ask) {
    return ask;
  }
  if (/\b(goal|main point|focus)\b/.test(normalizedQuestion) && goal) {
    return goal;
  }
  if (teach) {
    return `Teach: ${teach}`;
  }
  return `Use the active lesson cue for ${title} and give the next step in one short sentence.`;
};

export const looksLikeActiveLessonPrompt = (text) => {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized || normalized.length > 180) {
    return false;
  }

  return [
    /\bnext\b/,
    /\bwhat do i say\b/,
    /\bhow do i explain\b/,
    /\bsimpler\b/,
    /\bcomplex sentence\b/,
    /\bcompound sentence\b/,
    /\bmentor sentence\b/,
    /\bwhat question\b/,
    /\bquestion to ask\b/,
    /\bmain point\b/,
    /\bwhat do i do\b/,
    /\bwhat comes next\b/,
    /\bclause\b/,
    /\bsentence\b/,
  ].some((pattern) => pattern.test(normalized));
};

export const answerFromActiveLesson = async (question) => {
  const note = getActiveLessonNote();
  if (!note) {
    return null;
  }

  const noteText = toPlainText(note).slice(0, 4000);
  const safeQuestion = normalizeText(question);
  if (!safeQuestion) {
    return null;
  }

  try {
    const reply = await requestAssistantChat({
      messages: [
        {
          role: 'system',
          content: [
            'You are Memory Cue helping a teacher during class.',
            'Answer using only the active lesson context.',
            'Be brief, calm, and easy to say out loud.',
            'Prefer 1 to 3 short lines.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Active lesson: ${normalizeText(note.title) || 'Lesson cue'}`,
            '',
            'Lesson context:',
            noteText,
            '',
            `Question: ${safeQuestion}`,
          ].join('\n'),
        },
      ],
      message: safeQuestion,
    }, {
      fallbackReply: '',
    });

    const normalizedReply = normalizeText(reply);
    if (normalizedReply) {
      return normalizedReply;
    }
  } catch {
    /* fall back to local cue extraction */
  }

  return buildLessonFallbackAnswer(safeQuestion, note);
};
