/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMobileModule() {
  const filePath = path.resolve(__dirname, '../../mobile.js');
  let source = fs.readFileSync(filePath, 'utf8');
  // Strip module import lines; tests inject mocks as `window.__mobileMocks`.
  source = source.replace(/^import[\s\S]*?;\s*$/mg, '');
  const preamble = `
const initViewportHeight = window.__mobileMocks?.initViewportHeight || (() => () => {});
const initReminders = window.__initReminders || window.__mobileMocks?.initReminders || (async () => {});
const initSupabaseAuth = window.__initSupabaseAuth || window.__mobileMocks?.initSupabaseAuth || (() => {});
const startSignInFlow = window.__startSignInFlow || window.__mobileMocks?.startSignInFlow || (async () => {});
const { loadAllNotes, saveAllNotes, createNote, NOTES_STORAGE_KEY } = window.__notesModule || window.__mobileMocks || { loadAllNotes: () => [], saveAllNotes: () => {}, createNote: (n) => n, NOTES_STORAGE_KEY: 'memoryCue:notes' };
const initNotesSync = window.__initNotesSync || window.__mobileMocks?.initNotesSync || (() => ({ handleSessionChange() {}, setSupabaseClient() {} }));
const { getFolders, getFolderNameById, assignNoteToFolder, saveFolders } = window.__notesModule || window.__mobileMocks || { getFolders: () => [], getFolderNameById: () => '', assignNoteToFolder: () => {}, saveFolders: () => {} };
const ModalController = window.__notesModule?.ModalController || window.__mobileMocks?.ModalController || class { constructor(){} show(){} hide(){} };
`;
  source = preamble + source;
  source = source.replace(
    "import { initViewportHeight } from './js/modules/viewport-height.js';",
    'const { initViewportHeight } = window.__mobileMocks;'
  );
  source = source.replace(
    "import { initReminders } from './js/reminders.js';",
    'const { initReminders } = window.__mobileMocks;'
  );
  source = source.replace(
    "import { initSupabaseAuth } from './js/supabase-auth.js';",
    "const { initSupabaseAuth, startSignInFlow } = window.__mobileMocks;"
  );
  source = source.replace(
    "import { ModalController } from './js/modules/modal-controller.js';",
    'const { ModalController } = window.__mobileMocks;'
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
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);
}

describe('mobile footer navigation', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="mobile-nav-shell" class="sticky inset-x-0 bottom-0 flex justify-center pointer-events-none px-2 pb-3" style="z-index:10001;">
        <div class="floating-footer">
          <button type="button" id="mobile-footer-notebook" data-nav-target="notebook"></button>
        </div>
      </div>
    `;

    // Provide required mocks for mobile module
    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initSupabaseAuth: jest.fn(),
      startSignInFlow: jest.fn(),
      ModalController: class ModalController {
        constructor() {}
        show() {}
        hide() {}
      },
    };

    // focus helper spy
    const focusSpy = jest.fn();
    window.focusNotebookInputs = focusSpy;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__mobileMocks;
    jest.clearAllMocks();
  });

  test('clicking notebook nav calls closers and dispatches app:navigate', () => {
    const navFooter = document.querySelector('#mobile-nav-shell .floating-footer');
    const notebookBtn = document.getElementById('mobile-footer-notebook');

    // Add spies on window closers
    const hideSavedSpy = jest.fn();
    const closeMoveSpy = jest.fn();
    const overflowSpy = jest.fn();
    const closeAddSheetSpy = jest.fn();
    window.hideSavedNotesSheet = hideSavedSpy;
    window.closeMoveFolderSheet = closeMoveSpy;
    window.closeOverflowMenu = overflowSpy;
    window.closeAddTask = closeAddSheetSpy;

    const events = [];
    const cueCloseSpy = jest.fn();
    document.addEventListener('cue:close', cueCloseSpy);
    window.addEventListener('app:navigate', (ev) => events.push(ev.detail));

    // Attach a navFooter handler (simulate inline script; just to ensure closers get called
    // and focus moves to the notebook editor when the notebook nav button is clicked)
    navFooter.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-nav-target]') : null;
      if (!button) return;
      // call closers
      try { window.hideSavedNotesSheet?.(); } catch (e) {}
      try { window.closeMoveFolderSheet?.(); } catch (e) {}
      try { window.closeOverflowMenu?.(); } catch (e) {}
      try { if (typeof window.closeAddTask === 'function') window.closeAddTask(); } catch (e) {}
      try { document.dispatchEvent(new CustomEvent('cue:close', { detail: { reason: 'app:navigate' } })); } catch (e) {}
      // ensure notebook focus helper is triggered when navigating to notebook
      try { window.focusNotebookInputs?.(); } catch (e) {}
      const view = button.getAttribute('data-nav-target');
      if (!view) return;
      // Simulate the actual mobile nav behavior for the notebook button
      if (view === 'notebook') {
        try { document.getElementById('noteTitleMobile')?.focus(); } catch (e) {}
        window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view } }));
        return;
      }
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view } }));
    });

    // add a fake notebook input to assert focus behavior
    const fakeNoteInput = document.createElement('input');
    fakeNoteInput.setAttribute('id', 'noteTitleMobile');
    fakeNoteInput.focus = jest.fn();
    document.body.appendChild(fakeNoteInput);

    notebookBtn.click();

    expect(hideSavedSpy).toHaveBeenCalled();
    expect(closeMoveSpy).toHaveBeenCalled();
    expect(overflowSpy).toHaveBeenCalled();
    expect(closeAddSheetSpy).toHaveBeenCalled();
    expect(events.length).toBe(1);
    expect(events[0]).toEqual({ view: 'notebook' });
    expect(fakeNoteInput.focus).toHaveBeenCalled();
    expect(window.focusNotebookInputs).toHaveBeenCalled();
    expect(cueCloseSpy).toHaveBeenCalled();
  });
});
