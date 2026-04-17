import { loadAllNotes } from './notes-storage.js';

/**
 * Counts overlapping words between two strings.
 * @param {string} a 
 * @param {string} b 
 * @returns {number} overlap score
 */
export function simpleSimilarity(a, b) {
  if (!a || !b) return 0;
  
  const wordsA = a.toLowerCase().split(/\W+/).filter(Boolean);
  const wordsB = b.toLowerCase().split(/\W+/).filter(Boolean);
  
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
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => ({
      title: item.section.title,
      preview: item.section.content.slice(0, 100),
      noteId: item.section.noteId,
      noteTitle: item.section.noteTitle
    }));
}
