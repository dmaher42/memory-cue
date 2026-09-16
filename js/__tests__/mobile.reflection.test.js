const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup(requestReflection) {
  document.body.innerHTML = `<input id="title"><div id="editor" contenteditable="true">rough words</div>
    <details id="noteReflection"><button id="reflectionAll"></button><button id="reflectionSelection"></button>
    <button id="reflectionKeep"></button><button id="reflectionUndo"></button><div id="reflectionPolished"></div>
    <p id="reflectionScope"></p><p id="reflectionStatus"></p></details>`;
  const editor = document.getElementById('editor');
  let notes = [{ id: 'one', bodyHtml: 'rough words', metadata: {} }, { id: 'two', bodyHtml: 'second note' }];
  let id = 'one';
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/ui/mobileNotesEditorUi.js'), 'utf8')
    .replace('export const initMobileNotesEditorUi', 'const initMobileNotesEditorUi');
  vm.runInNewContext(source + '\nmodule.exports = { initMobileNotesEditorUi };', {
    module, document, window, HTMLElement, setTimeout, clearTimeout,
  });
  module.exports.initMobileNotesEditorUi({
    scratchNotesEditorElement: editor, titleInput: document.getElementById('title'),
    getCurrentNoteId: () => id, loadAllNotes: () => notes,
    saveAllNotes: (value) => { notes = JSON.parse(JSON.stringify(value)); return true; },
    getEditorBodyHtml: () => editor.innerHTML, getEditorBodyText: () => editor.textContent,
    requestReflection,
  });
  return { editor, notes: () => notes, switchNote: () => {
    id = 'two'; editor.textContent = 'second note'; editor.dispatchEvent(new Event('reflection:noteChanged'));
  } };
}
const click = (id) => document.getElementById(id).click();
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('preview leaves original unchanged; keep and undo persist separate versions', async () => {
  const state = setup(async () => ({ reflectionDraft: 'Organised words' }));
  click('reflectionAll'); await settle();
  expect(state.notes()[0].metadata.reflection).toBeUndefined();
  expect(state.editor.textContent).toBe('rough words');
  click('reflectionKeep');
  expect(state.notes()[0].metadata.reflection.text).toBe('Organised words');
  expect(state.notes()[0].metadata.reflection.sourceText).toBe('rough words');
  click('reflectionUndo');
  expect(state.notes()[0].metadata.reflection.text).toBe('');
  expect(state.notes()[0].bodyHtml).toBe('rough words');
});

test('result from a different note is discarded', async () => {
  let finish;
  const state = setup(() => new Promise((resolve) => { finish = resolve; }));
  click('reflectionAll'); state.switchNote();
  finish({ reflectionDraft: 'Old note result' }); await settle();
  expect(document.getElementById('reflectionPolished').textContent).not.toContain('Old note result');
  expect(state.notes()[1].metadata).toBeUndefined();
});

test('editing during a request discards stale output', async () => {
  let finish;
  const state = setup(() => new Promise((resolve) => { finish = resolve; }));
  click('reflectionAll'); state.editor.textContent = 'new words';
  finish({ reflectionDraft: 'Old words' }); await settle();
  expect(document.getElementById('reflectionKeep').disabled).toBe(true);
  expect(state.editor.textContent).toBe('new words');
});

test('provider failure preserves saved content', async () => {
  const state = setup(async () => { throw new Error('offline'); });
  click('reflectionAll'); await settle();
  expect(document.getElementById('reflectionStatus').textContent).toContain('unavailable');
  expect(state.notes()[0].bodyHtml).toBe('rough words');
});
