/**
 * @jest-environment node
 */

const { expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMemoryService() {
  const filePath = path.resolve(__dirname, '../../src/services/memoryService.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace("import { learnPattern } from './patternLearningService.js';", 'const learnPattern = globalThis.__learnPattern;')
    .replace("import { generateEmbedding } from '../brain/embeddingService.js';", 'const generateEmbedding = globalThis.__generateEmbedding;')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { getMemories, updateMemory, updateMemories };\n';

  const values = new Map();
  const storage = {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => { values.set(key, String(value)); }),
    removeItem: jest.fn((key) => { values.delete(key); }),
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    console,
    localStorage: storage,
    crypto: { randomUUID: () => 'generated-id' },
    Date,
    Map,
    Set,
    Math,
    Number,
    String,
    Array,
    Object,
    Promise,
    __learnPattern: jest.fn(),
    __generateEmbedding: jest.fn().mockResolvedValue([]),
  }, { filename: filePath });

  return { memoryService: module.exports, storage, values };
}

test('batch memory updates persist the cache once and reads do not rewrite it', async () => {
  const { memoryService, storage, values } = loadMemoryService();
  const memories = Array.from({ length: 75 }, (_, index) => ({
    id: `note-${index}`,
    text: `Note ${index}`,
    type: 'note',
    pendingSync: false,
    embedding: [0.1, 0.2, 0.3],
  }));

  const updated = await memoryService.updateMemories(memories);

  expect(updated).toHaveLength(75);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(JSON.parse(values.get('memoryCueCache'))).toHaveLength(75);

  expect(memoryService.getMemories()).toHaveLength(75);
  expect(storage.setItem).toHaveBeenCalledTimes(1);

  await memoryService.updateMemory('note-0', { text: 'Updated note' });
  expect(storage.setItem).toHaveBeenCalledTimes(2);
});
