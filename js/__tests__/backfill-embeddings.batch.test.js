/**
 * @jest-environment node
 */

const { expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBackfillModule({ memoryService, generateEmbedding }) {
  const filePath = path.resolve(__dirname, '../../src/brain/backfillEmbeddings.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace("import * as memoryService from '../services/memoryService.js';", 'const memoryService = globalThis.__memoryService;')
    .replace("import { generateEmbedding } from './embeddingService.js';", 'const generateEmbedding = globalThis.__generateEmbedding;')
    .replace(/export\s+async\s+function\s+/g, 'async function ');
  source += '\nmodule.exports = { backfillEmbeddings, syncMemoriesFromFirestore };\n';

  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    console,
    Promise,
    Array,
    __memoryService: memoryService,
    __generateEmbedding: generateEmbedding,
  }, { filename: filePath });
  return module.exports;
}

test('Firestore notes are mirrored in one cache batch and reuse semantic embeddings', async () => {
  const updateMemories = jest.fn(async (memories) => memories);
  const updateMemory = jest.fn(() => {
    throw new Error('single-item memory writes should not run');
  });
  const generateEmbedding = jest.fn().mockResolvedValue([9, 9, 9]);
  const { syncMemoriesFromFirestore } = loadBackfillModule({
    memoryService: { updateMemories, updateMemory },
    generateEmbedding,
  });
  const notes = Array.from({ length: 50 }, (_, index) => ({
    id: `note-${index}`,
    title: `Note ${index}`,
    bodyText: `Body ${index}`,
    semanticEmbedding: [0.1, 0.2, 0.3],
    pendingSync: false,
  }));

  const synced = await syncMemoriesFromFirestore(notes);

  expect(synced).toHaveLength(50);
  expect(updateMemories).toHaveBeenCalledTimes(1);
  expect(updateMemories.mock.calls[0][0]).toHaveLength(50);
  expect(updateMemory).not.toHaveBeenCalled();
  expect(generateEmbedding).not.toHaveBeenCalled();
  expect(updateMemories.mock.calls[0][0][0].embedding).toEqual([0.1, 0.2, 0.3]);
});
