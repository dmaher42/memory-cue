/** @jest-environment jsdom */

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile Saved notes overview', () => {
  let openNoteOptionsMenu;
  let notes;
  let folders;

  beforeEach(() => {
    if (window.__memoryCueNotesWatcher) {
      clearInterval(window.__memoryCueNotesWatcher);
      delete window.__memoryCueNotesWatcher;
    }
    delete window.__memoryCueMobileNotesInit;
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

    notes = [
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
      {
        id: 'note-loose',
        title: 'Loose thought',
        bodyText: 'A note with no category',
        folderId: null,
        createdAt: '2026-07-26T09:00:00.000Z',
        updatedAt: '2026-07-28T09:00:00.000Z',
      },
      {
        id: 'note-orphan',
        title: 'Old category note',
        bodyText: 'Its old category was deleted',
        folderId: 'deleted-category',
        createdAt: '2026-07-25T09:00:00.000Z',
        updatedAt: '2026-07-27T09:00:00.000Z',
      },
      {
        id: 'note-class-hub',
        title: 'Year 8 excursion',
        bodyText: 'Class Hub note that remains searchable',
        folderId: 'hub-hpe',
        createdAt: '2026-07-24T09:00:00.000Z',
        updatedAt: '2026-07-26T09:00:00.000Z',
      },
    ];
    folders = [
      { id: 'school', name: 'School', order: 0 },
      { id: 'coaching', name: 'Coaching', order: 1 },
      { id: 'everyday', name: 'Everyday', order: 2 },
      { id: 'hub-hpe', name: 'Year 8 HPE', order: 3, kind: 'class-hub' },
    ];

    openNoteOptionsMenu = jest.fn();
    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => notes,
      saveAllNotes: () => true,
      getFolders: () => folders,
      getFolderNameById: (folderId) => folders.find((folder) => folder.id === folderId)?.name || 'No category',
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
    if (window.__memoryCueNotesWatcher) {
      clearInterval(window.__memoryCueNotesWatcher);
      delete window.__memoryCueNotesWatcher;
    }
    delete window.__memoryCueMobileNotesInit;
    document.body.innerHTML = '';
    delete window.__mobileMocks;
  });

  test('production shell includes the saved-notes search field', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../mobile.html'), 'utf8');

    expect(html).toContain('id="notesOverviewSearch"');
    expect(html).toContain('placeholder="Search saved notes"');
  });

  test('groups notes into collapsible categories and keeps the shared actions menu', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const categoryButtons = Array.from(document.querySelectorAll('[data-notes-category-toggle]'));
    expect(categoryButtons.map((button) => button.querySelector('.notes-overview-category-name').textContent))
      .toEqual(['School', 'Coaching', 'Everyday', 'No category']);
    expect(categoryButtons.every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(document.querySelector('[data-notes-category="hub-hpe"]')).toBeNull();

    const noCategory = document.querySelector('[data-notes-category="unsorted"]');
    expect(noCategory.querySelector('.notes-overview-category-count').textContent).toBe('2');
    expect(noCategory.textContent).toContain('Loose thought');
    expect(noCategory.textContent).toContain('Old category note');
    expect(document.body.textContent).not.toContain('Year 8 excursion');

    const coachingButton = document.querySelector('[data-notes-category-toggle="coaching"]');
    coachingButton.click();
    expect(coachingButton.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-notes-category="coaching"] [data-notes-category-content]').hidden).toBe(false);

    const coachingCard = document.querySelector('[data-notes-category="coaching"] .notes-overview-item');
    expect(coachingCard.querySelector('.notes-overview-item-title').textContent).toBe('Thursday training');
    expect(coachingCard.querySelector('.notes-overview-pinned-label').textContent).toBe('Pinned');
    expect(coachingCard.querySelector('.notes-overview-item-meta')).toBeNull();
    expect(coachingCard.querySelector('.notes-overview-item-preview')).toBeNull();
    expect(document.getElementById('note-options-sheet').parentElement).toBe(document.body);
    expect(document.getElementById('note-folder-sheet').parentElement).toBe(document.body);
    expect(document.getElementById('newFolderModal').parentElement).toBe(document.body);

    const actionsButton = coachingCard.querySelector('.notes-overview-item-actions');
    actionsButton.click();
    expect(openNoteOptionsMenu).toHaveBeenCalledWith('note-training', actionsButton);

    const schoolButton = document.querySelector('[data-notes-category-toggle="school"]');
    schoolButton.click();
    expect(schoolButton.getAttribute('aria-expanded')).toBe('true');
    expect(coachingButton.getAttribute('aria-expanded')).toBe('false');

    const search = document.getElementById('notesOverviewSearch');
    search.value = 'excursion';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));

    let cards = Array.from(document.querySelectorAll('.notes-overview-item'));
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.notes-overview-item-title').textContent).toBe('Year 8 excursion');
    expect(cards[0].querySelector('.notes-overview-item-preview')).toBeNull();
    expect(document.querySelector('[data-notes-category]')).toBeNull();

    search.value = '';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(document.querySelector('[data-notes-category-toggle="school"]').getAttribute('aria-expanded')).toBe('true');
  });

  test('keeps notes beyond the old thirty-note limit reachable in their category', () => {
    for (let index = 0; index < 31; index += 1) {
      notes.push({
        id: `school-extra-${index}`,
        title: `School note ${index + 1}`,
        bodyText: `Extra school note ${index + 1}`,
        folderId: 'school',
        createdAt: `2026-07-${String((index % 20) + 1).padStart(2, '0')}T09:00:00.000Z`,
        updatedAt: `2026-08-${String((index % 9) + 1).padStart(2, '0')}T09:00:00.000Z`,
      });
    }

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const schoolSection = document.querySelector('[data-notes-category="school"]');
    expect(schoolSection.querySelector('.notes-overview-category-count').textContent).toBe('32');
    schoolSection.querySelector('[data-notes-category-toggle]').click();
    expect(schoolSection.querySelectorAll('.notes-overview-item')).toHaveLength(32);
    expect(schoolSection.textContent).toContain('School note 31');
  });
});
