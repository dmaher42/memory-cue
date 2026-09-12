/**
 * @jest-environment jsdom
 */

const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile reminder notification status', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="create-sheet" class="sheet hidden">
        <div data-dialog-content>
          <button id="closeCreateSheet" type="button">Close</button>
          <form id="createReminderForm">
            <input id="reminderText" />
            <input id="reminderDate" type="date" />
            <input id="reminderTime" type="time" />
            <select id="priority"><option value="Medium" selected>Medium</option></select>
            <span id="reminderNotificationStatus"></span>
            <span id="reminderNotificationHelp"></span>
            <button id="retryReminderNotifications" type="button" hidden>Reconnect alerts</button>
            <div class="reminder-notification-setting">
              <input id="notifBtn" type="checkbox" />
            </div>
            <button id="saveReminder" type="button">Save</button>
          </form>
        </div>
        <div class="sheet-backdrop"></div>
      </div>
    `;

    class GrantedNotification {}
    GrantedNotification.permission = 'granted';
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: GrantedNotification,
    });

    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => [],
      saveAllNotes: () => {},
      createNote: () => ({}),
      NOTES_STORAGE_KEY: 'memoryCueNotes',
      initNotesSync: () => ({ handleSessionChange() {}, setFirebaseClient() {} }),
      getFolders: () => [],
      getFolderNameById: () => 'General',
      assignNoteToFolder: () => {},
      saveFolders: () => {},
    };

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete window.__mobileMocks;
    delete window.__MEMORY_CUE_PHONE_PUSH_STATUS;
    delete window.Notification;
    jest.clearAllMocks();
  });

  test('shows whether phone lock-screen push is unavailable or connected', () => {
    const status = document.getElementById('reminderNotificationStatus');

    document.dispatchEvent(new window.CustomEvent('reminder:notification-permission-changed', {
      detail: { permission: 'granted', phonePushStatus: 'unavailable' },
    }));
    expect(status.textContent).toBe(
      'Alerts work while Memory Cue is open. This device needs reconnecting for background alerts.'
    );
    expect(document.getElementById('retryReminderNotifications').hidden).toBe(false);
    expect(document.getElementById('retryReminderNotifications').disabled).toBe(false);

    document.dispatchEvent(new window.CustomEvent('reminder:notification-permission-changed', {
      detail: { permission: 'granted', phonePushStatus: 'connected' },
    }));
    expect(status.textContent).toBe(
      'This device is registered for push alerts'
    );
    expect(document.getElementById('reminderNotificationHelp').textContent)
      .toContain('Test a timed reminder');
    expect(document.getElementById('retryReminderNotifications').textContent).toBe('Check connection');
  });

  test('blocked notifications give settings guidance without offering a futile reconnect', () => {
    window.Notification.permission = 'denied';
    document.dispatchEvent(new window.CustomEvent('reminder:notification-permission-changed', {
      detail: { permission: 'denied', phonePushStatus: 'unavailable' },
    }));
    expect(document.getElementById('retryReminderNotifications').hidden).toBe(true);
    expect(document.getElementById('reminderNotificationHelp').textContent).toContain('browser');
  });
});
