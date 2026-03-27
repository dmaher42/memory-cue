import { createNote, loadAllNotes, saveAllNotes } from '../../js/modules/notes-storage.js';
import { requestAssistantChat } from './assistantOrchestrator.js';

const ACTIVE_LESSON_NOTE_ID_KEY = 'memoryCue:activeLessonNoteId';
const LESSON_STEP_MAP_KEY = 'memoryCue:teacherLessonSteps';
const CUE_LABELS = ['Goal', 'Say', 'Teach', 'Ask', 'Next', 'Materials', 'Reminder'];
const TEACHER_LESSON_STEPS = [
  { id: 'opener', label: 'Opener' },
  { id: 'teach', label: 'Teach' },
  { id: 'model', label: 'Model' },
  { id: 'guided', label: 'Guided' },
  { id: 'independent', label: 'Independent' },
  { id: 'close', label: 'Close' },
];
const MAX_CUE_VALUE_LENGTH = 140;
const LESSON_SECTION_ALIASES = [
  'Learning intention',
  'Success criteria',
  'Objective',
  'Goal',
  'Say',
  'Teacher says',
  'Teach',
  'Model',
  'Question to ask',
  'Hinge question',
  'Guided practice',
  'Independent practice',
  'Next',
  'Then',
  'Plenary',
  'Closing',
  'Materials',
  'Resources',
  'Reminder',
  'Before class',
  'After class',
];

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

