/** @jest-environment jsdom */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');
const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile auth initialisation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="googleSignInBtn">Sign in</button>
      <button id="googleSignInBtnMenu">Sign in (menu)</button>
      <button id="googleSignOutBtn">Sign out</button>
      <button id="googleSignOutBtnMenu">Sign out (menu)</button>
      <div id="user-badge"></div>
      <div id="user-badge-email"></div>
      <div id="user-badge-initial"></div>
      <div id="googleUserName"></div>
      <div id="notesSyncStatus"></div>
      <div id="notesSyncMessage"></div>
    `;

    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => [],
      saveAllNotes: () => {},
      createNote: (note) => note || {},
      NOTES_STORAGE_KEY: 'memoryCueNotes',
      getFolders: () => [],
      getFolderNameById: () => 'General',
      assignNoteToFolder: () => {},
      initNotesSync: () => ({ handleSessionChange() {}, setFirebaseClient() {} }),
      saveFolders: () => {},
      initMobileNotesShellUi: jest.fn(() => ({})),
      initMobileNotesFolderManager: jest.fn(() => ({})),
      initMobileNotesBrowserUi: jest.fn(() => ({})),
      initMobileNotesEditorUi: jest.fn(() => ({})),
      ModalController: class ModalController {
        constructor() {}
        show() {}
        hide() {}
      },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__mobileMocks;
    jest.clearAllMocks();
  });

  test('passes the current sign-in and sign-out selectors into initAuth', async () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await Promise.resolve();

    expect(window.__mobileMocks.initAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        selectors: expect.objectContaining({
          signInButtons: ['#googleSignInBtn', '#googleSignInBtnMenu'],
          signOutButtons: ['#googleSignOutBtn', '#googleSignOutBtnMenu'],
          userBadge: '#user-badge',
          userBadgeEmail: '#user-badge-email',
          userBadgeInitial: '#user-badge-initial',
          userName: '#googleUserName',
          syncStatus: ['#notesSyncStatus'],
          feedback: ['#notesSyncMessage'],
        }),
        disableButtonBinding: false,
        onSessionChange: expect.any(Function),
      }),
    );
  });
});
