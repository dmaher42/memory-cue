/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMemorySearch(notes = []) {
  const filePath = path.resolve(__dirname, '../modules/memory-search.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+function\s+/g, 'function ');
  source += '\nmodule.exports = { simpleSimilarity, findRelatedMemories };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    Set,
    String,
    loadAllNotes: () => notes,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('hides routine one-word overlaps and retains a scored strong match', () => {
  const { findRelatedMemories, simpleSimilarity } = loadMemorySearch([
    {
      id: 'shopping-note',
      title: 'Shopping',
      bodyText: 'Buy milk before the weekend shop.',
    },
  ]);

  expect(simpleSimilarity('remind me about milk tomorrow', 'milk shopping list')).toBe(1);
  expect(findRelatedMemories('remind me about milk tomorrow')).toEqual([]);
  expect(findRelatedMemories('buy milk tomorrow')).toEqual([
    expect.objectContaining({
      noteId: 'shopping-note',
      noteTitle: 'Shopping',
      score: 2,
    }),
  ]);
});
