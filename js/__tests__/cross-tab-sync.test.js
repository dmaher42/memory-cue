/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadModule(filePath, setupSource, exportNames, contextExtras = {}) {
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import[\s\S]*?;\s*$/mg, '');
  source = source.replace(/^export\s+(const|let|var|function|class)\s+/mg, '$1 ');
  source = source.replace(/^export\s+\{[^}]+\};?\s*$/mg, '');
  if (typeof setupSource === 'function') {
    source = setupSource(source);
  }
  const exportObject = exportNames.join(', ');
  source += `\nwindow.__loadedModule = { ${exportObject} };\n`;

  const context = vm.createContext({
    window,
    document,
    console,
    localStorage: window.localStorage,
    CustomEvent: window.CustomEvent,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    ...contextExtras,
  });
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);
  return window.__loadedModule;
}

describe('cross-tab sync bridges', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    delete window.__memoryCueNotesStorageBridgeBound;
    delete window.__memoryCueTeacherModeBridgeBound;
    delete window.__loadedModule;
  });

  test('notes storage bridge dispatches notesUpdated when another tab writes notes', () => {
    const filePath = path.resolve(__dirname, '../../js/modules/notes-storage.js');
    const module = loadModule(filePath, null, ['NOTES_STORAGE_KEY', 'FOLDERS_STORAGE_KEY']);
    const events = [];
    document.addEventListener('memoryCue:notesUpdated', (event) => {
      events.push(event.detail.items);
    });

    window.dispatchEvent(new StorageEvent('storage', {
      key: module.NOTES_STORAGE_KEY,
      newValue: JSON.stringify([{ id: '1', title: 'Projector sync test' }]),
    }));

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([{ id: '1', title: 'Projector sync test' }]);
    expect(window.__memoryCueNotesStorageBridgeBound).toBe(true);
  });

  test('teacher mode bridge dispatches active lesson updates when lesson state changes', () => {
    const filePath = path.resolve(__dirname, '../../src/services/teacherModeService.js');
    const module = loadModule(
      filePath,
      (source) => source,
      ['getActiveLessonNoteId', 'getTeacherLessonStep', 'ACTIVE_LESSON_NOTE_ID_KEY', 'LESSON_STEP_MAP_KEY'],
      {
        createNote: jest.fn(),
        loadAllNotes: jest.fn(() => [{
          id: 'lesson-123',
          title: 'Lesson 123',
          metadata: { teaching: true },
        }]),
        saveAllNotes: jest.fn(),
        requestAssistantChat: jest.fn(),
      }
    );

    const activeEvents = [];
    const stepEvents = [];
    document.addEventListener('memoryCue:activeLessonUpdated', (event) => {
      activeEvents.push(event.detail.noteId);
    });
    document.addEventListener('memoryCue:activeLessonStepUpdated', (event) => {
      stepEvents.push(event.detail);
    });

    localStorage.setItem(module.ACTIVE_LESSON_NOTE_ID_KEY, 'lesson-123');
    localStorage.setItem(module.LESSON_STEP_MAP_KEY, JSON.stringify({ 'lesson-123': 'teach' }));

    window.dispatchEvent(new StorageEvent('storage', {
      key: module.ACTIVE_LESSON_NOTE_ID_KEY,
      newValue: 'lesson-123',
    }));

    expect(activeEvents).toEqual(['lesson-123']);
    expect(stepEvents).toEqual([{ lessonId: 'lesson-123', stepId: 'teach' }]);
    expect(window.__memoryCueTeacherModeBridgeBound).toBe(true);
  });
});
