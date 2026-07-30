import { loadAllNotes } from './notes-storage.js';

const RELATED_MEMORY_STOP_WORDS = new Set([
  'about',
  'add',
  'and',
  'are',
  'at',
  'for',
  'from',
  'have',
  'into',
  'later',
  'make',
  'me',
  'my',
  'remind',
  'reminder',
  'save',
  'that',
  'the',
  'this',
  'to',
  'tomorrow',
  'today',
  'with',
]);

const getMeaningfulWords = (value) => String(value || '')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((word) => word.length >= 3 && !RELATED_MEMORY_STOP_WORDS.has(word));

/**
 * Counts overlapping words between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number} overlap score
 */
export function simpleSimilarity(a, b) {
  if (!a || !b) return 0;

  const wordsA = getMeaningfulWords(a);
  const wordsB = getMeaningfulWords(b);

  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setB = new Set(wordsB);
  let score = 0;

  const uniqueWordsA = new Set(wordsA);
  for (const word of uniqueWordsA) {
    if (setB.has(word)) {
      score++;
    }
  }

  return score;
}

/**
 * Parses markdown-style sections (lines starting with #) from note text.
 * @param {string} noteText
 * @param {string} noteId
 * @param {string} noteTitle
 * @returns {Array} List of section objects
 */
export function extractSections(noteText, noteId, noteTitle) {
  if (!noteText || typeof noteText !== 'string') {
    return [];
  }

  const lines = noteText.split('\n');
  const sections = [];
  let currentTitle = noteTitle || 'Untitled';
  let currentContent = [];

  for (const line of lines) {
    if (line.trim().startsWith('#')) {
      // If we had content accumulating for a previous heading (or implicit header), save it
      if (currentContent.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n').trim(),
          noteId,
          noteTitle
        });
      }

      // Start a new section
      currentTitle = line.replace(/^#+\s*/, '').trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Push the final section
  if (currentContent.length > 0 || sections.length === 0) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n').trim(),
      noteId,
      noteTitle
    });
  }

  return sections;
}

/**
 * Finds top 3 related sections from memory.
 * @param {string} inputText
 * @returns {Array} Top 3 related sections (enriched)
 */
export function findRelatedMemories(inputText) {
  if (!inputText || typeof inputText !== 'string') return [];

  const notes = loadAllNotes();
  const allSections = [];

  for (const note of notes) {
    const textSurface = note.bodyText || note.body || '';
    allSections.push(...extractSections(textSurface, note.id, note.title));
  }

  const scored = allSections.map(section => {
    return {
      section,
      score: simpleSimilarity(inputText, section.content)
    };
  });

  return scored
    // One shared word is too easy to trigger on routine captures such as "milk".
    // Keep only stronger matches and retain the score so the UI can enforce the
    // same confidence rule when rendering saved history.
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => ({
      title: item.section.title,
      preview: item.section.content.slice(0, 100),
      noteId: item.section.noteId,
      noteTitle: item.section.noteTitle,
      score: item.score
    }));
}
