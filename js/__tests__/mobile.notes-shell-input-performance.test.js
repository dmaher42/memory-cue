/**
 * @jest-environment jsdom
 */

const { afterEach, beforeEach, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMobileNotesShellUi() {
  const filePath = path.resolve(__dirname, '../../src/ui/mobileNotesShellUi.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\.\/services\/teacherModeService\.js['"];\s*/,
    `
      const createLessonCueFromNote = () => null;
      const getActiveLessonNote = () => null;
      const getLessonCueFields = () => ({});
      const getTeacherLessonContext = () => ({});
      const getTeacherLessonStep = () => null;
      const getTeacherLessonSteps = () => [];
      const isActiveLessonNoteId = () => false;
      const setTeacherLessonStep = () => {};
      const setActiveLessonNoteId = () => {};
    `,
  );
  source = source.replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { initMobileNotesShellUi };\n';

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    document,
    window,
    console,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLStyleElement: window.HTMLStyleElement,
    Event: window.Event,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = `
    <section id="view-notebook">
      <div id="noteEditorSheet">
        <div class="note-editor-card">
          <div class="scratch-notes-header-block">
            <div class="note-editor-actions-row"></div>
          </div>
          <div id="notebook-editor-body" contenteditable="true"></div>
          <div class="note-editor-toolbar"></div>
        </div>
      </div>
      <section id="notesOverviewPanel"></section>
      <section id="savedNotesSheet" class="hidden"></section>
    </section>
  `;
});

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

test('defers note sections bar rendering while typing in the editor', () => {
  const { initMobileNotesShellUi } = loadMobileNotesShellUi();
  const noteEditorSheet = document.getElementById('noteEditorSheet');
  const editor = document.getElementById('notebook-editor-body');

  initMobileNotesShellUi({
    noteEditorSheet,
    notesOverviewPanel: document.getElementById('notesOverviewPanel'),
    savedNotesSheet: document.getElementById('savedNotesSheet'),
    getCurrentNoteId: () => 'note-1',
  });

  const sectionsBar = noteEditorSheet.querySelector('[data-note-sections-bar]');
  expect(sectionsBar).toBeInstanceOf(HTMLElement);
  expect(sectionsBar.hidden).toBe(true);

  editor.textContent = '# Lesson Plan';
  editor.dispatchEvent(new Event('input', { bubbles: true }));

  jest.advanceTimersByTime(200);

  expect(sectionsBar.hidden).toBe(true);
  expect(sectionsBar.textContent).not.toContain('Sections');

  jest.advanceTimersByTime(100);

  expect(sectionsBar.hidden).toBe(false);
  expect(sectionsBar.textContent).toContain('Sections');
  expect(sectionsBar.textContent).toContain('Lesson Plan');
});
