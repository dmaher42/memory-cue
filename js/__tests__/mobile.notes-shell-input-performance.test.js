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
  let sharedSections = [];
  const innerTextRead = jest.fn(() => '# Stale Section');
  Object.defineProperty(editor, 'innerText', {
    configurable: true,
    get: innerTextRead,
  });

  initMobileNotesShellUi({
    noteEditorSheet,
    notesOverviewPanel: document.getElementById('notesOverviewPanel'),
    savedNotesSheet: document.getElementById('savedNotesSheet'),
    getCurrentNoteId: () => 'note-1',
    getCurrentNoteSections: () => sharedSections,
  });

  const sectionsBar = noteEditorSheet.querySelector('[data-note-sections-bar]');
  expect(sectionsBar).toBeInstanceOf(HTMLElement);
  expect(sectionsBar.hidden).toBe(true);

  editor.textContent = '# Lesson Plan';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  sharedSections = [{ label: 'Lesson Plan', kind: 'markdown' }];

  jest.advanceTimersByTime(200);

  expect(sectionsBar.hidden).toBe(true);
  expect(sectionsBar.textContent).not.toContain('Sections');

  jest.advanceTimersByTime(100);

  expect(sectionsBar.hidden).toBe(false);
  expect(sectionsBar.textContent).toContain('Sections');
  expect(sectionsBar.textContent).toContain('Lesson Plan');
  expect(innerTextRead).not.toHaveBeenCalled();
});

test('shows a Saved notes heading and refreshes the list before opening it', () => {
  document.body.innerHTML = `
    <section id="view-notebook">
      <section id="notesOverviewPanel">
        <h2>Notes</h2>
        <div id="notesOverviewList"></div>
      </section>
      <div id="noteEditorSheet"></div>
      <section id="savedNotesSheet" class="hidden"></section>
    </section>
  `;
  const { initMobileNotesShellUi } = loadMobileNotesShellUi();
  const notesOverviewPanel = document.getElementById('notesOverviewPanel');
  const noteEditorSheet = document.getElementById('noteEditorSheet');
  const list = document.getElementById('notesOverviewList');
  const flushCurrentNote = jest.fn();
  const refreshFromStorage = jest.fn();

  const { applyNotesMode } = initMobileNotesShellUi({
    noteEditorSheet,
    notesOverviewPanel,
    savedNotesSheet: document.getElementById('savedNotesSheet'),
    flushCurrentNote,
    refreshFromStorage,
  });

  const heading = notesOverviewPanel.querySelector('h2');
  const toggle = notesOverviewPanel.querySelector('[data-notes-overview-toggle]');
  expect(heading.textContent).toBe('Notes');
  expect(heading.classList.contains('sr-only')).toBe(true);
  expect(toggle.textContent).toBe('Saved notes');
  expect(list.hidden).toBe(true);

  applyNotesMode('overview');
  expect(flushCurrentNote).toHaveBeenCalledTimes(1);
  expect(refreshFromStorage).toHaveBeenCalledWith({ preserveDraft: true });
  expect(heading.textContent).toBe('Saved notes');
  expect(heading.classList.contains('sr-only')).toBe(false);
  expect(toggle.textContent).toBe('Back');
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(list.hidden).toBe(false);
  expect(noteEditorSheet.classList.contains('hidden')).toBe(true);

  toggle.click();
  expect(heading.textContent).toBe('Notes');
  expect(toggle.textContent).toBe('Saved notes');
  expect(list.hidden).toBe(true);
  expect(noteEditorSheet.classList.contains('hidden')).toBe(false);
});

test('places Saved notes and New in the Notes app header', () => {
  document.body.innerHTML = `
    <header id="reminders-slim-header">
      <button id="overflowMenuBtn" type="button">Menu</button>
      <h1 class="header-title">Memory Cue</h1>
      <div id="notesHeaderActions" hidden aria-hidden="true">
        <button id="newNoteMobile" type="button">+ New</button>
      </div>
    </header>
    <section id="view-notebook">
      <section id="notesOverviewPanel">
        <h2>Notes</h2>
        <div id="notesOverviewList"></div>
      </section>
      <div id="noteEditorSheet">
        <div class="scratch-notes-header-block">
          <div class="note-editor-actions-row">
            <button id="noteFolderPillMobile" type="button">Everyday</button>
          </div>
        </div>
      </div>
      <section id="savedNotesSheet" class="hidden"></section>
    </section>
  `;
  const { initMobileNotesShellUi } = loadMobileNotesShellUi();
  const noteEditorSheet = document.getElementById('noteEditorSheet');
  const notesOverviewPanel = document.getElementById('notesOverviewPanel');
  const actionsRow = noteEditorSheet.querySelector('.note-editor-actions-row');
  const headerActions = document.getElementById('notesHeaderActions');
  document.body.dataset.activeView = 'notebooks';

  const { applyNotesMode } = initMobileNotesShellUi({
    noteEditorSheet,
    notesOverviewPanel,
    savedNotesSheet: document.getElementById('savedNotesSheet'),
  });

  applyNotesMode('notebooks');
  expect(document.getElementById('view-notebook').dataset.notesMode).toBe('notebooks');
  const toggle = headerActions.querySelector('[data-notes-overview-toggle]');
  expect(toggle).toBeInstanceOf(HTMLButtonElement);
  expect(toggle.textContent).toBe('Saved notes');
  expect(headerActions.hidden).toBe(false);
  expect(actionsRow.hidden).toBe(true);
  expect(headerActions.lastElementChild.id).toBe('newNoteMobile');
  expect(document.querySelector('#reminders-slim-header .header-title').textContent).toBe('Notes');

  toggle.click();
  expect(headerActions.querySelector('[data-notes-overview-toggle]')).toBe(toggle);
  expect(toggle.textContent).toBe('Back');
  expect(document.querySelector('#reminders-slim-header .header-title').textContent).toBe('Saved notes');

  document.getElementById('newNoteMobile').click();
  expect(headerActions.querySelector('[data-notes-overview-toggle]')).toBe(toggle);
  expect(toggle.textContent).toBe('Saved notes');
  expect(document.querySelector('#reminders-slim-header .header-title').textContent).toBe('Notes');
});

test('installs the full-page Notes writing canvas styles', () => {
  const { initMobileNotesShellUi } = loadMobileNotesShellUi();

  initMobileNotesShellUi({
    noteEditorSheet: document.getElementById('noteEditorSheet'),
    notesOverviewPanel: document.getElementById('notesOverviewPanel'),
    savedNotesSheet: document.getElementById('savedNotesSheet'),
  });

  const style = document.getElementById('memory-cue-notebook-polish');
  expect(style).toBeInstanceOf(HTMLStyleElement);
  expect(style.textContent).toContain('body[data-active-view="notebooks"] #notebook-editor-body');
  expect(style.textContent).toContain('height: calc(100dvh - 151px)');
  expect(style.textContent).toContain('border-radius: 0 !important');
  expect(style.textContent).toContain('.scratch-notes-header-block');
  expect(style.textContent).toContain('display: none !important');
});
