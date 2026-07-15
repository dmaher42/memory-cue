/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCommandEngine(overrides = {}) {
  const filePath = path.resolve(__dirname, '../../src/core/commandEngine.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { executeCommand };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Date,
    Object,
    ...overrides,
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

test('generic note updates keep body, bodyHtml and bodyText consistent when clearing', async () => {
  let notes = [{
    id: 'note-1',
    title: 'Planning',
    body: '<p>Old private planning details</p>',
    bodyHtml: '<p>Old private planning details</p>',
    bodyText: 'Old private planning details',
  }];
  const saveAllNotes = jest.fn((nextNotes) => {
    notes = nextNotes;
    return true;
  });
  const { executeCommand } = loadCommandEngine({
    loadAllNotes: () => notes,
    saveAllNotes,
    createNote: (title, bodyHtml) => ({
      title,
      body: bodyHtml,
      bodyHtml,
      bodyText: typeof bodyHtml === 'string'
        ? bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : '',
    }),
  });

  const result = await executeCommand('updateNote', {
    id: 'note-1',
    updates: { bodyHtml: '' },
  });

  expect(result.status).toBe('success');
  expect(saveAllNotes).toHaveBeenCalledTimes(1);
  expect(notes[0].body).toBe('');
  expect(notes[0].bodyHtml).toBe('');
  expect(notes[0].bodyText).toBe('');
});