const dispatchActiveLessonStepUpdated = (lessonId = null, stepId = null) => {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }

  document.dispatchEvent(new CustomEvent('memoryCue:activeLessonStepUpdated', {
    detail: {
      lessonId: typeof lessonId === 'string' && lessonId.trim() ? lessonId.trim() : null,
      stepId: typeof stepId === 'string' && stepId.trim() ? stepId.trim() : null,
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

const toFlatText = (note = {}) => normalizeText(toPlainText(note)).replace(/\s+/g, ' ');

const extractLines = (text = '') => normalizeText(text)
  .split('\n')
  .map((line) => line.replace(/^[\s\-*•\d.)]+/, '').trim())
  .filter(Boolean);

const stripCueLabelPrefix = (value = '') => normalizeText(value)
  .replace(/^(Goal|Say|Teach|Ask|Next|Materials|Reminder)\s*:\s*/i, '')
  .trim();

const clampCueValue = (value = '') => {
  const normalized = normalizeText(value).replace(/\s+/g, ' ');
  if (normalized.length <= MAX_CUE_VALUE_LENGTH) {
    return normalized;
  }
  const sliced = normalized.slice(0, MAX_CUE_VALUE_LENGTH + 1);
  const trimmed = sliced.replace(/\s+\S*$/, '').trim() || normalized.slice(0, MAX_CUE_VALUE_LENGTH).trim();
  return `${trimmed}...`;
};

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const cleanCueValue = (value = '', fallback = '') => {
  const candidate = stripCueLabelPrefix(value) || stripCueLabelPrefix(fallback);
  if (!candidate) {
    return '';
  }
  return clampCueValue(candidate.replace(/\s+/g, ' ').trim());
};

const parseCueFields = (text = '') => {
  const fields = {};
  extractLines(text).forEach((line) => {
    const match = line.match(/^(Goal|Say|Teach|Ask|Next|Materials|Reminder)\s*:\s*(.+)$/i);
    if (!match) {
      return;
    }
    const label = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    if (!fields[label]) {
      fields[label] = match[2].trim();
    }
  });
  return fields;
};

const formatCueFields = (fields = {}) => CUE_LABELS
  .map((label) => `${label}: ${cleanCueValue(fields[label])}`)
  .join('\n');

const formatCueHtml = (fields = {}) => {
  const blocks = CUE_LABELS
    .map((label) => {
      const value = cleanCueValue(fields[label]);
      if (!value) {
        return '';
      }
      return `
        <section class="lesson-cue-block" data-cue-label="${label.toLowerCase()}">
          <p class="lesson-cue-label">${escapeHtml(label)}</p>
          <p class="lesson-cue-value">${escapeHtml(value)}</p>
        </section>
      `.trim();
    })
    .filter(Boolean)
    .join('');

  if (!blocks) {
    return '';
  }

  return `<div class="lesson-cue-note">${blocks}</div>`;
};

const normalizeCueFields = (fields = {}, fallbackFields = {}) => {
  const normalizedFields = {};
  CUE_LABELS.forEach((label) => {
    normalizedFields[label] = cleanCueValue(fields[label], fallbackFields[label]);
  });
  return normalizedFields;
};

const evaluateCueBody = (text = '', note = {}) => {
  const fallbackFields = parseCueFields(buildFallbackCueBody(note));
  const normalized = normalizeText(text);
  if (!normalized) {
    return {
      ok: false,
      fields: fallbackFields,
      body: formatCueFields(fallbackFields),
    };
  }

  const parsedFields = parseCueFields(normalized);
  if (hasLowQualityCueFields(parsedFields, fallbackFields)) {
    return {
      ok: false,
      fields: fallbackFields,
      body: formatCueFields(fallbackFields),
    };
  }

  const normalizedFields = normalizeCueFields(parsedFields, fallbackFields);
  const hasAnyFields = CUE_LABELS.some((label) => normalizedFields[label]);
  if (!hasAnyFields) {
    return {
      ok: false,
      fields: fallbackFields,
      body: formatCueFields(fallbackFields),
    };
  }

  return {
    ok: true,
    fields: normalizedFields,
    body: formatCueFields(normalizedFields),
  };
};

const hasLowQualityCueFields = (fields = {}, fallbackFields = {}) => {
  const values = CUE_LABELS
    .map((label) => cleanCueValue(fields[label], fallbackFields[label]))
    .filter(Boolean);

  if (values.length < 3) {
    return true;
  }

  const normalizedValues = values.map((value) => value.toLowerCase());
  const uniqueValues = new Set(normalizedValues);
  if (uniqueValues.size <= 2) {
    return true;
  }

  const repeatedPrefixes = normalizedValues.filter((value) => (
    /\blearning intention\b/.test(value)
    || /\bsuccess criteria\b/.test(value)
  ));
  if (repeatedPrefixes.length >= 3) {
    return true;
  }

  const longestValue = normalizedValues.reduce((longest, value) => (
    value.length > longest.length ? value : longest
  ), '');
  const dominantCount = normalizedValues.filter((value) => value === longestValue).length;
  if (dominantCount >= 3) {
    return true;
  }

  return false;
};

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

const findLines = (lines = [], patterns = []) => {
  if (!Array.isArray(lines) || !lines.length) {
    return [];
  }
  const matcher = Array.isArray(patterns) ? patterns : [];
  return lines.filter((line) => matcher.some((pattern) => pattern.test(line)));
};

const uniqueLines = (lines = []) => {
  const seen = new Set();
  return (Array.isArray(lines) ? lines : []).filter((line) => {
    const normalized = normalizeText(line).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const toSentenceCase = (value = '') => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const stripLeadIn = (value = '', patterns = []) => {
  let result = normalizeText(value);
  patterns.forEach((pattern) => {
    result = result.replace(pattern, '').trim();
  });
  return result;
};

const buildSayLine = (title = '', goal = '', source = '') => {
  const cleanedSource = stripLeadIn(source, [
    /^say[:\s-]*/i,
    /^(teacher says?|explain|introduce|share)[:\s-]*/i,
  ]);
  if (cleanedSource) {
    return toSentenceCase(cleanedSource);
  }

  const cleanedGoal = stripLeadIn(goal, [
    /^(goal|objective|learning intention|success criteria)[:\s-]*/i,
    /^students will\b[:\s-]*/i,
    /^we are learning to\b[:\s-]*/i,
  ]);
  if (cleanedGoal) {
    return `Today we are learning to ${cleanedGoal.replace(/\.$/, '')}.`;
  }

  return `Today we will focus on ${title}.`;
};

const extractLessonSections = (text = '') => {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  if (!normalized) {
    return {};
  }

  const escapedAliases = LESSON_SECTION_ALIASES
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const sectionPattern = new RegExp(`(?:^|\\s)(${escapedAliases}):\\s*`, 'ig');
  const matches = Array.from(normalized.matchAll(sectionPattern));
  if (!matches.length) {
    return {};
  }

  const sections = {};
  matches.forEach((match, index) => {
    const rawLabel = match[1];
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index || normalized.length) : normalized.length;
    const value = normalized.slice(start, end).trim().replace(/\s+$/, '');
    if (!value) {
      return;
    }
    const key = rawLabel.toLowerCase();
    if (!sections[key]) {
      sections[key] = value.replace(/\s+/g, ' ').trim();
    }
  });

  return sections;
};

const buildLessonSourceBrief = (note = {}) => {
  const title = normalizeText(note?.title) || 'Lesson';
  const text = toPlainText(note);
  const flatText = toFlatText(note);
  const lines = extractLines(text);
  const sections = extractLessonSections(flatText);

  const detailLines = uniqueLines([
    sections['learning intention'] ? `Learning intention: ${sections['learning intention']}` : '',
    sections['success criteria'] ? `Success criteria: ${sections['success criteria']}` : '',
    sections.say ? `Teacher wording: ${sections.say}` : '',
    sections.teach ? `Teach: ${sections.teach}` : '',
    sections.model ? `Model: ${sections.model}` : '',
    sections['question to ask'] ? `Question to ask: ${sections['question to ask']}` : '',
    sections['hinge question'] ? `Hinge question: ${sections['hinge question']}` : '',
    sections['guided practice'] ? `Guided practice: ${sections['guided practice']}` : '',
    sections['independent practice'] ? `Independent practice: ${sections['independent practice']}` : '',
    sections.materials ? `Materials: ${sections.materials}` : '',
    sections.resources ? `Resources: ${sections.resources}` : '',
    sections.reminder ? `Reminder: ${sections.reminder}` : '',
    sections['before class'] ? `Before class: ${sections['before class']}` : '',
    sections['after class'] ? `After class: ${sections['after class']}` : '',
  ]);

  const fallbackLines = uniqueLines(lines).slice(0, 8);
  const sourceLines = detailLines.length ? detailLines.slice(0, 10) : fallbackLines;

  return [
    `Title: ${title}`,
    '',
    'Lesson outline:',
    ...(sourceLines.length ? sourceLines.map((line) => `- ${line}`) : [`- ${title}`]),
  ].join('\n');
};

const buildFallbackCueBody = (note = {}) => {
  const title = normalizeText(note?.title) || 'Lesson';
  const text = toPlainText(note);
  const flatText = toFlatText(note);
  const lines = extractLines(text);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sections = extractLessonSections(flatText);

  const goalCandidates = uniqueLines([
    sections['learning intention'],
    sections['objective'],
    sections['goal'],
    sections['success criteria'],
    ...findLines(lines, [/\b(learning intention|objective|goal|success criteria|walt|students will)\b/i]),
    ...findLines(sentences, [/\b(learning intention|objective|goal|success criteria|walt|students will)\b/i]),
    lines[0],
  ]);
  const goal = goalCandidates[0] || `Teach the main idea from ${title}.`;

  const saySource = sections.say
    || sections['teacher says']
    || findLine(lines, [
    /^say[:\s-]/i,
    /\b(explain|introduce|share|teacher says?)\b/i,
    /\bwe are learning to\b/i,
    ]) || sentences[0];
  const say = buildSayLine(title, goal, saySource);

  const teachCandidates = uniqueLines([
    sections.teach,
    sections.model,
    ...lines.filter((line) => (
      line
      && line !== goal
      && line !== saySource
      && !line.includes('?')
    )),
  ]);
  const focusedTeachCandidates = uniqueLines([
    ...findLines(teachCandidates, [/\b(model|teach|explain|demonstrate|show|review|mentor sentence|example)\b/i]),
    ...teachCandidates,
  ]);
  const teach = focusedTeachCandidates.slice(0, 2).join('; ') || `Model one clear example from ${title}.`;

  const ask = firstQuestionLine(uniqueLines([
    sections['question to ask'],
    sections['hinge question'],
    ...findLines(lines, [/\b(hinge question|question to ask|ask students|check understanding|discuss)\b/i]),
    ...lines,
  ])) || 'What do you notice first?';

  const nextCandidates = uniqueLines([
    sections.next,
    sections.then,
    sections['guided practice'],
    sections['independent practice'],
    sections.plenary,
    sections.closing,
    ...findLines(lines, [/\b(next|then|after that|guided practice|independent practice|plenary|closing|turn and talk|paired practice)\b/i]),
    ...findLines(sentences, [/\b(next|then|after that|guided practice|independent practice|plenary|closing|turn and talk|paired practice)\b/i]),
  ]);
  const next = nextCandidates[0]
    || focusedTeachCandidates[2]
    || 'Model one example, then guide practice.';

  const materialCandidates = uniqueLines([
    sections.materials,
    sections.resources,
    ...findLines(lines, [/\b(materials|resources|bring|worksheet|slides|whiteboard|mentor sentence|text)\b/i]),
    ...findLines(sentences, [/\b(materials|resources|bring|worksheet|slides|whiteboard|mentor sentence|text)\b/i]),
  ]);
  const materials = materialCandidates[0] || 'Slides, example text, and workbook.';

  const reminderCandidates = uniqueLines([
    sections.reminder,
    sections['before class'],
    sections['after class'],
    ...findLines(lines, [/\b(remind|check|collect|follow up|before class|after class|watch for|listen for)\b/i]),
    ...findLines(sentences, [/\b(remind|check|collect|follow up|before class|after class|watch for|listen for)\b/i]),
  ]);
  const reminder = reminderCandidates[0] || 'Check understanding before independent work.';

  return formatCueFields({
    Goal: goal,
    Say: say,
    Teach: teach,
    Ask: ask,
    Next: next,
    Materials: materials,
    Reminder: reminder,
  });
};

const buildCueRequest = (note = {}, options = {}) => {
  const title = normalizeText(note?.title) || 'Lesson';
  const sourceText = buildLessonSourceBrief(note);
  const retry = options?.retry === true;
  const previousAttempt = normalizeText(options?.previousAttempt);

  return {
    messages: [
      {
        role: 'system',
        content: [
          'You are Memory Cue in Teacher Mode.',
          'Turn lesson material into a short cue card for a teacher under pressure.',
          'Be concise, spoken-language friendly, and practical.',
          'Write a real cue card, not a summary.',
          'Each line must be short enough to scan quickly during class.',
          'Do not add headings, bullets, numbering, quotation marks, or extra explanation.',
          'Do not repeat the lesson title across multiple fields.',
          'Do not copy the learning intention or success criteria into every field.',
          'Prefer exact teacher wording over broad summaries.',
          'Use the lesson outline to infer the best teacher cue for each field.',
          'Keep "Goal" to one short outcome.',
          'Keep "Say" to one sentence the teacher could say aloud.',
          'Keep "Teach" to one practical teaching move.',
          'Keep "Ask" to one usable student question.',
          'Keep "Next" to the immediate next teaching step only.',
          'Keep "Materials" to a short comma-separated list.',
          'Keep "Reminder" to one short actionable prompt.',
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
          retry
            ? 'The previous cue copied too much source text and was not usable. Rewrite it as a true teacher cue.'
            : 'Write a short teacher cue from this lesson.',
          '',
          sourceText || title,
          ...(previousAttempt
            ? [
              '',
              'Bad previous draft to improve:',
              previousAttempt,
            ]
            : []),
        ].join('\n'),
      },
    ],
    message: `Create lesson cue for ${title}`,
  };
};

const normalizeCueBody = (text = '', note = {}) => evaluateCueBody(text, note).body;

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

const getNoteType = (note = {}) => (
  typeof note?.metadata?.noteType === 'string' ? note.metadata.noteType.trim() : ''
);

export const findLessonCueNote = (sourceNoteId, notes = null) => {
  const normalizedSourceNoteId = typeof sourceNoteId === 'string' ? sourceNoteId.trim() : '';
  if (!normalizedSourceNoteId) {
    return null;
  }
  const sourceNotes = Array.isArray(notes) ? notes : loadAllNotes();
  return sourceNotes.find((note) => (
    getNoteType(note) === 'lesson-cue'
    && typeof note?.metadata?.sourceNoteId === 'string'
    && note.metadata.sourceNoteId.trim() === normalizedSourceNoteId
  )) || null;
};

export const getTeacherLessonContext = (noteOrNoteId, notes = null) => {
  const sourceNotes = Array.isArray(notes) ? notes : loadAllNotes();
  const currentNote = typeof noteOrNoteId === 'string'
    ? sourceNotes.find((entry) => entry?.id === noteOrNoteId) || null
    : noteOrNoteId && typeof noteOrNoteId === 'object'
      ? noteOrNoteId
      : null;

  if (!currentNote) {
    return {
      currentNote: null,
      sourceNote: null,
      cueNote: null,
      sourceNoteId: null,
      cueNoteId: null,
      isCueNote: false,
      isLessonSource: false,
      hasLessonPair: false,
    };
  }

  const currentType = getNoteType(currentNote);
  const isCueNote = currentType === 'lesson-cue';
  const sourceNote = isCueNote
    ? sourceNotes.find((entry) => entry?.id === currentNote?.metadata?.sourceNoteId) || null
    : currentNote;
  const cueNote = isCueNote
    ? currentNote
    : findLessonCueNote(currentNote?.id, sourceNotes);

  return {
    currentNote,
    sourceNote,
    cueNote,
    sourceNoteId: sourceNote?.id || null,
    cueNoteId: cueNote?.id || null,
    isCueNote,
    isLessonSource: getNoteType(sourceNote) === 'lesson-source' || Boolean(sourceNote?.metadata?.teaching),
    hasLessonPair: Boolean(sourceNote && cueNote),
  };
};

const normalizeLessonStepId = (stepId) => {
  const normalizedStepId = typeof stepId === 'string' ? stepId.trim().toLowerCase() : '';
  return TEACHER_LESSON_STEPS.some((step) => step.id === normalizedStepId) ? normalizedStepId : null;
};

const getTeacherLessonStorageId = (noteOrNoteId, notes = null) => {
  const lessonContext = getTeacherLessonContext(noteOrNoteId, notes);
  return lessonContext.sourceNoteId || lessonContext.cueNoteId || lessonContext.currentNote?.id || null;
};

const readTeacherLessonStepMap = () => {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(LESSON_STEP_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeTeacherLessonStepMap = (value = {}) => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(LESSON_STEP_MAP_KEY, JSON.stringify(value && typeof value === 'object' ? value : {}));
  } catch {
    /* ignore storage errors */
  }
};

export const getTeacherLessonSteps = () => TEACHER_LESSON_STEPS.map((step) => ({ ...step }));

export const getTeacherLessonStep = (noteOrNoteId, notes = null) => {
  const lessonId = getTeacherLessonStorageId(noteOrNoteId, notes);
  if (!lessonId) {
    return null;
  }
  const stepMap = readTeacherLessonStepMap();
  return normalizeLessonStepId(stepMap[lessonId]);
};

export const getTeacherLessonStepLabel = (stepId) => (
  TEACHER_LESSON_STEPS.find((step) => step.id === normalizeLessonStepId(stepId))?.label || ''
);

export const setTeacherLessonStep = (noteOrNoteId, stepId, notes = null) => {
  const lessonId = getTeacherLessonStorageId(noteOrNoteId, notes);
  const normalizedStepId = normalizeLessonStepId(stepId);
  if (!lessonId || !normalizedStepId) {
    return null;
  }

  const stepMap = readTeacherLessonStepMap();
  stepMap[lessonId] = normalizedStepId;
  writeTeacherLessonStepMap(stepMap);
  dispatchActiveLessonStepUpdated(lessonId, normalizedStepId);
  return normalizedStepId;
};

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
  const lessonContext = getTeacherLessonContext(normalizedId, notes);
  const sourceNote = lessonContext.sourceNote;
  const existingCueNote = lessonContext.cueNote;
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

  let evaluatedCue = evaluateCueBody(cueBody, sourceNote);
  if (!evaluatedCue.ok) {
    try {
      const retryCueBody = await requestAssistantChat(buildCueRequest(sourceNote, {
        retry: true,
        previousAttempt: cueBody,
      }), {
        fallbackReply: '',
      });
      evaluatedCue = evaluateCueBody(retryCueBody, sourceNote);
    } catch {
      /* ignore retry errors */
    }
  }

  const normalizedCueBody = evaluatedCue.body || normalizeCueBody('', sourceNote);
  const cueFields = evaluatedCue.fields || parseCueFields(normalizedCueBody);
  const cueHtml = formatCueHtml(cueFields);
  const timestamp = new Date().toISOString();
  const cueNote = createNote(buildCueTitle(sourceNote), normalizedCueBody, {
    id: existingCueNote?.id || undefined,
    folderId: sourceNote.folderId,
    bodyHtml: cueHtml || normalizedCueBody,
    bodyText: normalizedCueBody,
    createdAt: existingCueNote?.createdAt || timestamp,
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

  const notesWithoutPreviousCue = updatedNotes.filter((note) => note?.id !== existingCueNote?.id);
  saveAllNotes([cueNote, ...notesWithoutPreviousCue]);
  setActiveLessonNoteId(cueNote.id);
  return cueNote;
};

export const getLessonCueFields = (note = {}) => {
  const cueText = toPlainText(note);
  if (!cueText) {
    return parseCueFields(buildFallbackCueBody(note));
  }

  const fallbackFields = parseCueFields(buildFallbackCueBody(note));
  const parsedFields = parseCueFields(cueText);
  const fields = {};
  CUE_LABELS.forEach((label) => {
    fields[label] = cleanCueValue(parsedFields[label], fallbackFields[label]);
  });
  return fields;
};

const getCueLine = (note, prefix) => getLessonCueFields(note)[prefix] || '';

const buildCueContextBlock = (note = {}) => {
  const fields = getLessonCueFields(note);
  return CUE_LABELS
    .map((label) => {
      const value = cleanCueValue(fields[label]);
      return value ? `${label}: ${value}` : '';
    })
    .filter(Boolean)
    .join('\n');
};

const buildStepContextLine = (stepId = null) => {
  const stepLabel = getTeacherLessonStepLabel(stepId);
  return stepLabel ? `Current step: ${stepLabel}` : '';
};

const isDirectCuePrompt = (question = '') => {
  const normalizedQuestion = normalizeText(question).toLowerCase();
  if (!normalizedQuestion) {
    return false;
  }

  return [
    /\bnext\b/,
    /\bwhat comes next\b/,
    /\bwhat do i do\b/,
    /\bwhat do i say\b/,
    /\bhow do i explain\b/,
    /\bsimpler\b/,
    /\bquestion to ask\b/,
    /\bwhat question\b/,
    /\bmain point\b/,
    /\bgoal\b/,
    /\bfocus\b/,
  ].some((pattern) => pattern.test(normalizedQuestion));
};

const buildLessonFallbackAnswer = (question, note, stepId = null) => {
  const normalizedQuestion = normalizeText(question).toLowerCase();
  const title = normalizeText(note?.title) || 'this lesson';
  const next = getCueLine(note, 'Next');
  const say = getCueLine(note, 'Say');
  const ask = getCueLine(note, 'Ask');
  const teach = getCueLine(note, 'Teach');
  const goal = getCueLine(note, 'Goal');
  const reminder = getCueLine(note, 'Reminder');
  const stepLabel = getTeacherLessonStepLabel(stepId);
  const withStep = (value = '') => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return '';
    }
    return stepLabel ? `${stepLabel}: ${normalizedValue}` : normalizedValue;
  };

  if (/\bnext\b/.test(normalizedQuestion) && next) {
    return withStep(next);
  }
  if (/\b(say|explain|simpler|simple)\b/.test(normalizedQuestion) && say) {
    if (stepId === 'guided' && ask) {
      return withStep(`${ask}\n${teach || say}`);
    }
    if (stepId === 'independent' && reminder) {
      return withStep(reminder);
    }
    return withStep(teach && teach !== say ? `${say}\n${teach}` : say);
  }
  if (/\b(question|ask)\b/.test(normalizedQuestion) && ask) {
    return withStep(ask);
  }
  if (/\b(goal|main point|focus)\b/.test(normalizedQuestion) && goal) {
    return withStep(goal);
  }
  if (/\b(complex|compound|simple|clause|sentence|mentor sentence)\b/.test(normalizedQuestion) && teach) {
    return withStep(say && say !== teach ? `${teach}\n${say}` : teach);
  }
  if (teach) {
    return withStep(`Teach: ${teach}`);
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

  const safeQuestion = normalizeText(question);
  if (!safeQuestion) {
    return null;
  }

  const lessonContext = getTeacherLessonContext(note);
  const cueNote = lessonContext.cueNote || note;
  const sourceNote = lessonContext.sourceNote || note;
  const cueContext = buildCueContextBlock(cueNote);
  const lessonOutline = buildLessonSourceBrief(sourceNote);
  const currentStepId = getTeacherLessonStep(cueNote, [cueNote, sourceNote].filter(Boolean));
  const currentStepLine = buildStepContextLine(currentStepId);

  if (isDirectCuePrompt(safeQuestion)) {
    return buildLessonFallbackAnswer(safeQuestion, cueNote, currentStepId);
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
            'Use the cue card first, then the lesson outline if needed.',
            'Do not restate the whole lesson.',
            'If the teacher asks for wording, give a line they can say aloud.',
            'If the teacher asks what to do next, give one immediate step.',
            'If the teacher asks a grammar or sentence question, answer simply first, then optionally add one short reason.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Active lesson: ${normalizeText(sourceNote.title) || normalizeText(cueNote.title) || 'Lesson cue'}`,
            ...(currentStepLine ? ['', currentStepLine] : []),
            '',
            'Cue card:',
            cueContext || 'No cue card available.',
            '',
            'Lesson outline:',
            lessonOutline,
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

  return buildLessonFallbackAnswer(safeQuestion, cueNote, currentStepId);
};
