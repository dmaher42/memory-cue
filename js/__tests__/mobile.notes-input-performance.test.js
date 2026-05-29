/** @jest-environment jsdom */

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile notes editor input responsiveness', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <input id="noteTitleMobile" />
      <div id="notebook-editor-body" contenteditable="true"></div>
      <button id="noteSaveMobile" type="button">Save</button>
      <button id="noteFolderPillMobile" type="button">Unsorted</button>
      <button id="newNoteMobile" type="button">New note</button>
      <div id="notesListMobile"></div>
      <span id="notesCountMobile"></span>
      <section id="relatedNotesPanel"><div id="relatedNotesList"></div></section>
      <section id="notesOverviewPanel"><div id="notesOverviewList"></div></section>
    `;

    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => [],
      saveAllNotes: () => true,
      createNote: (title = '', bodyHtml = '', overrides = {}) => ({
        id: overrides.id || 'note-1',
        title,
        body: bodyHtml,
        bodyHtml,
        bodyText: overrides.bodyText || '',
        updatedAt: overrides.updatedAt || 'now',
        folderId: overrides.folderId || 'unsorted',
      }),
      getFolders: () => [{ id: 'unsorted', name: 'Unsorted' }],
      getFolderNameById: () => 'Unsorted',
      initNotesSync: () => ({ handleSessionChange() {}, setFirebaseClient() {} }),
      initMobileNotesShellUi: () => ({
        applyNotesMode: () => {},
        isSavedNotesSheetOpen: () => false,
        showSavedNotesSheet: () => {},
        hideSavedNotesSheet: () => {},
        openNoteOptionsMenu: () => {},
        openFolderSelectorForNote: () => {},
        closeMoveFolderSheet: () => {},
        closeNoteFolderSheet: () => {},
      }),
      initMobileNotesFolderManager: () => ({
        setAfterFolderCreated: () => {},
        openNewFolderDialog: () => {},
        syncNoteFolderButtonLabel: () => {},
        closeOverflowMenu: () => {},
        handleMoveNoteToFolder: () => {},
        openFolderOverflowMenu: () => {},
      }),
      initMobileNotesBrowserUi: () => ({}),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    delete window.__mobileMocks;
  });

  test('defers rebuilding note sections while typing in the editor', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const editor = document.getElementById('notebook-editor-body');
    expect(editor.dataset.sectionLabels || '').toBe('');

    editor.innerHTML = '<p># Lesson Plan</p>';
    editor.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(editor.dataset.sectionLabels || '').toBe('');

    jest.advanceTimersByTime(350);

    expect(editor.dataset.sectionLabels).toBe('Lesson Plan');
  });
});
