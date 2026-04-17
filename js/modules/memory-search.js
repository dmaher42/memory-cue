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
  
  // Count unique word overlaps to keep it simple but effective
  const uniqueWordsA = new Set(wordsA);
  for (const word of uniqueWordsA) {
    if (setB.has(word)) {
      score++;
    }
  }
  
  return score;
}

/**
 * Finds top 3 related notes from memory.
 * @param {string} inputText 
 * @returns {Array} Top 3 related notes
 */
export function findRelatedMemories(inputText) {
  if (!inputText || typeof inputText !== 'string') return [];

  const notes = loadAllNotes();
  const scored = notes.map(note => {
    // Combine title and body for search surface
    const content = `${note.title || ''} ${note.bodyText || ''} ${note.body || ''}`;
    return {
      note,
      score: simpleSimilarity(inputText, content)
    };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.note);
}
