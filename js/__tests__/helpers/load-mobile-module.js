const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMobileModule() {
  const filePath = path.resolve(__dirname, '../../../mobile.js');
  let source = fs.readFileSync(filePath, 'utf8');

  // Strip ESM imports; tests inject lightweight mocks into window.__mobileMocks.
  source = source.replace(/^import[\s\S]*?;\s*$/mg, '');

  const preamble = `
const initViewportHeight = window.__mobileMocks?.initViewportHeight || (() => {});
const initReminders = window.__mobileMocks?.initReminders || (async () => ({}));
const initAuth = window.__mobileMocks?.initAuth || (async () => ({}));
const loadAllNotes = window.__mobileMocks?.loadAllNotes || (() => []);
const saveAllNotes = window.__mobileMocks?.saveAllNotes || (() => {});
const createNote = window.__mobileMocks?.createNote || ((note) => note || {});
const NOTES_STORAGE_KEY = window.__mobileMocks?.NOTES_STORAGE_KEY || 'memoryCueNotes';
const getFolders = window.__mobileMocks?.getFolders || (() => []);
const getFolderNameById = window.__mobileMocks?.getFolderNameById || (() => 'General');
const assignNoteToFolder = window.__mobileMocks?.assignNoteToFolder || (() => {});
const initNotesSync = window.__mobileMocks?.initNotesSync || (() => ({ handleSessionChange() {}, setFirebaseClient() {} }));
const saveFolders = window.__mobileMocks?.saveFolders || (() => {});
const buildDashboard = window.__mobileMocks?.buildDashboard || (() => ({}));
const generateWeeklySummary = window.__mobileMocks?.generateWeeklySummary || (async () => null);
const getRecallItems = window.__mobileMocks?.getRecallItems || (() => []);
const getInboxEntries = window.__mobileMocks?.getInboxEntries || (() => []);
const executeCommand = window.__mobileMocks?.executeCommand || (async () => ({ message: '', data: null }));
const ENABLE_CHAT_INTERFACE = window.__mobileMocks?.ENABLE_CHAT_INTERFACE ?? true;
const handleChatMessage = window.__mobileMocks?.handleChatMessage || (async () => ({ reply: '' }));
const clearMessages = window.__mobileMocks?.clearMessages || (() => {});
const getMessages = window.__mobileMocks?.getMessages || (() => []);
const deleteNote = window.__mobileMocks?.deleteNote || (async () => {});
const subscribeToInboxChanges = window.__mobileMocks?.subscribeToInboxChanges || (async () => null);
const subscribeToChatHistoryChanges = window.__mobileMocks?.subscribeToChatHistoryChanges || (async () => null);
const createChatComposer = window.__mobileMocks?.createChatComposer || (() => ({}));
const initMobileShellUi = window.__mobileMocks?.initMobileShellUi || (() => {});
const initMobileSyncControls = window.__mobileMocks?.initMobileSyncControls || (() => {});
const initMobileNotesShellUi = window.__mobileMocks?.initMobileNotesShellUi || (() => ({}));
const initMobileNotesFolderManager = window.__mobileMocks?.initMobileNotesFolderManager || (() => ({}));
const initMobileNotesBrowserUi = window.__mobileMocks?.initMobileNotesBrowserUi || (() => ({}));
const initMobileNotesEditorUi = window.__mobileMocks?.initMobileNotesEditorUi || (() => ({}));
const createDailyTasksManager = window.__mobileMocks?.createDailyTasksManager || (() => ({}));
`;

  source = preamble + source;

  const context = vm.createContext({
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    HTMLFormElement: window.HTMLFormElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    navigator,
    location: window.location,
    localStorage,
    globalThis: null,
    self: window,
  });

  context.globalThis = context;
  new vm.Script(source, { filename: filePath }).runInContext(context);
}

module.exports = { loadMobileModule };
