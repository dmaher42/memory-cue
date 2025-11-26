/** @jest-environment jsdom */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMobileModuleWithStartSignIn() {
  const filePath = path.resolve(__dirname, '../../mobile.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(
    "import { initViewportHeight } from './js/modules/viewport-height.js';",
    'const initViewportHeight = () => () => {};',
  );
  source = source.replace(
    "import { initReminders } from './js/reminders.js';",
    'const initReminders = window.__initReminders || window.__mobileMocks?.initReminders;',
  );
  source = source.replace(
    "import { initSupabaseAuth } from './js/supabase-auth.js';",
    'const initSupabaseAuth = window.__initSupabaseAuth; const startSignInFlow = window.__startSignInFlow;'
  );
  source = source.replace(
    "import {\n  loadAllNotes,\n  saveAllNotes,\n  createNote,\n  NOTES_STORAGE_KEY,\n} from './js/modules/notes-storage.js';",
    'const { loadAllNotes, saveAllNotes, createNote, NOTES_STORAGE_KEY } = window.__notesModule;',
  );
  source = source.replace(
    "import { initNotesSync } from './js/modules/notes-sync.js';",
    'const initNotesSync = window.__initNotesSync;'
  );
  source = source.replace(
    "import { getFolders } from './js/modules/notes-storage.js';",
    'const { getFolders } = window.__notesModule;'
  );
  source = source.replace(
    "import { getFolderNameById, assignNoteToFolder } from './js/modules/notes-storage.js';",
    'const { getFolderNameById, assignNoteToFolder } = window.__notesModule;'
  );
  source = source.replace(
    "import { ModalController } from './js/modules/modal-controller.js';",
    'const { ModalController } = window.__notesModule;'
  );
  source = source.replace(
    "import { saveFolders } from './js/modules/notes-storage.js';",
    'const { saveFolders } = window.__notesModule;'
  );
  // Replace named import of startSignInFlow so we can mock it by setting window.__startSignIn
  source = source.replace(
    "import { initSupabaseAuth, startSignInFlow } from './js/supabase-auth.js';",
    "const { initSupabaseAuth } = window.__mobileMocks; const startSignInFlow = window.__mobileMocks.startSignInFlow;"
  );

  const context = vm.createContext({
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    CustomEvent: window.CustomEvent,
    HTMLElement: window.HTMLElement,
    HTMLFormElement: window.HTMLFormElement,
    navigator,
    location: window.location,
  });
  context.window.__notesModule = context.window.__notesModule || {
    loadAllNotes: () => [],
    saveAllNotes: () => {},
    createNote: (note) => note || {},
    NOTES_STORAGE_KEY: 'memoryCue:notes',
  };
  context.window.__initNotesSync = context.window.__initNotesSync || (() => ({ handleSessionChange() {}, setSupabaseClient() {} }));
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);
}

describe('mobile sign-in wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="overflowMenuBtn"></button>
      <div id="overflowMenu" class="hidden">
        <button id="googleSignInBtn">Sign in</button>
      </div>
    `;

    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initSupabaseAuth: jest.fn().mockReturnValue({ supabase: null }),
      ModalController: class ModalController {
        constructor() {}
        show() {}
        hide() {}
      },
      startSignInFlow: jest.fn(() => Promise.resolve()),
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__mobileMocks;
    jest.clearAllMocks();
  });

  test('clicking sign-in calls startSignInFlow fallback when supabase is not available', async () => {
    // Load mobile.js with our mocked startSignInFlow
    loadMobileModuleWithStartSignIn();

    const btn = document.getElementById('googleSignInBtn');
    expect(btn).not.toBeNull();

    btn.click();

    // startSignInFlow is our mocked method on __mobileMocks; wait for microtask
    await new Promise((r) => setTimeout(r, 0));

    expect(window.__mobileMocks.startSignInFlow).toHaveBeenCalled();
  });

  test('clicking sign-in calls supabase.auth.signInWithOAuth when available', async () => {
    const signInFn = jest.fn(() => Promise.resolve());
    window.__mobileMocks.initSupabaseAuth = jest.fn().mockReturnValue({ supabase: { auth: { signInWithOAuth: signInFn } } });
    window.__mobileMocks.startSignInFlow = jest.fn(() => Promise.resolve());

    loadMobileModuleWithStartSignIn();

    const btn = document.getElementById('googleSignInBtn');
    btn.click();

    await new Promise((r) => setTimeout(r, 0));

    expect(signInFn).toHaveBeenCalled();
    // fallback should not be called
    expect(window.__mobileMocks.startSignInFlow).not.toHaveBeenCalled();
  });
});
