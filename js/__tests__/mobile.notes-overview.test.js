/** @jest-environment jsdom */

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile Saved notes overview', () => {
  let openNoteOptionsMenu;

  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="noteTitleMobile"></textarea>
      <div id="notebook-editor-body" contenteditable="true"></div>
      <button id="noteSaveMobile" type="button">Save</button>
      <button id="newNoteMobile" type="button">New note</button>
      <section id="notesOverviewPanel">
        <h2>Saved notes</h2>
        <input id="notesOverviewSearch" type="search" />
        <div id="notesOverviewList"></div>
      </section>
      <div id="noteEditorSheet"></div>
      <button id="mobile-footer-notebooks" type="button">Notes</button>
      <section id="savedNotesSheet" class="hidden">
        <div id="note-folder-sheet"></div>
        <div id="note-folder-sheet-backdrop"></div>
        <div id="note-options-overlay"></div>
        <div id="note-options-sheet"></div>
        <dialog id="newFolderModal"></dialog>
      </section>
    `;

    const notes = [
      {
        id: 'note-maths',
        title: 'Maths lesson plan',
        body: '<p>Fractions and decimals</p>',
        bodyHtml: '<p>Fractions and decimals</p>',
        bodyText: 'Fractions and decimals',
        folderId: 'school',
        pinned: false,
        createdAt: '2026-07-28T09:00:00.000Z',
        updatedAt: '2026-07-30T09:00:00.000Z',
      },
      {
        id: 'note-training',
        title: 'Thursday training',
        body: '<p>Strong group session</p>',
        bodyHtml: '<p>Strong group session</p>',
        bodyText: 'Strong group session',
        folderId: 'coaching',
        pinned: true,
        createdAt: '2026-07-27T09:00:00.000Z',
        updatedAt: '2026-07-29T09:00:00.000Z',
      },
    ];

    openNoteOptionsMenu = jest.fn();
    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => notes,
      saveAllNotes: () => true,
      getFolders: () => [
        { id: 'school', name: 'School' },
        { id: 'coaching', name: 'Coaching' },
      ],
      getFolderNameById: (folderId) => (folderId === 'school' ? 'School' : 'Coaching'),
      initNotesSync: () => ({ handleSessionChange() {}, setFirebaseClient() {} }),
      initMobileNotesShellUi: () => ({
        applyNotesMode: () => {},
        isSavedNotesSheetOpen: () => false,
        showSavedNotesSheet: () => {},
        hideSavedNotesSheet: () => {},
        openNoteOptionsMenu,
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
      initMobileNotesBrowserUi: (options) => {
        options.notesOverviewSearch?.addEventListener('input', () => {
          options.setNotesOverviewQuery(options.notesOverviewSearch.value.trim());
          options.renderNotesOverview();
        });
        return {};
      },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__mobileMocks;
  });

  test('production shell includes the saved-notes search field', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../mobile.html'), 'utf8');

    expect(html).toContain('id="notesOverviewSearch"');
    expect(html).toContain('placeholder="Search saved notes"');
  });

  test('renders searchable metadata-only cards with the shared actions menu', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    let cards = Array.from(document.querySelectorAll('.notes-overview-item'));
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('.notes-overview-item-title').textContent).toBe('Thursday training');
    expect(cards[0].querySelector('.notes-overview-pinned-label').textContent).toBe('Pinned');
    expect(cards[0].querySelector('.notes-overview-item-meta').textContent).toContain('Coaching');
    expect(cards[0].querySelectorAll('.notes-overview-item-meta span')).toHaveLength(3);
    expect(cards[0].querySelector('.notes-overview-item-preview')).toBeNull();
    expect(document.getElementById('note-options-sheet').parentElement).toBe(document.body);
    expect(document.getElementById('note-folder-sheet').parentElement).toBe(document.body);
    expect(document.getElementById('newFolderModal').parentElement).toBe(document.body);

    const actionsButton = cards[0].querySelector('.notes-overview-item-actions');
    actionsButton.click();
    expect(openNoteOptionsMenu).toHaveBeenCalledWith('note-training', actionsButton);

    const search = document.getElementById('notesOverviewSearch');
    search.value = 'maths';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));

    cards = Array.from(document.querySelectorAll('.notes-overview-item'));
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.notes-overview-item-title').textContent).toBe('Maths lesson plan');
    expect(cards[0].querySelector('.notes-overview-item-preview')).toBeNull();
  });
});
