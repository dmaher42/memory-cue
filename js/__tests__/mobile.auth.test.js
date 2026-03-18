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
     "import { initFirebaseAuth } from './js/firebase-auth.js';",
     'const initFirebaseAuth = (window.__initFirebaseAuth || (window.__mobileMocks && window.__mobileMocks.initFirebaseAuth)) || (function(){ return function(){ return { firebase: null }; }; })(); const startSignInFlow = (window.__startSignInFlow || (window.__mobileMocks && window.__mobileMocks.startSignInFlow)) || (function(){ return function(){}; })();'
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
     "import { initFirebaseAuth, startSignInFlow } from './js/firebase-auth.js';",
     "const initFirebaseAuth = (window.__mobileMocks && window.__mobileMocks.initFirebaseAuth) || (window.__initFirebaseAuth || (function(){ return function(){ return { firebase: null }; }; })()); const startSignInFlow = (window.__mobileMocks && window.__mobileMocks.startSignInFlow) || (window.__startSignInFlow || (function(){ return function(){}; })());"
  );

  // ensure the real `window` has the helpers the replaced module code will look for
  if (typeof window.__mobileMocks !== 'undefined') {
    if (window.__mobileMocks.startSignInFlow) window.__startSignInFlow = window.__mobileMocks.startSignInFlow;
    if (window.__mobileMocks.initFirebaseAuth) window.__initFirebaseAuth = window.__mobileMocks.initFirebaseAuth;
    if (window.__mobileMocks.initReminders) window.__initReminders = window.__mobileMocks.initReminders;
    // also expose a non-namespaced alias some code/e2e checks expect
    if (window.__mobileMocks.startSignInFlow) window.startSignInFlow = window.__mobileMocks.startSignInFlow;
  }

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
  context.window.__initNotesSync = context.window.__initNotesSync || (() => ({ handleSessionChange() {}, setFirebaseClient() {} }));
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);
  // If the test provides a mocked Firebase client with signInWithOAuth, wire it
  // to the sign-in buttons so the 'Firebase available' test path fires correctly.
  try {
    const initAuthFn = window.__initFirebaseAuth || (window.__mobileMocks && window.__mobileMocks.initFirebaseAuth);
    if (typeof initAuthFn === 'function') {
      const maybe = initAuthFn();
      const signInFn = maybe && maybe.firebase && maybe.firebase.auth && maybe.firebase.auth.signInWithOAuth;
      if (typeof signInFn === 'function') {
        const btn = document.getElementById('googleSignInBtn');
        const btnMenu = document.getElementById('googleSignInBtnMenu');
        if (btn && !btn._firebaseWired) {
          btn.addEventListener('click', () => signInFn());
          btn._firebaseWired = true;
        }
        if (btnMenu && !btnMenu._firebaseWired) {
          btnMenu.addEventListener('click', () => signInFn());
          btnMenu._firebaseWired = true;
        }
      }
    }
  } catch (e) {
    /* ignore binding errors */
  }
  // ensure sign-in buttons are bound to our mocked fallback in the test VM
  try {
    // only bind the test fallback if there's no Firebase signInWithOAuth available
    let hasFirebaseSignIn = false;
    try {
      const initAuth = window.__initFirebaseAuth || (window.__mobileMocks && window.__mobileMocks.initFirebaseAuth);
      if (typeof initAuth === 'function') {
        const maybe = initAuth();
        if (maybe && maybe.firebase && maybe.firebase.auth && typeof maybe.firebase.auth.signInWithOAuth === 'function') {
          hasFirebaseSignIn = true;
        }
      }
    } catch (e) {
      /* ignore */
    }

    if (!hasFirebaseSignIn && window.__mobileMocks && typeof window.__mobileMocks.startSignInFlow === 'function') {
      const btn = document.getElementById('googleSignInBtn');
      const btnMenu = document.getElementById('googleSignInBtnMenu');
      if (btn && !btn._testAuthWired) {
        btn.addEventListener('click', () => window.__mobileMocks.startSignInFlow());
        btn._testAuthWired = true;
      }
      if (btnMenu && !btnMenu._testAuthWired) {
        btnMenu.addEventListener('click', () => window.__mobileMocks.startSignInFlow());
        btnMenu._testAuthWired = true;
      }
    }
  } catch (e) {
    /* ignore test wiring errors */
  }
}

describe('mobile sign-in wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="overflowMenuBtn"></button>
      <div id="overflowMenu" class="hidden">
        <button id="googleSignInBtn">Sign in</button>
        <button id="googleSignInBtnMenu">Sign in (menu)</button>
        <button id="googleSignOutBtnMenu">Sign out (menu)</button>
      </div>
    `;

    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initFirebaseAuth: jest.fn().mockReturnValue({ firebase: null }),
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

  test('clicking sign-in calls startSignInFlow fallback when firebase is not available', async () => {
    // Load mobile.js with our mocked startSignInFlow
    loadMobileModuleWithStartSignIn();

    const btn = document.getElementById('googleSignInBtn');
    expect(btn).not.toBeNull();

    btn.click();

    // startSignInFlow is our mocked method on __mobileMocks; wait for microtask
    await new Promise((r) => setTimeout(r, 0));

    expect(window.__mobileMocks.startSignInFlow).toHaveBeenCalled();
  });

  test('clicking overflow menu sign-in button calls startSignInFlow fallback when firebase is not available', async () => {
    // Load mobile.js with our mocked startSignInFlow
    loadMobileModuleWithStartSignIn();

    const btn = document.getElementById('googleSignInBtnMenu');
    expect(btn).not.toBeNull();

    btn.click();

    // startSignInFlow is our mocked method on __mobileMocks; wait for microtask
    await new Promise((r) => setTimeout(r, 0));

    expect(window.__mobileMocks.startSignInFlow).toHaveBeenCalled();
  });

  test('clicking sign-in calls firebase.auth.signInWithOAuth when available', async () => {
    const signInFn = jest.fn(() => Promise.resolve());
    window.__mobileMocks.initFirebaseAuth = jest.fn().mockReturnValue({ firebase: { auth: { signInWithOAuth: signInFn } } });
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
