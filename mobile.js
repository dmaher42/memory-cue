import { initViewportHeight } from './js/modules/viewport-height.js';
import { initReminders } from './js/reminders.js?v=20260323a';
import { initAuth } from './js/auth.js';
import {
  loadAllNotes,
  saveAllNotes,
  createNote,
  NOTES_STORAGE_KEY,
} from './js/modules/notes-storage.js';
import { getFolders } from './js/modules/notes-storage.js';
import { getFolderNameById, assignNoteToFolder } from './js/modules/notes-storage.js';
import { initNotesSync } from './js/modules/notes-sync.js';
import { ModalController } from './js/modules/modal-controller.js';
import { saveFolders } from './js/modules/notes-storage.js';
import { buildDashboard } from './js/modules/dashboard-data.js';
import { generateWeeklySummary } from './js/modules/weekly-summary.js';
import { getRecallItems } from './js/services/recall-service.js';
import { getInboxEntries } from './js/services/capture-service.js?v=20260323a';
import { executeCommand } from './src/core/commandEngine.js';
import { ENABLE_CHAT_INTERFACE, handleChatMessage } from './src/chat/chatManager.js';
import { clearMessages, getMessages } from './src/chat/messageStore.js';
import { deleteNote, subscribeToInboxChanges, subscribeToChatHistoryChanges } from './src/services/firestoreSyncService.js';
import { createChatComposer } from './src/components/ChatComposer.js';
import { initMobileShellUi } from './src/ui/mobileShellUi.js';
import { initMobileSyncControls } from './src/ui/mobileSyncControls.js';
import { initMobileNotesShellUi } from './src/ui/mobileNotesShellUi.js';

const runMobileShellUiInit = () => {
  if (typeof initMobileShellUi === 'function') {
    initMobileShellUi();
  }
};

const runMobileSyncControlsInit = () => {
  if (typeof initMobileSyncControls === 'function') {
    initMobileSyncControls();
  }
};

const isNotesSyncDebugEnabled = (() => {
  try {
    if (typeof window !== 'undefined' && window.__NOTES_SYNC_DEBUG) {
      return true;
    }
    if (typeof localStorage !== 'undefined') {
      return Boolean(localStorage.getItem('notesSyncDebug'));
    }
  } catch {
    /* ignore debug detection errors */
  }
  return false;
})();

initViewportHeight();


function initAssistant() {
    if (document.body?.dataset.memoryCueAssistantInit === 'true') {
      return;
    }
    if (document.body) {
      document.body.dataset.memoryCueAssistantInit = 'true';
    }
    const isTextEntryElement = (value) => {
      if (typeof HTMLInputElement !== 'undefined' && value instanceof HTMLInputElement) {
        return true;
      }
      if (typeof HTMLTextAreaElement !== 'undefined' && value instanceof HTMLTextAreaElement) {
        return true;
      }
      return Boolean(value && (value.tagName === 'INPUT' || value.tagName === 'TEXTAREA'));
    };
    const thinkingBarInput = document.getElementById('thinkingBarInput');
    const thinkingBarForm = document.getElementById('thinkingBarForm');
    const thinkingBarSubmit = document.getElementById('thinkingBarSubmit');
    const recentCapturesList = document.getElementById('recentCapturesList');
    const thinkingBarStatus = document.getElementById('thinkingBarStatus');
    const chatConversationContainer = document.getElementById('chatConversationContainer');
    const assistantHelpBtn = document.getElementById('assistantHelpBtn');
    const clearChatHistoryBtn = document.getElementById('clearChatHistoryBtn');
    const weeklyReflectionCard = document.getElementById('weeklyReflectionCard');
    const weeklyReflectionButton = document.getElementById('weeklyReflectionButton');
    const weeklyReflectionModal = document.getElementById('weeklyReflectionModal');
    const closeWeeklyReflectionButton = document.getElementById('closeWeeklyReflectionButton');
    const weeklyReflectionContent = document.getElementById('weeklyReflectionContent');
    const recallList = document.getElementById('memoryRecallList');
    let lastRecallNotificationKey = '';
    let isAssistantSending = false;
    if (!isTextEntryElement(thinkingBarInput)) {
      return;
    }

    const appendConversationMessage = (role, content, quickActions = []) => {
      if (!(chatConversationContainer instanceof HTMLElement)) {
        return;
      }

      const row = document.createElement('div');
      row.className = `chat-message ${role === 'user' ? 'chat-message--user' : 'chat-message--assistant'}`;
      row.textContent = content;

      if (role !== 'user' && Array.isArray(quickActions) && quickActions.length) {
        const actions = document.createElement('div');
        actions.className = 'chat-quick-actions';
        quickActions.forEach((action) => {
          if (!action || typeof action.label !== 'string') {
            return;
          }
          const item = document.createElement('span');
          item.textContent = action.label;
          actions.appendChild(item);
        });
        if (actions.childElementCount) {
          row.appendChild(actions);
        }
      }

      chatConversationContainer.appendChild(row);
      chatConversationContainer.scrollTop = chatConversationContainer.scrollHeight;
    };

    const appendAssistantMessage = (text, className = 'assistant-message') => {
      appendConversationMessage('assistant', text);
    };

    const renderConversationHistory = () => {
      if (!(chatConversationContainer instanceof HTMLElement)) {
        return;
      }
      chatConversationContainer.innerHTML = '';
      const messages = getMessages();
      messages.forEach((message) => {
        const content = typeof message?.content === 'string' ? message.content.trim() : '';
        if (!content) {
          return;
        }
        appendConversationMessage(message?.role === 'user' ? 'user' : 'assistant', content, message?.quickActions);
      });
    };

    const setThinkingBarStatus = (label) => {
      if (!(thinkingBarStatus instanceof HTMLElement)) {
        return;
      }
      if (typeof label === 'string' && label.trim()) {
        thinkingBarStatus.textContent = label;
        thinkingBarStatus.classList.remove('hidden');
      } else {
        thinkingBarStatus.textContent = '';
        thinkingBarStatus.classList.add('hidden');
      }
    };

    const readRemindersForRecall = () => {
      if (typeof localStorage === 'undefined') {
        return [];
      }
      try {
        const raw = localStorage.getItem('scheduledReminders');
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object') {
          return [];
        }
        return Object.values(parsed)
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            ...item,
            sourceType: 'reminder',
            recallText: typeof item.title === 'string' ? item.title : '',
          }));
      } catch {
        return [];
      }
    };

    const readInboxItemsForRecall = () => {
      const inboxItems = getInboxEntries();
      return inboxItems.map((entry) => ({
        ...entry,
        sourceType: 'inbox',
        recallText: typeof entry?.text === 'string' && entry.text.trim() ? entry.text.trim() : '',
      }));
    };

    const readNotesForRecall = () => {
      const notes = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
      return notes.map((note) => ({
        ...note,
        sourceType: 'note',
        recallText:
          (typeof note?.title === 'string' && note.title.trim())
            ? note.title.trim()
            : (typeof note?.bodyText === 'string' && note.bodyText.trim())
              ? note.bodyText.trim()
              : (typeof note?.body === 'string' && note.body.trim())
                ? note.body.trim()
                : '',
      }));
    };

    const maybeNotifyRecallItem = (recallItems) => {
      if (!Array.isArray(recallItems) || !recallItems.length) {
        return;
      }
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return;
      }

      const first = recallItems[0];
      const message = typeof first?.recallText === 'string' ? first.recallText.trim() : '';
      if (!message) {
        return;
      }

      const notificationKey = `${first?.sourceType || 'item'}:${message}`;
      if (notificationKey === lastRecallNotificationKey) {
        return;
      }

      lastRecallNotificationKey = notificationKey;
      try {
        new Notification('Memory Recall', {
          body: message.slice(0, 140),
        });
      } catch {
        // Ignore notification failures to avoid interrupting assistant tools.
      }
    };

    const renderMemoryRecall = () => {
      if (!(recallList instanceof HTMLElement)) {
        return;
      }

      const notes = readNotesForRecall();
      const reminders = readRemindersForRecall();
      const inboxItems = readInboxItemsForRecall();
      const recallItems = getRecallItems([...inboxItems, ...notes, ...reminders], { limit: 3 });

      recallList.innerHTML = '';
      if (!recallItems.length) {
        const empty = document.createElement('div');
        empty.className = 'recall-item recall-item--empty';
        empty.textContent = 'No recall suggestions yet.';
        recallList.appendChild(empty);
        return;
      }

      recallItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'recall-item';
        const text = typeof item?.recallText === 'string' ? item.recallText.trim() : '';
        row.textContent = text || 'Untitled capture';
        recallList.appendChild(row);
      });

      maybeNotifyRecallItem(recallItems);
    };

    renderMemoryRecall();
    document.addEventListener('memoryCue:remindersUpdated', renderMemoryRecall);
    document.addEventListener('memoryCue:entriesUpdated', renderMemoryRecall);
    document.addEventListener('memoryCue:notesUpdated', renderMemoryRecall);

    const toAssistantEntryText = (value, maxChars = 1000) => {
      if (typeof value !== 'string') {
        return '';
      }
      return value.trim().slice(0, maxChars);
    };

    const searchMemoryIndex = async (question) => {
      try {
        const memoryIndexModule = await import('./js/modules/memory-index.js');
        if (memoryIndexModule && typeof memoryIndexModule.searchMemoryIndex === 'function') {
          return memoryIndexModule.searchMemoryIndex(question);
        }
      } catch (error) {
        console.warn('[assistant] failed to load memory index search module', error);
      }

      return [];
    };

    const buildAssistantEntries = async (question) => {
      const sourceEntries = (await searchMemoryIndex(question)).slice(0, 5);

      // Keep assistant payloads lightweight while still sending top memory matches.
      const maxEntries = 5;

      return sourceEntries
        .slice(0, maxEntries)
        .map((entry) => {
          const body = toAssistantEntryText(entry?.body, 1000);
          const title = toAssistantEntryText(entry?.title, 300);
          if (!title && !body) {
            return null;
          }

          return {
            id: typeof entry?.id === 'string' ? entry.id : '',
            title,
            body,
            summary: toAssistantEntryText(entry?.summary, 240) || toAssistantEntryText(entry?.body, 240),
            type: typeof entry?.type === 'string' ? entry.type : 'note',
            tags: Array.isArray(entry?.tags)
              ? entry.tags.map((tag) => toAssistantEntryText(tag, 64)).filter(Boolean).slice(0, 12)
              : [],
            createdAt: Number.isFinite(entry?.createdAt) && entry.createdAt > 0
              ? new Date(entry.createdAt).toISOString()
              : null,
          };
        })
        .filter(Boolean);
    };

    const buildMemoryContextBlock = (question, entries) => {
      if (!Array.isArray(entries) || !entries.length) {
        return '';
      }

      const contextRows = entries.map((entry, index) => {
        const title = toAssistantEntryText(entry?.title, 120) || 'Untitled note';
        const tags = Array.isArray(entry?.tags) && entry.tags.length ? ` (${entry.tags.join(', ')})` : '';
        const summarySource = toAssistantEntryText(entry?.summary, 160) || toAssistantEntryText(entry?.body, 160);
        return `${index + 1}. ${title}${tags}${summarySource ? ` – ${summarySource}` : ''}`;
      });

      return [
        'User question:',
        `"${question}"`,
        '',
        'Context from saved notes:',
        ...contextRows,
        '',
        'Use this context when answering.',
      ].join('\n');
    };

    const buildAssistantContextText = () => {
      const maxContextItems = 15;
      const notes = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const thisWeekEnd = new Date(today);
      thisWeekEnd.setDate(thisWeekEnd.getDate() + 7);

      const toTimestamp = (value) => {
        if (typeof value !== 'string') {
          return 0;
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
      };

      const normalizeTitle = (value) => (typeof value === 'string' ? value.trim() : '');
      const parseActionDate = (value) => {
        const timestamp = toTimestamp(value);
        if (!timestamp) {
          return null;
        }
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
          return null;
        }
        date.setHours(0, 0, 0, 0);
        return date;
      };

      const noteRows = notes
        .map((note) => {
          const metadata = note && typeof note.metadata === 'object' && note.metadata ? note.metadata : {};
          return {
            title: normalizeTitle(note?.title),
            updatedAt: toTimestamp(note?.updatedAt) || toTimestamp(note?.createdAt),
            actionDate: parseActionDate(metadata.aiActionDate),
          };
        })
        .filter((entry) => entry.title);

      const inboxRows = getInboxEntries()
        .map((entry) => ({
          title: normalizeTitle(entry?.text),
          updatedAt: Number(entry?.createdAt) || 0,
        }))
        .filter((entry) => entry.title);

      const todayTitles = noteRows
        .filter((entry) => entry.actionDate && entry.actionDate.getTime() === today.getTime())
        .map((entry) => entry.title);

      const thisWeekTitles = noteRows
        .filter((entry) => entry.actionDate && entry.actionDate >= today && entry.actionDate <= thisWeekEnd)
        .map((entry) => entry.title);

      const recentTitles = [...noteRows, ...inboxRows]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, maxContextItems)
        .map((entry) => entry.title);

      const takeWithinLimit = (items, usedCount) => items.slice(0, Math.max(0, maxContextItems - usedCount));

      const selectedToday = takeWithinLimit(todayTitles, 0);
      const selectedWeek = takeWithinLimit(thisWeekTitles, selectedToday.length);
      const selectedRecent = takeWithinLimit(recentTitles, selectedToday.length + selectedWeek.length);

      const toListText = (items) => (items.length ? items.map((title) => `- ${title}`).join('\n') : '- None');

      return [
        'Today actions:',
        toListText(selectedToday),
        '',
        'This week actions:',
        toListText(selectedWeek),
        '',
        'Recent notes:',
        toListText(selectedRecent),
      ].join('\n');
    };

    const saveCapturedEntryAsNote = async (entry) => {
      const aiCaptureSave = await aiCaptureSaveModulePromise;
      const saveCaptureFn =
        (typeof aiCaptureSave.saveCapturedEntryAsNote === 'function' && aiCaptureSave.saveCapturedEntryAsNote)
        || (typeof aiCaptureSave.saveCaptureEntryAsNote === 'function' && aiCaptureSave.saveCaptureEntryAsNote)
        || (typeof aiCaptureSave.saveAiCaptureEntryAsNote === 'function' && aiCaptureSave.saveAiCaptureEntryAsNote)
        || (typeof aiCaptureSave.default === 'function' && aiCaptureSave.default)
        || null;

      if (saveCaptureFn) {
        return saveCaptureFn(entry);
      }

      const title = typeof entry?.title === 'string' ? entry.title : '';
      const bodyText = typeof entry?.body === 'string' ? entry.body : '';
      const note = createNote(title || 'Captured note', bodyText, { bodyText });
      const notes = loadAllNotes();
      saveAllNotes([note, ...notes]);
      return note;
    };

    const ensureFolderExistsByName = async (folderName) => {
      const requestedName = typeof folderName === 'string' ? folderName.trim() : '';
      if (!requestedName) {
        return;
      }

      const aiCaptureSave = await aiCaptureSaveModulePromise;
      if (typeof aiCaptureSave.ensureFolderExistsByName === 'function') {
        aiCaptureSave.ensureFolderExistsByName(requestedName);
        return;
      }

      const folders = Array.isArray(getFolders()) ? getFolders() : [];
      const existing = folders.find(
        (folder) => folder && typeof folder.name === 'string' && folder.name.trim().toLowerCase() === requestedName.toLowerCase(),
      );
      if (existing) {
        return;
      }

      const newFolderId = `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      saveFolders([
        ...folders,
        {
          id: newFolderId,
          name: requestedName,
          order: folders.length,
        },
      ]);
    };


    const sendAssistantMessage = async (event) => {
      if (event) {
        event.preventDefault();
      }
      if (isAssistantSending) {
        return;
      }

      const message = thinkingBarInput.value || '';
      const trimmedMessage = message.trim();

      if (!trimmedMessage) {
        return;
      }

      isAssistantSending = true;

      try {
        const reply = await handleChatMessage(trimmedMessage);
        const replyMessage = typeof reply?.message === 'string' && reply.message.trim()
          ? reply.message.trim()
          : 'Saved to Inbox';
        renderConversationHistory();
        setThinkingBarStatus(replyMessage);

        thinkingBarInput.value = '';
        thinkingBarInput.focus();
      } catch (error) {
        console.error('[capture] failed to process smart capture', error);
        appendAssistantMessage("Sorry, I couldn't process that capture.", 'assistant-message assistant-message--error');
      } finally {
        isAssistantSending = false;
      }
    };

    createChatComposer({
      form: thinkingBarForm,
      textarea: thinkingBarInput,
      button: thinkingBarSubmit,
    });

    thinkingBarForm?.addEventListener('submit', sendAssistantMessage);

    renderConversationHistory();
    document.addEventListener('memoryCue:chatUpdated', renderConversationHistory);

    clearChatHistoryBtn?.addEventListener('click', () => {
      clearMessages();
      renderConversationHistory();
      setThinkingBarStatus('');
    });

    assistantHelpBtn?.addEventListener('click', async () => {
      if (isAssistantSending) {
        return;
      }

      isAssistantSending = true;
      try {
        const reply = await handleChatMessage('help');
        const replyMessage = typeof reply?.message === 'string' && reply.message.trim()
          ? reply.message.trim()
          : 'Here is how Memory Cue works.';
        setThinkingBarStatus(replyMessage);
        renderConversationHistory();
      } catch (error) {
        console.error('[assistant] failed to load help content', error);
        appendAssistantMessage("Sorry, I couldn't load help right now.", 'assistant-message assistant-message--error');
      } finally {
        isAssistantSending = false;
      }
    });

    const renderRecentCaptures = () => {
      if (!(recentCapturesList instanceof HTMLElement)) {
        return;
      }

      const entries = getInboxEntries()
        .slice(0, 5)
        .map((entry) => (typeof entry?.text === 'string' ? entry.text.trim() : ''))
        .filter(Boolean);

      recentCapturesList.innerHTML = '';

      if (!entries.length) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'capture-recent-empty';
        emptyItem.textContent = 'No captures yet.';
        recentCapturesList.appendChild(emptyItem);
        return;
      }

      entries.forEach((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        recentCapturesList.appendChild(item);
      });
    };

    document.addEventListener('memoryCue:entriesUpdated', renderRecentCaptures);
    renderRecentCaptures();


    if (weeklyReflectionButton instanceof HTMLElement) {
      weeklyReflectionButton.addEventListener('click', async () => {
        if (!(weeklyReflectionCard instanceof HTMLElement) || !(weeklyReflectionModal instanceof HTMLElement)) {
          return;
        }

        const hasReflection = weeklyReflectionCard.dataset.loaded === 'true';
        if (hasReflection) {
          weeklyReflectionModal.classList.remove('hidden');
          weeklyReflectionModal.setAttribute('aria-hidden', 'false');
          return;
        }

        if (isAssistantSending) {
          return;
        }

        isAssistantSending = true;
        setThinkingBarStatus('Generating weekly reflection');

        try {
          const weeklySummary = await generateWeeklySummary();
          const summaryText = typeof weeklySummary?.summary === 'string' && weeklySummary.summary.trim()
            ? weeklySummary.summary.trim()
            : 'No weekly summary was returned.';

          if (weeklyReflectionContent instanceof HTMLElement) {
            weeklyReflectionContent.textContent = summaryText;
          }
          weeklyReflectionCard.dataset.loaded = 'true';
          weeklyReflectionModal.classList.remove('hidden');
          weeklyReflectionModal.setAttribute('aria-hidden', 'false');
          setThinkingBarStatus('Weekly reflection ready');
        } catch (error) {
          console.error('[assistant] failed to generate weekly reflection', error);
          appendAssistantMessage("Sorry, I couldn't generate a weekly reflection right now.", 'assistant-message assistant-message--error');
          setThinkingBarStatus('');
        } finally {
          isAssistantSending = false;
        }
      });
    }

    if (closeWeeklyReflectionButton instanceof HTMLElement && weeklyReflectionModal instanceof HTMLElement) {
      closeWeeklyReflectionButton.addEventListener('click', () => {
        weeklyReflectionModal.classList.add('hidden');
        weeklyReflectionModal.setAttribute('aria-hidden', 'true');
      });

      weeklyReflectionModal.addEventListener('click', (event) => {
        if (event.target === weeklyReflectionModal) {
          weeklyReflectionModal.classList.add('hidden');
          weeklyReflectionModal.setAttribute('aria-hidden', 'true');
        }
      });
    }
    // The mobile thinking bar submits through this module's form handler.
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAssistant();
  }, { once: true });
} else {
  initAssistant();
}

/*
DEPRECATED NAVIGATION BLOCK
Phase 3 uses js/services/navigation-service.js as the single navigation controller.
*/


document.querySelector('.fab-button')?.addEventListener('click', () => {
  openEditor();
});

function openEditor() {
  const editorSheet = document.querySelector('#noteEditorSheet');
  editorSheet.classList.remove('hidden');

  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 50);
}

/* BEGIN GPT CHANGE: bottom sheet open/close */
(function () {
  const setupSheet = () => {
    const sheet = document.getElementById('create-sheet');
    const closeBtn = document.getElementById('closeCreateSheet');
    if (!(sheet instanceof HTMLElement) || !(closeBtn instanceof HTMLElement)) {
      const attempts = typeof setupSheet._retryCount === 'number'
        ? setupSheet._retryCount
        : 0;
      if (attempts < 10) {
        setupSheet._retryCount = attempts + 1;
        setTimeout(setupSheet, 50);
      }
      return;
    }

    if (setupSheet._initialised) {
      return;
    }
    setupSheet._initialised = true;

    const sheetContent = sheet.querySelector('[data-dialog-content]');
    const backdrop = sheet.querySelector('.sheet-backdrop');
    const form = document.getElementById('createReminderForm');
    const saveBtn = document.getElementById('saveReminder');
    const prioritySelect = document.getElementById('priority');
    const chips = document.getElementById('priorityChips');
    const editorShell = sheet.querySelector('.reminder-editor-shell');
    const notifSwitchRow = sheet.querySelector('.notif-switch-row');
    const notifToggle = sheet.querySelector('#notifBtn');
    const priorityRadios = chips
      ? Array.from(chips.querySelectorAll('input[name="priority"]'))
      : [];

    const openerSet = new Set([
      ...Array.from(document.querySelectorAll('[data-open-add-task]')),
      ...Array.from(document.querySelectorAll('[aria-controls="createReminderModal"]')),
      ...Array.from(document.querySelectorAll('#addReminderFab')),
    ]);

    const openers = Array.from(openerSet).filter((button) =>
      button instanceof HTMLElement
    );
    const defaultOpener = openers[0] || null;

    const ensureHidden = () => {
      sheet.classList.add('hidden');
      sheet.setAttribute('hidden', '');
      sheet.setAttribute('aria-hidden', 'true');
      sheet.removeAttribute('open');
      sheet.classList.remove('open');

      [backdrop, sheetContent].forEach((layer) => {
        if (layer instanceof HTMLElement) {
          layer.classList.add('hidden');
          layer.setAttribute('hidden', '');
          layer.setAttribute('aria-hidden', 'true');
        }
      });
    };

    ensureHidden();

    [notifSwitchRow, notifToggle].forEach((el) => {
      el?.addEventListener('click', (event) => event.stopPropagation());
    });

    let lastTrigger = null;

    const dispatchSheetEvent = (type, detail) => {
      try {
        document.dispatchEvent(new CustomEvent(type, { detail }));
      } catch (error) {
        console.warn(`${type} dispatch failed`, error);
      }
    };

    const syncRadiosFromSelect = () => {
      const value = prioritySelect?.value || 'Medium';
      priorityRadios.forEach((radio) => {
        const isChecked = radio.value === value;
        radio.checked = isChecked;
        radio.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      });
    };

    const setPriorityValue = (value) => {
      if (!prioritySelect) return;
      if (prioritySelect.value !== value) {
        prioritySelect.value = value;
        prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncRadiosFromSelect();
    };

    priorityRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          setPriorityValue(radio.value);
        }
      });
    });

    prioritySelect?.addEventListener('change', syncRadiosFromSelect);
    syncRadiosFromSelect();

    const focusFirstField = () => {
      const focusTarget = sheet.querySelector(
        'input, textarea, select, button, [contenteditable="true"]'
      );
      if (focusTarget instanceof HTMLElement) {
        setTimeout(() => {
          try {
            focusTarget.focus();
          } catch {
            /* ignore focus errors */
          }
        }, 0);
      }
    };

    const playEnterAnimation = () => {
      if (!(editorShell instanceof HTMLElement)) return;
      editorShell.classList.remove('reminder-enter', 'reminder-enter-active');
      void editorShell.offsetWidth;
      editorShell.classList.add('reminder-enter');
      requestAnimationFrame(() => {
        editorShell.classList.add('reminder-enter-active');
      });
    };

    const openSheet = (trigger) => {
      lastTrigger = trigger instanceof HTMLElement ? trigger : null;
      if (!(sheet instanceof HTMLElement)) {
        console.warn('cue:open skipped: sheet element missing');
        return;
      }

      const missingElements = [];
      if (!(backdrop instanceof HTMLElement)) missingElements.push('backdrop');
      if (!(sheetContent instanceof HTMLElement)) missingElements.push('content');
      if (missingElements.length) {
        console.warn(`cue:open incomplete: missing ${missingElements.join(', ')}`);
      }

      if (backdrop instanceof HTMLElement) {
        backdrop.classList.remove('hidden');
        backdrop.removeAttribute('hidden');
        backdrop.setAttribute('aria-hidden', 'false');
      }
      if (sheetContent instanceof HTMLElement) {
        sheetContent.classList.remove('hidden');
        sheetContent.removeAttribute('hidden');
        sheetContent.setAttribute('aria-hidden', 'false');
      }
      sheet.classList.remove('hidden');
      sheet.removeAttribute('hidden');
      sheet.setAttribute('aria-hidden', 'false');
      sheet.setAttribute('open', '');
      sheet.classList.add('open');

      if (lastTrigger) {
        lastTrigger.setAttribute('aria-expanded', 'true');
      }

      syncRadiosFromSelect();
      focusFirstField();
      playEnterAnimation();

      const hiddenLayers = [
        { name: 'sheet', el: sheet },
        { name: 'backdrop', el: backdrop },
        { name: 'content', el: sheetContent },
      ]
        .filter(({ el }) => el instanceof HTMLElement)
        .filter(({ el }) =>
          el.classList.contains('hidden') ||
          el.hasAttribute('hidden') ||
          el.getAttribute('aria-hidden') === 'true'
        );

      if (hiddenLayers.length) {
        console.warn(
          `cue:open visibility issue: ${hiddenLayers
            .map(({ name }) => name)
            .join(', ')}`
        );
      }

      dispatchSheetEvent('reminder:sheet-opened', { trigger: lastTrigger });
    };

    const closeSheet = (reason = 'dismissed') => {
      const wasOpen = !sheet.classList.contains('hidden');
      if (editorShell) {
        editorShell.classList.remove('reminder-enter', 'reminder-enter-active');
      }
      ensureHidden();

      if (lastTrigger) {
        lastTrigger.setAttribute('aria-expanded', 'false');
      }

      const focusTarget =
        (lastTrigger && document.body.contains(lastTrigger) && lastTrigger) ||
        defaultOpener;
      if (focusTarget && typeof focusTarget.focus === 'function') {
        try {
          focusTarget.focus();
        } catch {
          /* ignore focus restoration failures */
        }
      }

      if (wasOpen) {
        dispatchSheetEvent('reminder:sheet-closed', {
          reason,
          trigger: lastTrigger,
        });
      }

      lastTrigger = null;
    };

    const triggerCueOpen = (trigger) => {
      if (typeof window !== 'undefined' && typeof window.openNewReminderSheet === 'function') {
        window.openNewReminderSheet(trigger);
        return;
      }
      const detail = { mode: 'create', trigger };
      dispatchSheetEvent('cue:prepare', detail);
      dispatchSheetEvent('cue:open', detail);
    };

    const bindOpener = (trigger, options = undefined) => {
      if (!(trigger instanceof HTMLElement)) return;
      const listenerOptions = options || false;
      trigger.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          triggerCueOpen(trigger);
        },
        listenerOptions,
      );
    };

    const primaryCta = document.getElementById('mobile-footer-new-reminder');

    openers.forEach((trigger) => {
      const isFooterCta = trigger === primaryCta;
      const options = isFooterCta ? { capture: true } : undefined;
      bindOpener(trigger, options);
    });

    if (primaryCta && !openers.includes(primaryCta)) {
      bindOpener(primaryCta, { capture: true });
    }

    closeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      closeSheet('close-button');
    });

    backdrop?.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        closeSheet('backdrop');
      }
    });

    sheet.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeSheet('escape');
      }
    });

    sheetContent?.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    sheet.addEventListener('click', (event) => {
      if (event.target instanceof HTMLElement && event.target.hasAttribute('data-close')) {
        closeSheet('backdrop');
      }
    });

    document.addEventListener('cue:open', (event) => {
      syncRadiosFromSelect();
      openSheet(event?.detail?.trigger || null);
    });

    document.addEventListener('cue:close', (event) => {
      closeSheet(event?.detail?.reason || 'cue-close');
    });

    document.addEventListener('cue:prepare', () => {
      syncRadiosFromSelect();
    });

    document.addEventListener('cue:cancelled', () => {
      closeSheet('cue-cancelled');
    });

    if (typeof window !== 'undefined') {
      window.closeAddTask = closeSheet;
    }

    document.addEventListener('reminder:save', (event) => {
      if (!(saveBtn instanceof HTMLElement)) return;
      const trigger = event?.detail?.trigger;
      if (trigger && trigger !== saveBtn) {
        return;
      }
      if (saveBtn.matches(':disabled')) {
        return;
      }
      saveBtn.click();
    });

    if (form instanceof HTMLFormElement && saveBtn instanceof HTMLElement) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (saveBtn.matches(':disabled')) {
          return;
        }
        saveBtn.click();
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSheet, { once: true });
  } else {
    setupSheet();
  }
})();

const bootstrapReminders = () => {
  if (bootstrapReminders._initialised) {
    return;
  }
  bootstrapReminders._initialised = true;

  initReminders({
    variant: 'mobile',
    qSel: '#searchReminders',
    titleSel: '#reminderText',
    dateSel: '#reminderDate',
    timeSel: '#reminderTime',
    detailsSel: '#reminderDetails',
    prioritySel: '#priority',
    categorySel: '#category',
    sortSel: '#reminderSort',
    saveBtnSel: '#saveReminder',
    cancelEditBtnSel: '#cancelEditBtn',
    listSel: '#reminderList',
    listWrapperSel: '#remindersWrapper',
    emptyStateSel: '#emptyState',
    statusSel: '#statusMessage',
    syncStatusSel: '#mcStatusText',
    notifBtnSel: '#notifBtn',
    categoryOptionsSel: '#categorySuggestions',
    countTotalSel: '#totalCount',
    googleSignInBtnSel: '#googleSignInBtn, #googleSignInBtnMenu',
    googleSignOutBtnSel: '#googleSignOutBtn, #googleSignOutBtnMenu',
    googleAvatarSel: '#googleAvatar',
    googleUserNameSel: '#googleUserName',
    syncAllBtnSel: '#syncAll',
    syncUrlInputSel: '#syncUrl',
    saveSettingsSel: '#saveSyncSettings',
    testSyncSel: '#testSync',
    exportBtnSel: '#exportBackupBtn',
    importFileSel: '#importBackupFile',
    importBtnSel: '#importBackupBtn',
    openSettingsSel: '[data-open="settings"]',
    dateFeedbackSel: '#dateFeedback',
    voiceBtnSel: '#startVoiceCaptureGlobal, #quickAddVoice',
  })
    .then(() => {
      // Wire Firebase auth + notes sync for mobile
      wireMobileNotesFirebaseAuth();
    })
    .catch((error) => {
      console.error('Failed to initialise reminders:', error);
    });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapReminders, { once: true });
} else {
  bootstrapReminders();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runMobileShellUiInit, { once: true });
} else {
  runMobileShellUiInit();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runMobileSyncControlsInit, { once: true });
} else {
  runMobileSyncControlsInit();
}

let requestNotesRefresh = null;

function mobileNotesSyncDidPullFromRemote() {
  if (typeof requestNotesRefresh === 'function') {
    requestNotesRefresh({ preserveDraft: true });
  }
}

const initMobileNotes = () => {
  if (typeof document === 'undefined') {
    return;
  }

  const titleInput = document.getElementById('noteTitleMobile');
  const scratchNotesEditorElement = document.getElementById('notebook-editor-body');
  const saveButton = document.getElementById('noteSaveMobile');
  const listElement = document.getElementById('notesListMobile');
  const countElement = document.getElementById('notesCountMobile');
  const relatedNotesPanel = document.getElementById('relatedNotesPanel');
  const relatedNotesList = document.getElementById('relatedNotesList');
  const filterInput = document.getElementById('notebook-search-input');
  const folderFilterSelect = document.getElementById('folderFilterSelect');
  const folderFilterNewButton = document.getElementById('folderFilterNewFolder');
  const notesOverviewPanel = document.getElementById('notesOverviewPanel');
  const notebookBrowserList = document.getElementById('notebookBrowserList');
  const notesOverviewList = document.getElementById('notesOverviewList');
  const notesOverviewSearch = document.getElementById('notesOverviewSearch');
  const notesOverviewSort = document.getElementById('notesOverviewSort');
  const notesOverviewState = document.getElementById('notesOverviewState');
  const noteEditorSheet = document.getElementById('noteEditorSheet');
  const savedNotesSheet = document.getElementById('savedNotesSheet');
  const openSavedNotesButton =
    document.getElementById('openSavedNotesSheet') ||
    document.getElementById('openSavedNotesGlobal') ||
    document.getElementById('savedNotesShortcut');
  const closeSavedNotesButton = document.querySelector('[data-action="close-saved-notes"]');
  const folderSelectorEl = document.querySelector('.move-to-folder-sheet');
  const folderSelectorListEl = folderSelectorEl?.querySelector('.folder-option-list');
  const folderSelectorBackdrop = folderSelectorEl?.querySelector('.sheet-backdrop');
  const noteFolderSheet = document.getElementById('note-folder-sheet');
  const noteFolderSheetBackdrop = document.getElementById('note-folder-sheet-backdrop');
  const noteFolderSheetList = noteFolderSheet?.querySelector('.note-folder-sheet-list');
  const noteFolderSheetClose = noteFolderSheet?.querySelector('.note-folder-sheet-close');
  const ACTIVE_NOTE_SHADOW_CLASS = 'shadow-[0_0_0_3px_var(--accent-color)]';

  const createScratchNotesEditor = () => {
    if (!scratchNotesEditorElement) {
      return null;
    }

    const NotesEditorClass =
      (typeof window !== 'undefined' && typeof window.NotesEditor === 'function'
        ? window.NotesEditor
        : null);

    if (NotesEditorClass) {
        return new NotesEditorClass('#notebook-editor-body', {
          toolbar: true,
          placeholder: 'Start typing your note…',
        });
    }

    scratchNotesEditorElement.setAttribute('contenteditable', 'true');
    scratchNotesEditorElement.setAttribute('role', 'textbox');
    scratchNotesEditorElement.setAttribute('aria-multiline', 'true');
    scratchNotesEditorElement.dataset.placeholder = 'Start typing your note…';

    return {
      element: scratchNotesEditorElement,
      setContent(value = '') {
        // preserve HTML markup (paragraphs, formatting)
        scratchNotesEditorElement.innerHTML = value || '';
      },
      getHTML() {
        return scratchNotesEditorElement.innerHTML || '';
      },
      getText() {
        // plain text fallback if required
        return scratchNotesEditorElement.textContent || '';
      },
      focus() {
        try {
          scratchNotesEditorElement.focus();
        } catch {
          /* ignore focus errors */
        }
      },
    };
  };

  const scratchNotesEditor = createScratchNotesEditor();

  if (!titleInput || !scratchNotesEditor || !scratchNotesEditorElement || !saveButton) {
    return;
  }

  const TOGGLE_COMMANDS = new Set([
    'bold',
    'italic',
    'underline',
    'insertunorderedlist',
    'insertorderedlist',
    'indent',
    'outdent',
  ]);

  function updateToolbarState() {
    const buttons = document.querySelectorAll('.rte-btn[data-cmd]');
    buttons.forEach((button) => {
      const command = (button.dataset.cmd || '').toLowerCase();
      if (!command || !TOGGLE_COMMANDS.has(command)) {
        button.classList.remove('active');
        return;
      }
      try {
        const active = document.queryCommandState(command);
        button.classList.toggle('active', !!active);
      } catch (err) {
        button.classList.remove('active');
      }
    });
  }

  const applyFormatCommand = (command) => {
    if (!command || !scratchNotesEditorElement) return;
    try {
      scratchNotesEditorElement.focus();
    } catch {
      /* ignore focus errors */
    }
    try {
      document.execCommand(command, false, null);
    } catch (err) {
      /* ignore execCommand errors */
    }
    updateToolbarState();
    try {
      const syntheticInput = new Event('input', { bubbles: true });
      scratchNotesEditorElement.dispatchEvent(syntheticInput);
    } catch {
      /* ignore synthetic event errors */
    }
  };

  // Wire up formatting toolbar (bold, italic, underline, lists, indent/outdent, undo/redo)
  const toolbarEl = document.getElementById('scratchNotesToolbar');
  if (toolbarEl && scratchNotesEditorElement) {
    toolbarEl.addEventListener('click', (event) => {
      const button = event.target.closest('.rte-btn[data-cmd]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const command = button.getAttribute('data-cmd');
      if (command) {
        applyFormatCommand(command);
      }
    });
  }

  const getEditorBodyHtml = () => {
    if (
      scratchNotesEditor &&
      typeof scratchNotesEditor.getHtml === 'function'
    ) {
      return scratchNotesEditor.getHtml() || '';
    }
    if (scratchNotesEditor && typeof scratchNotesEditor.getHTML === 'function') {
      return scratchNotesEditor.getHTML() || '';
    }
    return scratchNotesEditorElement.innerHTML || '';
  };

  const setEditorBodyHtml = (html = '') => {
    const normalizedHtml = typeof html === 'string' ? html : '';
    if (
      scratchNotesEditor &&
      typeof scratchNotesEditor.setHtml === 'function'
    ) {
      scratchNotesEditor.setHtml(normalizedHtml);
    } else if (
      scratchNotesEditor &&
      typeof scratchNotesEditor.setContent === 'function'
    ) {
      scratchNotesEditor.setContent(normalizedHtml);
    } else {
      scratchNotesEditorElement.innerHTML = normalizedHtml;
    }
  };

  const getEditorBodyText = (html = '') => {
    const temp = document.createElement('div');
    temp.innerHTML = typeof html === 'string' ? html : '';
    return (temp.textContent || temp.innerText || '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const setEditorContent = (value = '') => {
    const normalizedValue = typeof value === 'string' ? value : '';
    setEditorBodyHtml(normalizedValue);
    updateToolbarState();
  };

  const getEditorHTML = () => getEditorBodyHtml();

  const getEditorText = () => getEditorBodyText(getEditorBodyHtml());

  const getClosestBlock = (node) => {
    let current = node;
    while (current && current !== scratchNotesEditorElement) {
      if (
        current.nodeType === Node.ELEMENT_NODE &&
        ['div', 'p', 'li'].includes(current.tagName?.toLowerCase())
      ) {
        return current;
      }
      current = current.parentNode;
    }
    return scratchNotesEditorElement;
  };

  const detectListShortcut = (prefixText) => {
    if (typeof prefixText !== 'string') {
      return null;
    }
    const normalized = prefixText.replace(/\u00a0/g, ' ');
    if (/^\s*[\*-]\s*$/.test(normalized)) {
      return 'ul';
    }
    if (/^\s*1\.?\s*$/.test(normalized)) {
      return 'ol';
    }
    return null;
  };

  const handleListShortcuts = (event) => {
    if (event.key !== ' ') {
      return;
    }
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!scratchNotesEditorElement.contains(range.startContainer)) {
        return;
      }
      const block = getClosestBlock(range.startContainer);
      const prefixRange = range.cloneRange();
      prefixRange.selectNodeContents(block);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const prefixText = prefixRange.toString();
      const marker = detectListShortcut(prefixText);
      if (!marker) {
        return;
      }
      event.preventDefault();
      prefixRange.deleteContents();
      applyFormatCommand(marker === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
    }, 0);
  };

  const handleFormattingShortcuts = (event) => {
    if (!event || event.altKey || !(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = (event.key || '').toLowerCase();
    let command = null;
    if (key === 'b') {
      command = 'bold';
    } else if (key === 'i') {
      command = 'italic';
    } else if (key === 'u') {
      command = 'underline';
    }

    if (!command) {
      return;
    }

    event.preventDefault();
    applyFormatCommand(command);
  };

  const debounce = (fn, delay = 200) => {
    let timeoutId;
    return (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        fn(...args);
      }, delay);
    };
  };

  let currentNoteId = null;
  let currentNoteIsNew = false;
  let currentNoteHasChanged = false;
  let allNotes = [];
  let currentFolderId = 'all';
  let currentEditingNoteFolderId = 'unsorted';
  let currentFolderMoveNoteId = null;
  let currentMoveFolderSheetNoteId = null;
  let folderSelectorOnSelect = null;
  let activeFolderSheetOpener = null;
  let filterQuery = '';
  let notesOverviewQuery = '';
  let notesOverviewSortValue = 'recent';
  let notesOverviewStateValue = 'all';
  let notesMode = 'notebooks';
  let skipAutoSelectOnce = false;

  const clearSearchFilter = () => {
    filterQuery = '';
    if (filterInput) {
      filterInput.value = '';
    }
  };

  let applyNotesMode = () => {};
  let isSavedNotesSheetOpen = () => false;
  let showSavedNotesSheet = () => {};
  let hideSavedNotesSheet = () => {};
  let openNoteOptionsMenu = () => {};
  let openFolderSelectorForNote = () => {};
  let closeMoveFolderSheet = () => {};
  let closeNoteFolderSheet = () => {};

  if (relatedNotesPanel instanceof HTMLElement) {
    relatedNotesPanel.classList.add('hidden');
  }

  const getNormalizedFilterQuery = () =>
    typeof filterQuery === 'string' ? filterQuery.trim().toLowerCase() : '';

  const normalizeFolderId = (value, { fallback = 'unsorted' } = {}) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed.toLowerCase();
      }
    }
    return fallback;
  };

  const getFilteredNotes = (source = allNotes) => {
    if (!Array.isArray(source)) {
      return [];
    }
    const normalizedQuery = getNormalizedFilterQuery();
    if (!normalizedQuery) {
      return [...source];
    }
    return source.filter((note) => {
      const title = typeof note?.title === 'string' ? note.title.toLowerCase() : '';
      const body = getNoteBodyText(note).toLowerCase();
      return title.includes(normalizedQuery) || body.includes(normalizedQuery);
    });
  };

  const sortNotesForDisplay = (notes = []) => {
    return [...notes].sort((a, b) => {
      const aPinned = Boolean(a?.pinned);
      const bPinned = Boolean(b?.pinned);

      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }

      return getNoteTimestamp(b) - getNoteTimestamp(a);
    });
  };

  const getVisibleNotes = (source = allNotes) => {
    if (!Array.isArray(source)) return [];
    // Apply folder filtering first
    const activeFolder = normalizeFolderId(currentFolderId, { fallback: 'all' });
    let filteredByFolder;
    if (activeFolder === 'all') {
      filteredByFolder = [...source];
    } else if (activeFolder === 'unsorted') {
      filteredByFolder = source.filter((note) => {
        const noteFolder = normalizeFolderId(note?.folderId);
        return noteFolder === 'unsorted';
      });
    } else {
      filteredByFolder = source.filter((note) => normalizeFolderId(note?.folderId) === activeFolder);
    }
    // Then apply search filter
    return sortNotesForDisplay(getFilteredNotes(filteredByFolder));
  };


  const getNotesOverviewItems = () => {
    const items = Array.isArray(allNotes) ? [...allNotes] : [];
    const q = (notesOverviewQuery || '').trim().toLowerCase();
    const stateFilter = (notesOverviewStateValue || 'all').toLowerCase();

    const filtered = items.filter((note) => {
      const title = typeof note?.title === 'string' ? note.title : '';
      const body = getNoteBodyText(note);
      const haystack = `${title} ${body}`.toLowerCase();
      const noteState = typeof note?.state === 'string' ? note.state.toLowerCase() : 'processed';
      const matchesQuery = !q || haystack.includes(q);
      const matchesState = stateFilter === 'all' || noteState === stateFilter;
      return matchesQuery && matchesState;
    });

    if (notesOverviewSortValue === 'notebook') {
      filtered.sort((a, b) => {
        const aFolder = getFolderNameById(a?.folderId || 'unsorted');
        const bFolder = getFolderNameById(b?.folderId || 'unsorted');
        return String(aFolder).localeCompare(String(bFolder));
      });
      return filtered;
    }

    if (notesOverviewSortValue === 'priority') {
      filtered.sort((a, b) => Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned)) || getNoteTimestamp(b) - getNoteTimestamp(a));
      return filtered;
    }

    if (notesOverviewSortValue === 'tagged') {
      filtered.sort((a, b) => {
        const aTags = Array.isArray(a?.tags) ? a.tags.length : 0;
        const bTags = Array.isArray(b?.tags) ? b.tags.length : 0;
        return bTags - aTags || getNoteTimestamp(b) - getNoteTimestamp(a);
      });
      return filtered;
    }

    return sortNotesForDisplay(filtered);
  };

  const renderNotesOverview = () => {
    if (!(notesOverviewList instanceof HTMLElement)) {
      return;
    }
    notesOverviewList.innerHTML = '';
    const items = getNotesOverviewItems();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'text-sm text-base-content/70';
      empty.textContent = 'No notes found.';
      notesOverviewList.appendChild(empty);
      return;
    }

    items.slice(0, 30).forEach((note) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'w-full text-left memory-glass-card-soft p-2';
      const folder = getFolderNameById(note?.folderId || 'unsorted') || 'Unsorted';
      const tags = Array.isArray(note?.tags) && note.tags.length ? note.tags.join(', ') : 'none';
      button.innerHTML = `<div class="font-medium">${note?.title || 'Untitled note'}</div><div class="text-xs text-base-content/70">Notebook: ${folder}</div><div class="text-xs text-base-content/70">Tags: ${tags}</div><div class="text-xs text-base-content/70">Created: ${formatNoteTimestamp(note?.createdAt || note?.updatedAt)}</div>`;
      button.addEventListener('click', () => {
        setEditorValues(note);
        updateListSelection();
        applyNotesMode('notebooks');
        const notebooksBtn = document.getElementById('mobile-footer-notebooks');
        if (notebooksBtn instanceof HTMLElement) {
          notebooksBtn.click();
        }
      });
      notesOverviewList.appendChild(button);
    });
  };

  const getNoteCountsByFolder = (allNotesArray = [], folders = []) => {
    const counts = {
      all: Array.isArray(allNotesArray) ? allNotesArray.length : 0,
      unsorted: 0,
    };

    (Array.isArray(folders) ? folders : []).forEach((folder) => {
      if (folder && folder.id && folder.id !== 'unsorted') {
        counts[folder.id] = 0;
      }
    });

    (Array.isArray(allNotesArray) ? allNotesArray : []).forEach((note) => {
      const folderId = note?.folderId || 'unsorted';
      if (!folderId || folderId === 'unsorted') {
        counts.unsorted += 1;
      } else if (Object.prototype.hasOwnProperty.call(counts, folderId)) {
        counts[folderId] += 1;
      } else {
        counts.unsorted += 1;
      }
    });

    return counts;
  };

  const setEditorValues = (note, options = {}) => {
    const { isNew = false } = options;
    if (note && currentNoteId === note.id && !isNew) {
      renderRelatedNotes(note);
      return;
    }
    if (!note) {
      currentNoteIsNew = false;
      currentNoteHasChanged = false;
      currentNoteId = null;
      titleInput.value = '';
      setEditorContent('');
      delete titleInput.dataset.noteOriginalTitle;
      scratchNotesEditorElement.dataset.noteOriginalBody = getEditorHTML();
      const labelElClear = document.getElementById('note-folder-label');
      if (labelElClear) {
        labelElClear.textContent = getFolderNameById(currentEditingNoteFolderId || 'unsorted');
      }
      syncNoteFolderButtonLabel(currentEditingNoteFolderId);
      renderRelatedNotes(null);
      return;
    }
    currentNoteIsNew = Boolean(isNew);
    currentNoteHasChanged = false;
    currentNoteId = note.id;
    const nextTitle = note.title || '';
    const preferredHtml = typeof note.bodyHtml === 'string' ? note.bodyHtml : null;
    const fallbackBody = typeof note.body === 'string' ? note.body : '';
    const nextBody = (preferredHtml ?? fallbackBody) || '';
    titleInput.value = isNew ? '' : nextTitle;
    setEditorContent(isNew ? '' : nextBody);
    titleInput.dataset.noteOriginalTitle = isNew ? '' : nextTitle;
    scratchNotesEditorElement.dataset.noteOriginalBody = getEditorHTML();
    // set current editing folder for existing notes
    currentEditingNoteFolderId = note.folderId && typeof note.folderId === 'string' ? note.folderId : 'everyday';
    syncNoteFolderButtonLabel(currentEditingNoteFolderId);
    renderRelatedNotes(note);
  };

  const extractPlainText = (html = '') => getEditorBodyText(html);

  const getNoteBodyText = (note) => {
    if (!note) return '';
    if (typeof note.bodyText === 'string' && note.bodyText.trim().length) {
      return note.bodyText.trim();
    }
    const source = typeof note.bodyHtml === 'string' && note.bodyHtml.trim().length
      ? note.bodyHtml
      : typeof note.body === 'string'
        ? note.body
        : '';
    return extractPlainText(source);
  };

  const getDashboardItemLabel = (note) => {
    const title = typeof note?.title === 'string' ? note.title.trim() : '';
    if (title) {
      return title;
    }
    const body = getNoteBodyText(note).trim();
    return body || 'Untitled note';
  };

  const getNoteLinks = (note) => {
    if (!Array.isArray(note?.links)) {
      return [];
    }
    return note.links
      .map((linkId) => (typeof linkId === 'string' ? linkId.trim() : ''))
      .filter((linkId, index, links) => linkId && links.indexOf(linkId) === index);
  };

  const renderRelatedNotes = (note) => {
    if (!(relatedNotesPanel instanceof HTMLElement) || !(relatedNotesList instanceof HTMLElement)) {
      return;
    }

    relatedNotesList.innerHTML = '';

    if (!note || typeof note.id !== 'string') {
      relatedNotesPanel.classList.add('hidden');
      return;
    }

    relatedNotesPanel.classList.remove('hidden');

    const related = getNoteLinks(note)
      .map((id) => allNotes.find((entry) => entry?.id === id))
      .filter(Boolean);

    if (!related.length) {
      relatedNotesPanel.classList.add('hidden');
      return;
    }

    related.forEach((relatedNote) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost btn-xs justify-start w-full';
      button.textContent = getDashboardItemLabel(relatedNote);
      button.addEventListener('click', () => {
        setEditorValues(relatedNote);
        updateListSelection();
      });
      relatedNotesList.appendChild(button);
    });
  };

  const buildDashboardData = () => {
    const dashboard = buildDashboard();
    return [
      { title: 'Today', items: Array.isArray(dashboard.today) ? dashboard.today : [] },
      { title: 'Coaching', items: Array.isArray(dashboard.coaching) ? dashboard.coaching : [] },
      { title: 'Teaching', items: Array.isArray(dashboard.teaching) ? dashboard.teaching : [] },
      { title: 'Recent', items: Array.isArray(dashboard.recent) ? dashboard.recent : [] },
      { title: 'Inbox', items: Array.isArray(dashboard.inbox) ? dashboard.inbox : [] },
    ];
  };

  const openNoteFromDashboard = (noteId) => {
    if (!noteId) {
      return;
    }
    const note = allNotes.find((item) => item?.id === noteId);
    if (!note) {
      return;
    }

    setEditorValues(note);
    updateListSelection();
    if (isSavedNotesSheetOpen()) {
      hideSavedNotesSheet();
    }

    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'notebooks' } }));
  };

  const renderDashboardPanel = () => {
    const dashboardPanel = document.getElementById('dashboardPanel');
    if (!(dashboardPanel instanceof HTMLElement)) {
      return;
    }

    const sections = buildDashboardData();
    dashboardPanel.innerHTML = '';

    sections.forEach((section) => {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'memory-glass-card-soft p-3 mb-2';

      const titleEl = document.createElement('h3');
      titleEl.className = 'text-sm font-semibold mb-1';
      titleEl.textContent = section.title;
      sectionEl.appendChild(titleEl);

      const listEl = document.createElement('ul');
      listEl.className = 'space-y-1';

      if (!Array.isArray(section.items) || section.items.length === 0) {
        const emptyEl = document.createElement('li');
        emptyEl.className = 'text-xs text-base-content/60';
        emptyEl.textContent = 'No notes yet';
        listEl.appendChild(emptyEl);
      } else {
        section.items.forEach((note) => {
          const itemEl = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'text-left w-full text-sm';
          button.dataset.noteId = note.id;
          button.textContent = `• ${getDashboardItemLabel(note)}`;
          button.addEventListener('click', () => {
            openNoteFromDashboard(note.id);
          });
          itemEl.appendChild(button);
          listEl.appendChild(itemEl);
        });
      }

      sectionEl.appendChild(listEl);
      dashboardPanel.appendChild(sectionEl);
    });
  };

  const updateListSelection = () => {
    if (!listElement) {
      return;
    }
    const buttons = listElement.querySelectorAll('[data-role="open-note"][data-note-id]');
    buttons.forEach((button) => {
      if (!(button instanceof HTMLElement)) {
        return;
      }
      const isActive = button.getAttribute('data-note-id') === currentNoteId;
      if (isActive) {
        button.setAttribute('data-state', 'active');
      } else {
        button.removeAttribute('data-state');
      }
      button.classList.toggle('selected', isActive);
      button.classList.toggle('active', isActive);
      button.classList.toggle('outline', isActive);
      button.classList.toggle('outline-2', isActive);
      button.classList.toggle('outline-accent', isActive);
      button.classList.toggle(ACTIVE_NOTE_SHADOW_CLASS, isActive);
      button.setAttribute('aria-current', isActive ? 'true' : 'false');
      const parentItem = button.closest('.note-list-item, .note-row');
      if (parentItem) {
        parentItem.classList.toggle('is-active', isActive);
        parentItem.classList.toggle('selected', isActive);
      }
    });
  };

  const formatNoteTimestamp = (timestamp) => {
    if (!timestamp) {
      return '';
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const now = new Date();
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    const timeString = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) {
      return `Today · ${timeString}`;
    }
    const dateString = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateString} · ${timeString}`;
  };

  const hasUnsavedChanges = () => {
    if (currentNoteIsNew && !currentNoteHasChanged) {
      return false;
    }
    const currentTitle = typeof titleInput.value === 'string' ? titleInput.value : '';
    const currentBody = getEditorBodyHtml();
    const originalTitle = titleInput.dataset.noteOriginalTitle ?? '';
    const originalBody = scratchNotesEditorElement.dataset.noteOriginalBody ?? '';
    return currentTitle !== originalTitle || currentBody !== originalBody;
  };

  const hasMeaningfulContent = () => {
    const currentTitle = typeof titleInput.value === 'string' ? titleInput.value.trim() : '';
    const bodyText = getEditorText();
    return Boolean(currentTitle) || Boolean(bodyText);
  };

  const resetEditorScroll = () => {
    const editorContainer = document.querySelector('.note-editor-card');
    if (editorContainer) {
      editorContainer.scrollTop = 0;
    }
    const editorInner = document.querySelector('.note-editor-inner');
    if (editorInner) {
      editorInner.scrollTop = 0;
    }
  };

  const isMobileViewport = () =>
    (typeof window !== 'undefined' && window.innerWidth < 768)
    || /Mobi|Android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');

  const getNoteTimestamp = (note) => {
    if (!note) return 0;
    const candidates = [note.updatedAt, note.modifiedAt, note.createdAt];
    for (const value of candidates) {
      const parsed = Date.parse(value || '');
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return 0;
  };

  const getSortedNotes = () => {
    const notes = loadAllNotes();
    if (!Array.isArray(notes)) {
      return [];
    }
    return [...notes].sort((a, b) => getNoteTimestamp(b) - getNoteTimestamp(a));
  };

  const readStoredSnapshot = () => {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    try {
      return localStorage.getItem(NOTES_STORAGE_KEY);
    } catch {
      return null;
    }
  };

  let lastSerializedNotes = readStoredSnapshot();

  const updateStoredSnapshot = () => {
    lastSerializedNotes = readStoredSnapshot();
    return lastSerializedNotes;
  };

  const refreshFromStorage = ({ preserveDraft = true } = {}) => {
    const sortedNotes = getSortedNotes();
    allNotes = Array.isArray(sortedNotes) ? [...sortedNotes] : [];
    const shouldPreserveEditor = preserveDraft && hasUnsavedChanges();
    const hasAnyNotes = allNotes.length > 0;
    const visibleNotes = getVisibleNotes();

    renderNotesList(visibleNotes);
    renderDashboardPanel();
    renderNotesOverview();

    if (!hasAnyNotes) {
      if (!shouldPreserveEditor) {
        setEditorValues(null);
      }
      updateListSelection();
      updateStoredSnapshot();
      skipAutoSelectOnce = false;
      return visibleNotes;
    }

    if (currentNoteId) {
      const activeNote = allNotes.find((note) => note.id === currentNoteId) || null;
      if (activeNote) {
        if (!shouldPreserveEditor) {
          setEditorValues(activeNote);
        }
      } else {
        currentNoteId = null;
        if (!shouldPreserveEditor && !skipAutoSelectOnce && allNotes[0]) {
          setEditorValues(allNotes[0]);
        }
      }
    } else if (!shouldPreserveEditor && !skipAutoSelectOnce && allNotes[0]) {
      setEditorValues(allNotes[0]);
    }

    skipAutoSelectOnce = false;
    updateListSelection();
    updateStoredSnapshot();
    return visibleNotes;
  };

  applyNotesMode('notebooks');

  const renderNotebookList = () => refreshFromStorage({ preserveDraft: true });
  window.renderNotebookList = renderNotebookList;

  // Expose the refresh helper via the shared notes refresh hook
  requestNotesRefresh = (options = {}) => {
    try {
      refreshFromStorage(options);
    } catch (error) {
      console.warn('[notebook] requestNotesRefresh failed', error);
    }
  };

  const NOTEBOOK_LIST_TRANSITION_MS = 160;

  const showNoteToast = (message) => {
    if (!message) return null;
    const toast = document.createElement('div');
    toast.className = 'note-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast && toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 2800);
    return toast;
  };

  const showMoveToast = (folderName) => {
    const name = folderName || 'folder';
    showNoteToast(`Moved to ${name}`);
  };
  const scheduleNotebookFrame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 0);
  const cancelNotebookFrame =
    typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (id) => clearTimeout(id);
  let listTransitionTimeoutId = null;
  let listTransitionFrameId = null;

  const runNotebookListTransition = (renderFn) => {
    if (typeof renderFn !== 'function') {
      return;
    }

    if (!listElement) {
      renderFn();
      return;
    }

    if (listTransitionTimeoutId) {
      clearTimeout(listTransitionTimeoutId);
      listTransitionTimeoutId = null;
    }
    if (listTransitionFrameId) {
      cancelNotebookFrame(listTransitionFrameId);
      listTransitionFrameId = null;
    }

    listElement.classList.remove('notebook-list-transition-in', 'notebook-list-transition-in-active');
    listElement.classList.add('notebook-list-transition-out');

    listTransitionTimeoutId = setTimeout(() => {
      renderFn();

      listElement.classList.remove('notebook-list-transition-out');
      listElement.classList.add('notebook-list-transition-in');

      listTransitionFrameId = scheduleNotebookFrame(() => {
        listElement.classList.add('notebook-list-transition-in-active');
      });
    }, NOTEBOOK_LIST_TRANSITION_MS);
  };

  const handleDeleteNote = (noteId) => {
    if (!noteId) {
      return;
    }

    const existingNotes = loadAllNotes();
    if (!Array.isArray(existingNotes)) {
      return;
    }

    const filteredNotes = existingNotes.filter((note) => note.id !== noteId);
    if (filteredNotes.length === existingNotes.length) {
      return;
    }

    saveAllNotes(filteredNotes);
    deleteNote(noteId).catch((error) => {
      console.warn('[notes-sync] Failed to delete note from Firebase.', error);
    });
    updateStoredSnapshot();

    if (currentNoteId === noteId) {
      setEditorValues(null);
      skipAutoSelectOnce = true;
    }

    refreshFromStorage({ preserveDraft: false });
  };

  let activeNoteCardMenu = null;
  let activeNoteCardMenuButton = null;

  const closeActiveNoteMenu = () => {
    if (activeNoteCardMenu) {
      activeNoteCardMenu.classList.remove('open');
    }
    if (activeNoteCardMenuButton) {
      activeNoteCardMenuButton.setAttribute('aria-expanded', 'false');
    }
    activeNoteCardMenu = null;
    activeNoteCardMenuButton = null;
  };

  const openNoteCardMenu = (menuEl, triggerEl) => {
    if (!menuEl || !triggerEl) return;
    if (activeNoteCardMenu === menuEl) {
      closeActiveNoteMenu();
      return;
    }
    closeActiveNoteMenu();
    activeNoteCardMenu = menuEl;
    activeNoteCardMenuButton = triggerEl;
    triggerEl.setAttribute('aria-expanded', 'true');
    menuEl.classList.add('open');
  };

  const handleGlobalNoteMenuClose = (event) => {
    if (!activeNoteCardMenu || !activeNoteCardMenuButton) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (
      activeNoteCardMenu.contains(target)
      || activeNoteCardMenuButton.contains(target)
    ) {
      return;
    }
    closeActiveNoteMenu();
  };

  document.addEventListener('click', handleGlobalNoteMenuClose);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeActiveNoteMenu();
    }
  });

  const renderNotesList = (notes = [], { withTransition = true } = {}) => {
    if (withTransition) {
      runNotebookListTransition(() => renderNotesList(notes, { withTransition: false }));
      return notes;
    }

    if (!listElement) {
      return notes;
    }

    closeActiveNoteMenu();
    listElement.innerHTML = '';

    if (countElement) {
      const totalSaved = allNotes.length;
      const visibleCount = notes.length;
      countElement.textContent = totalSaved
        ? `${visibleCount} of ${totalSaved} saved`
        : 'No saved notes yet';
    }

    if (!notes.length) {
      const hasFilter = Boolean(getNormalizedFilterQuery());
      const emptyTitle = hasFilter ? 'No notes found' : 'No notes yet';
      const emptyBody = hasFilter
        ? 'Try a different search term or clear the search.'
        : 'Create a new note to start capturing your ideas.';

      listElement.innerHTML = `
        <div class="notebook-empty">
          <div class="notebook-empty-title">${emptyTitle}</div>
          <div class="notebook-empty-body">${emptyBody}</div>
        </div>
      `;
      return notes;
    }

    notes.forEach((note) => {
      const listItem = document.createElement('li');
      const isActiveNote = String(note.id) === String(currentNoteId);
      const isPinned = Boolean(note?.pinned);
      listItem.className = 'note-item-mobile';

      const noteCard = document.createElement('div');
      noteCard.className = 'note-card note-row note-list-item';
      noteCard.classList.toggle('selected', isActiveNote);
      noteCard.classList.toggle('is-active', isActiveNote);
      noteCard.dataset.noteId = note.id;
      noteCard.dataset.role = 'open-note';
      noteCard.setAttribute('role', 'button');
      noteCard.tabIndex = 0;

      const cardMain = document.createElement('div');
      cardMain.className = 'note-row-main note-list-main note-card-main';
      cardMain.dataset.role = 'open-note';
      cardMain.dataset.noteId = note.id;

      const noteTitle = (typeof note.title === 'string' && note.title.trim()) || 'Untitled';
      const titleEl = document.createElement('div');
      titleEl.className = 'note-row-title note-list-title note-card-title';
      titleEl.textContent = noteTitle;
      titleEl.setAttribute('title', noteTitle);

      const titleRow = document.createElement('div');
      titleRow.className = 'note-row-title-row note-list-title-row note-card-header';
      titleRow.appendChild(titleEl);

      if (isPinned) {
        const pinIcon = document.createElement('span');
        pinIcon.className = 'note-list-pin-icon';
        pinIcon.textContent = '📌';
        pinIcon.setAttribute('aria-hidden', 'true');
        titleRow.appendChild(pinIcon);
      }

      const folderId = note.folderId && typeof note.folderId === 'string' ? note.folderId : 'everyday';
      const folderName = getFolderNameById(folderId) || 'Unsorted';
      const metaRow = document.createElement('div');
      metaRow.className = 'note-row-meta note-list-meta note-card-meta';

      const folderButton = document.createElement('button');
      folderButton.type = 'button';
      folderButton.className = 'note-row-folder note-list-folder note-card-folder';
      folderButton.textContent = folderName;
      folderButton.setAttribute('aria-label', 'Move note to folder');
      folderButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFolderSelectorForNote(note.id, {
          initialFolderId: folderId,
          triggerEl: folderButton,
        });
      });

      metaRow.appendChild(folderButton);

      cardMain.appendChild(titleRow);
      cardMain.appendChild(metaRow);

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.dataset.noteId = note.id;
      actionBtn.dataset.role = 'note-menu';
      actionBtn.className = 'note-row-overflow note-list-overflow note-options-button note-card-action';
      actionBtn.setAttribute('aria-label', 'Note actions');
      actionBtn.setAttribute('aria-expanded', 'false');
      actionBtn.tabIndex = 0;
      actionBtn.setAttribute('aria-haspopup', 'true');
      actionBtn.textContent = '⋮';

      const actionMenu = document.createElement('div');
      actionMenu.className = 'note-card-menu';
      actionMenu.setAttribute('role', 'menu');

      const moveMenuItem = document.createElement('button');
      moveMenuItem.type = 'button';
      moveMenuItem.className = 'note-card-menu-item';
      moveMenuItem.textContent = 'Move to Folder';
      moveMenuItem.setAttribute('role', 'menuitem');
      moveMenuItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeActiveNoteMenu();
        openFolderSelectorForNote(note.id, {
          initialFolderId: folderId,
          triggerEl: actionBtn,
        });
      });

      const deleteMenuItem = document.createElement('button');
      deleteMenuItem.type = 'button';
      deleteMenuItem.className = 'note-card-menu-item note-card-menu-danger';
      deleteMenuItem.textContent = 'Delete';
      deleteMenuItem.setAttribute('role', 'menuitem');
      deleteMenuItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeActiveNoteMenu();
        handleDeleteNote(note.id);
      });

      actionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openNoteCardMenu(actionMenu, actionBtn);
      });

      actionMenu.appendChild(moveMenuItem);
      actionMenu.appendChild(deleteMenuItem);

      noteCard.appendChild(actionBtn);
      noteCard.appendChild(cardMain);
      noteCard.appendChild(actionMenu);
      listItem.appendChild(noteCard);
      listElement.appendChild(listItem);
    });

    updateListSelection();
    return notes;
  };

  /* Folder chip bar rendering and interaction */
  const getFolderBarEl = () => document.getElementById('notebook-folder-bar');

  const setActiveFolderChip = (folderId) => {
    const bar = getFolderBarEl();
    if (!bar) return;
    const chips = bar.querySelectorAll('.notebook-folder-chip');
    chips.forEach((chip) => {
      const isActive = String(chip.dataset.folderId) === String(folderId);
      chip.classList.toggle('notebook-folder-chip--active', isActive);
      // keep legacy active class for compatibility
      chip.classList.toggle('active', isActive);
      if (isActive) {
        try {
          chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch (e) {
          try { chip.scrollIntoView(); } catch {}
        }
      }
    });
  };

  const getFolderModel = () => {
    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch {
      folders = [];
    }
    const normalized = Array.isArray(folders) ? folders.filter(Boolean) : [];
    const unsortedFolder =
      normalized.find((f) => f && f.id === 'unsorted') || { id: 'unsorted', name: 'Unsorted' };
    const extraFolders = normalized
      .filter((f) => f && f.id !== 'unsorted')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

    const chipModel = [
      { id: 'all', name: 'All notes', isVirtual: true },
      { ...unsortedFolder, isVirtual: false },
      ...extraFolders.map((f) => ({ ...f, isVirtual: false })),
    ];

    return { chipModel, unsortedFolder, extraFolders };
  };

  const setActiveFolderFilter = (folderId) => {
    if (!folderFilterSelect) return;
    const normalized = folderId || 'all';
    folderFilterSelect.value = normalized;
  };

  const buildFolderFilterSelect = (chipModelOverride = null) => {
    if (!folderFilterSelect) return;
    const model = Array.isArray(chipModelOverride) ? chipModelOverride : getFolderModel().chipModel;
    folderFilterSelect.innerHTML = '';

    model.forEach((folder) => {
      const option = document.createElement('option');
      option.value = folder.id || 'unsorted';
      option.textContent = folder.name || 'Folder';
      folderFilterSelect.appendChild(option);
    });

    setActiveFolderFilter(currentFolderId);
  };
  const buildFolderChips = () => {
    const folderBar = getFolderBarEl();
    if (!folderBar) return;
    folderBar.innerHTML = '';
    const filterBar = document.createElement('div');
    filterBar.className = 'notebook-folder-filter-bar';
    const { chipModel, unsortedFolder, extraFolders } = getFolderModel();
    const folderListForCounts = [unsortedFolder, ...extraFolders];
    const noteCounts = getNoteCountsByFolder(allNotes, folderListForCounts);

    const createChip = (folder) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      // keep legacy `folder-chip` for existing code paths, add new premium class
      chip.className = 'folder-chip notebook-folder-chip notebook-tab';
      chip.dataset.folderId = folder.id;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'notebook-folder-chip-label';
      nameSpan.textContent = folder.name;
      chip.appendChild(nameSpan);

      const countSpan = document.createElement('span');
      countSpan.className = 'notebook-folder-chip-count';
      const countKey = folder.id === 'all' ? 'all' : folder.id || 'unsorted';
      const countValue = typeof noteCounts[countKey] === 'number' ? noteCounts[countKey] : 0;
      countSpan.textContent = countValue;
      chip.appendChild(countSpan);

      chip.addEventListener('click', () => {
        currentFolderId = folder.id === 'all' ? 'all' : folder.id;
        // set active class and auto-scroll
        setActiveFolderChip(currentFolderId);
        clearSearchFilter();
        // re-render notes using current filter
        renderFilteredNotes();
      });

      // For editable folders (not All or Unsorted) show overflow affordance
      if (folder.id !== 'all' && folder.id !== 'unsorted') {
        const overflowBtn = document.createElement('button');
        overflowBtn.type = 'button';
        overflowBtn.className = 'notebook-folder-chip-overflow';
        overflowBtn.setAttribute('aria-label', 'Folder options');
        overflowBtn.innerHTML = '⋯';
        overflowBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          openFolderOverflowMenu(folder.id, chip);
        });
        chip.appendChild(overflowBtn);
      }

      return chip;
    };

    chipModel.forEach((folder) => {
      filterBar.appendChild(createChip(folder));
    });

    // Create a scroll wrapper for the chips
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'notebook-folder-scroll-wrap';
    scrollWrap.appendChild(filterBar);

    // Build header container: chips on the left (scrollable)
    const header = document.createElement('div');
    header.className = 'notebook-folder-header';

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'folder-chips';
    chipsWrap.appendChild(scrollWrap);

    header.appendChild(chipsWrap);

    folderBar.appendChild(header);

    // ensure active chip is visually set and scrolled into view
    setActiveFolderChip(currentFolderId);
    buildFolderFilterSelect(chipModel);
  };

  /* New Folder modal setup */
  const newFolderModalEl = document.getElementById('newFolderModal');
  const newFolderNameInput = document.getElementById('newFolderName');
  const newFolderError = document.getElementById('newFolderError');
  const newFolderCreateBtn = document.getElementById('newFolderCreate');
  const newFolderCancelBtn = document.getElementById('newFolderCancel');
  let newFolderModalController = null;
  let afterFolderCreated = null;

  const clearNewFolderError = () => {
    if (!newFolderError) return;
    newFolderError.classList.add('sr-only');
    newFolderError.textContent = '';
  };

  const showNewFolderError = (msg) => {
    if (!newFolderError) return;
    newFolderError.textContent = msg;
    newFolderError.classList.remove('sr-only');
  };

  const openNewFolderDialog = () => {
    // Prefer the dedicated modal dialog for folder creation. The modal
    // markup exists in `mobile.html` and is wired below; use the
    // ModalController to handle focus trapping and accessibility.
    if (!newFolderModalEl) {
      // Safety fallback: if modal markup is missing, log and abort.
      // Avoid using `prompt()` to provide a consistent, accessible UX.
      console.warn('[notebook] #newFolderModal not found; create folder modal missing');
      return;
    }

    if (!newFolderModalController) {
      newFolderModalController = new ModalController({
        modalElement: newFolderModalEl,
        closeButton: newFolderCancelBtn,
        titleInput: newFolderNameInput,
        modalTitle: document.getElementById('newFolderTitle'),
        autoFocus: true,
      });
    }

    clearNewFolderError();
    if (newFolderNameInput) {
      newFolderNameInput.value = '';
      // autofocus will be handled by ModalController, but ensure selection
      setTimeout(() => {
        try {
          newFolderNameInput.focus();
          newFolderNameInput.select && newFolderNameInput.select();
        } catch (e) {
          /* ignore focus errors */
        }
      }, 20);
    }

    newFolderModalController.show();
  };

  // Expose helper globally for other scripts or tests that expect a window-level API
  if (typeof window !== 'undefined' && typeof window.openNewFolderDialog === 'undefined') {
    window.openNewFolderDialog = openNewFolderDialog;
  }

  if (folderFilterNewButton) {
    folderFilterNewButton.addEventListener('click', (event) => {
      event.preventDefault();
      openNewFolderDialog();
    });
  }

  const createNewFolder = () => {
    if (!newFolderNameInput) return;
    const raw = String(newFolderNameInput.value || '');
    const name = raw.trim();
    clearNewFolderError();
    if (!name.length) {
      showNewFolderError("Folder name can't be empty.");
      return;
    }

    // Load existing folders and check duplicates (case-insensitive)
    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders() : [];
    } catch (e) {
      folders = [];
    }
    const exists = folders.some((f) => String(f.name).toLowerCase() === name.toLowerCase());
    if (exists) {
      showNewFolderError('You already have a folder with this name.');
      return;
    }

    const folderId = `folder-${Date.now().toString(36)}`;
    const newFolder = { id: folderId, name };
    const updated = [...folders.filter(Boolean), newFolder];
    const saved = saveFolders(updated);
    if (!saved) {
      showNewFolderError('Unable to create folder. Please try again.');
      return null;
    }

    // Close modal and rebuild folder chips. Do NOT switch view or alter filters.
    try {
      newFolderModalController.requestClose('created');
    } catch { /* ignore */ }
    // Keep the current folder/filter state intact — do not auto-select the new folder
    try {
      buildFolderChips();
    } catch (e) {
      console.warn('[notebook] rebuild folder chips failed', e);
    }
    try {
      buildFolderFilterSelect();
    } catch (e) {
      console.warn('[notebook] rebuild folder filter failed', e);
    }
    if (typeof afterFolderCreated === 'function') {
      try {
        afterFolderCreated(folderId, name);
      } catch (err) {
        console.warn('[notebook] post-create handler failed', err);
      }
      afterFolderCreated = null;
    }
    return folderId;
  };

  if (newFolderCreateBtn) {
    newFolderCreateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      createNewFolder();
    });
  }

  if (newFolderNameInput) {
    newFolderNameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        createNewFolder();
      }
    });
  }

  if (newFolderCancelBtn) {
    newFolderCancelBtn.addEventListener('click', () => {
      afterFolderCreated = null;
    });
  }

  // wire folder button to open picker
  const noteFolderBtn =
    document.getElementById('note-folder-button') ||
    document.getElementById('noteFolderPillMobile');
  const syncNoteFolderButtonLabel = (folderId) => {
    if (!(noteFolderBtn instanceof HTMLElement)) {
      return;
    }
    noteFolderBtn.textContent = getFolderNameById(folderId || 'unsorted') || 'Unsorted';
  };
  if (noteFolderBtn) {
    noteFolderBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openFolderSelectorForNote(currentNoteId, {
        initialFolderId: currentEditingNoteFolderId,
        triggerEl: noteFolderBtn,
      });
    });
  }

  /* Folder overflow menu + rename/delete handling */
  let activeOverflowMenu = null;
  let activeOverflowTrigger = null;
  const closeOverflowMenu = () => {
    if (activeOverflowMenu && activeOverflowMenu.parentNode) {
      activeOverflowMenu.parentNode.removeChild(activeOverflowMenu);
    }
    const focusTarget =
      activeOverflowTrigger &&
      document.body.contains(activeOverflowTrigger) &&
      typeof activeOverflowTrigger.focus === 'function'
        ? activeOverflowTrigger
        : null;
    activeOverflowMenu = null;
    activeOverflowTrigger = null;
    document.removeEventListener('click', closeOverflowMenu);
    document.removeEventListener('keydown', handleOverflowKeydown);
    if (focusTarget) {
      try {
        focusTarget.focus();
      } catch {
        /* ignore focus restoration failures */
      }
    }
  };

  const handleOverflowKeydown = (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeOverflowMenu();
    }
    if (ev.key === 'Tab') {
      requestAnimationFrame(() => {
        if (activeOverflowMenu && !activeOverflowMenu.contains(document.activeElement)) {
          closeOverflowMenu();
        }
      });
    }
  };

  const handleMoveNoteToFolder = (noteId, targetFolderId) => {
    if (!noteId) return;
    const normalizedTarget = targetFolderId === 'unsorted' ? null : targetFolderId;
    const saved = assignNoteToFolder(noteId, normalizedTarget);
    if (!saved) {
      return;
    }
    try {
      refreshFromStorage({ preserveDraft: true });
    } catch (e) {
      console.warn('[notebook] failed to refresh notes after move', e);
    }
    try {
      buildFolderChips();
    } catch (e) {
      console.warn('[notebook] failed to refresh folder chips after move', e);
    }
    try {
      const targetName = getFolderNameById(normalizedTarget || 'unsorted') || 'Unsorted';
      showMoveToast(targetName);
    } catch {
      /* no-op */
    }
    if (noteId === currentNoteId) {
      currentEditingNoteFolderId = normalizedTarget || 'unsorted';
      const labelEl = document.getElementById('note-folder-label');
      if (labelEl) {
        labelEl.textContent = getFolderNameById(currentEditingNoteFolderId);
      }
    }
    closeOverflowMenu();
  };




  // Reorder folders by swapping `order` with neighbor and normalizing
  const reorderFolder = (folderId, direction) => {
    if (!folderId || (direction !== -1 && direction !== 1)) return;
    let folders = [];
    try {
      folders = Array.isArray(getFolders()) ? getFolders().slice() : [];
    } catch (e) {
      folders = [];
    }
    if (!folders.length) return;

    // Only reorder user folders (exclude 'unsorted')
    const userFolders = folders.filter((f) => f && f.id !== 'unsorted');
    // Sort by order asc
    userFolders.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    const idx = userFolders.findIndex((f) => String(f.id) === String(folderId));
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= userFolders.length) return;

    // swap orders
    const tmp = userFolders[idx].order;
    userFolders[idx].order = userFolders[targetIdx].order;
    userFolders[targetIdx].order = tmp;

    // rebuild full folders array preserving unsorted and applying new orders
    const unsorted = folders.find((f) => f && f.id === 'unsorted') || { id: 'unsorted', name: 'Unsorted', order: -1 };
    const rebuilt = [unsorted, ...userFolders];

    // normalize orders to 0..N-1 (keep unsorted as  -1 or 0? We'll place unsorted first with order 0)
    const normalized = rebuilt.map((f, i) => ({ id: f.id, name: f.name, order: i }));

    try {
      const saved = saveFolders(normalized);
      if (saved) {
        try { buildFolderChips(); } catch {}
        try { renderFilteredNotes(); } catch {}
      }
    } catch (e) {
      console.warn('[notebook] reorder save failed', e);
    }
  };

  const openFolderOverflowMenu = (folderId, anchorEl) => {
    if (!folderId || folderId === 'all' || folderId === 'unsorted') return;
    closeOverflowMenu();
    const menu = document.createElement('div');
    menu.className = 'memory-glass-card p-2 rounded shadow-lg';
    menu.style.position = 'absolute';
    menu.style.zIndex = 1200;
    menu.style.minWidth = '160px';

    // Determine position to optionally disable move controls
    let _isFirst = false;
    let _isLast = false;
    try {
      const _folders = Array.isArray(getFolders()) ? getFolders().filter(Boolean) : [];
      const _user = _folders.filter((f) => f && f.id !== 'unsorted').sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const _idx = _user.findIndex((f) => String(f.id) === String(folderId));
      _isFirst = _idx === 0;
      _isLast = _idx === -1 ? true : _idx === _user.length - 1;
    } catch (e) {
      _isFirst = false;
      _isLast = false;
    }

    // Move up / Move down controls
    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    moveUpBtn.textContent = 'Move up';
    if (_isFirst) {
      moveUpBtn.setAttribute('disabled', '');
      moveUpBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    moveUpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        reorderFolder(folderId, -1);
      } catch (err) {
        console.warn('[notebook] reorder move up failed', err);
      }
      closeOverflowMenu();
    });

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    moveDownBtn.textContent = 'Move down';
    if (_isLast) {
      moveDownBtn.setAttribute('disabled', '');
      moveDownBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    moveDownBtn.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        reorderFolder(folderId, 1);
      } catch (err) {
        console.warn('[notebook] reorder move down failed', err);
      }
      closeOverflowMenu();
    });

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'w-full text-left px-3 py-2 btn-ghost';
    renameBtn.textContent = 'Rename folder';
    renameBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openRenameDialog(folderId);
      closeOverflowMenu();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'w-full text-left px-3 py-2 btn-ghost text-accent';
    deleteBtn.textContent = 'Delete folder';
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openDeleteConfirm(folderId);
      closeOverflowMenu();
    });

    menu.appendChild(moveUpBtn);
    menu.appendChild(moveDownBtn);
    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);

    document.body.appendChild(menu);
    activeOverflowMenu = menu;
    activeOverflowTrigger = anchorEl instanceof HTMLElement ? anchorEl : null;

    // position menu under anchor
    try {
      const rect = anchorEl.getBoundingClientRect();
      const top = rect.bottom + window.scrollY + 6;
      const left = rect.left + window.scrollX;
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    } catch (e) {
      // fallback: center
      menu.style.top = '50%';
      menu.style.left = '50%';
      menu.style.transform = 'translate(-50%, -50%)';
    }

    // close handlers
    document.addEventListener('click', closeOverflowMenu);
    document.addEventListener('keydown', handleOverflowKeydown);
  };

  /* Rename folder modal wiring */
  const renameFolderModalEl = document.getElementById('renameFolderModal');
  const renameFolderNameInput = document.getElementById('renameFolderName');
  const renameFolderError = document.getElementById('renameFolderError');
  const renameFolderSaveBtn = document.getElementById('renameFolderSave');
  const renameFolderCancelBtn = document.getElementById('renameFolderCancel');
  let renameFolderController = null;
  let pendingRenameFolderId = null;

  const clearRenameError = () => {
    if (!renameFolderError) return;
    renameFolderError.classList.add('sr-only');
    renameFolderError.textContent = '';
  };
  const showRenameError = (msg) => {
    if (!renameFolderError) return;
    renameFolderError.textContent = msg;
    renameFolderError.classList.remove('sr-only');
  };

  const openRenameDialog = (folderId) => {
    if (!renameFolderModalEl || folderId === 'all' || folderId === 'unsorted') return;
    pendingRenameFolderId = folderId;
    const folders = Array.isArray(getFolders()) ? getFolders() : [];
    const found = folders.find((f) => f && String(f.id) === String(folderId));
    if (!found) return;
    if (!renameFolderController) {
      renameFolderController = new ModalController({
        modalElement: renameFolderModalEl,
        closeButton: renameFolderCancelBtn,
        titleInput: renameFolderNameInput,
        modalTitle: document.getElementById('renameFolderTitle'),
        autoFocus: true,
      });
    }
    clearRenameError();
    if (renameFolderNameInput) renameFolderNameInput.value = found.name || '';
    renameFolderController.show();
  };

  const saveRename = () => {
    if (!pendingRenameFolderId || !renameFolderNameInput) return;
    const raw = String(renameFolderNameInput.value || '');
    const name = raw.trim();
    clearRenameError();
    if (!name.length) {
      showRenameError("Folder name can't be empty.");
      return;
    }
    let folders = [];
    try { folders = Array.isArray(getFolders()) ? getFolders() : []; } catch { folders = []; }
    const duplicate = folders.some((f) => String(f.name).toLowerCase() === name.toLowerCase() && String(f.id) !== String(pendingRenameFolderId));
    if (duplicate) {
      showRenameError('You already have a folder with this name.');
      return;
    }
    const updated = folders.map((f) => (String(f.id) === String(pendingRenameFolderId) ? { ...f, name } : f));
    const saved = saveFolders(updated);
    if (!saved) {
      showRenameError('Unable to rename folder. Please try again.');
      return;
    }
    try { renameFolderController.requestClose('saved'); } catch {}
    pendingRenameFolderId = null;
    // refresh UI
    try { buildFolderChips(); } catch {}
    renderFilteredNotes();
  };

  if (renameFolderSaveBtn) {
    renameFolderSaveBtn.addEventListener('click', (e) => { e.preventDefault(); saveRename(); });
  }
  if (renameFolderNameInput) {
    renameFolderNameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveRename(); } });
  }

  /* Delete folder flow */
  const deleteFolderModalEl = document.getElementById('deleteFolderModal');
  const deleteFolderConfirmBtn = document.getElementById('deleteFolderConfirm');
  const deleteFolderCancelBtn = document.getElementById('deleteFolderCancel');
  let deleteFolderController = null;
  let pendingDeleteFolderId = null;

  const openDeleteConfirm = (folderId) => {
    if (!deleteFolderModalEl || folderId === 'all' || folderId === 'unsorted') return;
    pendingDeleteFolderId = folderId;
    if (!deleteFolderController) {
      deleteFolderController = new ModalController({
        modalElement: deleteFolderModalEl,
        closeButton: deleteFolderCancelBtn,
        titleInput: null,
        modalTitle: document.getElementById('deleteFolderTitle'),
        autoFocus: false,
      });
    }
    deleteFolderController.show();
  };

  const confirmDeleteFolder = () => {
    if (!pendingDeleteFolderId) return;
    // Remove folder and reassign notes
    let folders = [];
    try { folders = Array.isArray(getFolders()) ? getFolders() : []; } catch { folders = []; }
    const updatedFolders = folders.filter((f) => String(f.id) !== String(pendingDeleteFolderId));
    // Ensure unsorted exists
    if (!updatedFolders.some((f) => f && f.id === 'unsorted')) {
      updatedFolders.unshift({ id: 'unsorted', name: 'Unsorted' });
    }
    const saved = saveFolders(updatedFolders);
    if (!saved) {
      try { deleteFolderController.requestClose('failed'); } catch {}
      pendingDeleteFolderId = null;
      return;
    }
    // Reassign notes
    const notes = loadAllNotes();
    const updatedNotes = (Array.isArray(notes) ? notes : []).map((n) => {
      if (n && String(n.folderId) === String(pendingDeleteFolderId)) {
        return { ...n, folderId: 'unsorted', updatedAt: new Date().toISOString() };
      }
      return n;
    });
    saveAllNotes(updatedNotes);
    // If current filter was the deleted folder, switch to unsorted
    if (String(currentFolderId) === String(pendingDeleteFolderId)) {
      currentFolderId = 'unsorted';
      clearSearchFilter();
    }
    pendingDeleteFolderId = null;
    try { deleteFolderController.requestClose('deleted'); } catch {}
    buildFolderChips();
    renderFilteredNotes();
  };

  if (deleteFolderConfirmBtn) {
    deleteFolderConfirmBtn.addEventListener('click', (e) => { e.preventDefault(); confirmDeleteFolder(); });
  }

  if (listElement) {
    listElement.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const menuTrigger = target.closest('.note-options-button, button[data-role="note-menu"]');
      if (menuTrigger && listElement.contains(menuTrigger)) {
        event.preventDefault();
        event.stopPropagation();
        const noteId =
          menuTrigger.getAttribute('data-note-id')
          || (menuTrigger.closest('[data-note-id]') || menuTrigger).getAttribute('data-note-id');
        if (!noteId) {
          return;
        }
        openNoteOptionsMenu(noteId);
        return;
      }

      const openTrigger = target.closest('[data-role="open-note"]');
      if (openTrigger && listElement.contains(openTrigger)) {
        event.preventDefault();
        const noteId = openTrigger.getAttribute('data-note-id');
        if (!noteId) {
          return;
        }
        const note = allNotes.find((item) => item.id === noteId);
        if (note) {
          setEditorValues(note);
          updateListSelection();
          if (isSavedNotesSheetOpen()) {
            hideSavedNotesSheet();
          }
        }
      }
    });

    // Touch devices: ensure the overflow menu opens reliably on touch.
    listElement.addEventListener('pointerup', (event) => {
      // Only handle touch pointers here to avoid duplicate activation with mouse clicks
      if (!(event instanceof PointerEvent) || event.pointerType !== 'touch') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      const menuTrigger = target.closest('.note-options-button, button[data-role="note-menu"]');
      if (menuTrigger && listElement.contains(menuTrigger)) {
        event.preventDefault();
        event.stopPropagation();
        const noteId =
          menuTrigger.getAttribute('data-note-id')
          || (menuTrigger.closest('[data-note-id]') || menuTrigger).getAttribute('data-note-id');
        if (!noteId) return;
        openNoteOptionsMenu(noteId);
        return;
      }
    });
  }

  const renderFilteredNotes = () => {
    renderNotesList(getVisibleNotes());
  };

  const mobileNotesShellUi = initMobileNotesShellUi({
    noteEditorSheet,
    notesOverviewPanel,
    savedNotesSheet,
    openSavedNotesButton,
    closeSavedNotesButton,
    folderSelectorEl,
    folderSelectorListEl,
    folderSelectorBackdrop,
    noteFolderSheet,
    noteFolderSheetBackdrop,
    noteFolderSheetList,
    noteFolderSheetClose,
    noteFolderButton: noteFolderBtn,
    noteOptionsOverlay: document.getElementById('note-options-overlay'),
    noteOptionsSheet: document.getElementById('note-options-sheet'),
    noteActionMoveBtn: document.getElementById('note-options-sheet')?.querySelector('.note-action-move'),
    noteActionTogglePinBtn: document.getElementById('note-options-sheet')?.querySelector('.note-action-toggle-pin'),
    noteActionDeleteBtn: document.getElementById('note-options-sheet')?.querySelector('.note-action-delete'),
    getAllNotes: () => allNotes,
    renderFilteredNotes: () => renderFilteredNotes(),
    getCurrentEditingNoteFolderId: () => currentEditingNoteFolderId,
    setCurrentEditingNoteFolderId: (value) => {
      currentEditingNoteFolderId = value;
      syncNoteFolderButtonLabel(currentEditingNoteFolderId);
    },
    getCurrentNoteId: () => currentNoteId,
    getCurrentFolderMoveNoteId: () => currentFolderMoveNoteId,
    setCurrentFolderMoveNoteId: (value) => { currentFolderMoveNoteId = value; },
    getCurrentMoveFolderSheetNoteId: () => currentMoveFolderSheetNoteId,
    setCurrentMoveFolderSheetNoteId: (value) => { currentMoveFolderSheetNoteId = value; },
    getFolderSelectorOnSelect: () => folderSelectorOnSelect,
    setFolderSelectorOnSelect: (value) => { folderSelectorOnSelect = value; },
    getActiveFolderSheetOpener: () => activeFolderSheetOpener,
    setActiveFolderSheetOpener: (value) => { activeFolderSheetOpener = value; },
    setAfterFolderCreated: (value) => { afterFolderCreated = value; },
    getFolderOptions: () => {
      try {
        return Array.isArray(getFolders()) ? getFolders() : [];
      } catch {
        return [];
      }
    },
    getFolderNameById,
    handleMoveNoteToFolder,
    openNewFolderDialog,
    closeOverflowMenu,
    handleDeleteNote,
    refreshFromStorage,
    saveAllNotes,
    onOpenNoteOptionsMove: (noteId, note, triggerEl) => {
      openFolderSelectorForNote(noteId, {
        initialFolderId:
          note && note.folderId && typeof note.folderId === 'string'
            ? note.folderId
            : 'unsorted',
        triggerEl,
      });
    },
    onOpenNoteFromDashboard: (noteId) => {
      openNoteFromDashboard(noteId);
    },
  });

  ({
    applyNotesMode,
    isSavedNotesSheetOpen,
    showSavedNotesSheet,
    hideSavedNotesSheet,
    openNoteOptionsMenu,
    openFolderSelectorForNote,
    closeMoveFolderSheet,
    closeNoteFolderSheet,
  } = mobileNotesShellUi);

  const savedNotesGlobalButton = document.getElementById('openSavedNotesGlobal');
  if (savedNotesGlobalButton) {
    savedNotesGlobalButton.addEventListener('click', (event) => {
      event.preventDefault();
      showSavedNotesSheet();
    });
  }

  if (filterInput) {
    const handleFilterInput = debounce(() => {
      filterQuery = typeof filterInput.value === 'string' ? filterInput.value.trim() : '';
      renderFilteredNotes();
    }, 200);

    filterInput.addEventListener('input', handleFilterInput);
    filterInput.addEventListener('search', handleFilterInput);
  }

  if (notesOverviewSearch instanceof HTMLElement) {
    notesOverviewSearch.addEventListener('input', () => {
      notesOverviewQuery = typeof notesOverviewSearch.value === 'string' ? notesOverviewSearch.value.trim() : '';
      renderNotesOverview();
    });
  }

  if (notesOverviewSort instanceof HTMLSelectElement) {
    notesOverviewSort.addEventListener('change', () => {
      notesOverviewSortValue = notesOverviewSort.value || 'recent';
      renderNotesOverview();
    });
  }

  if (notesOverviewState instanceof HTMLSelectElement) {
    notesOverviewState.addEventListener('change', () => {
      notesOverviewStateValue = notesOverviewState.value || 'all';
      renderNotesOverview();
    });
  }

  if (notebookBrowserList instanceof HTMLElement) {
    notebookBrowserList.addEventListener('click', (event) => {
      const trigger = event.target instanceof HTMLElement ? event.target.closest('[data-notebook-folder]') : null;
      if (!(trigger instanceof HTMLElement)) {
        return;
      }
      const requestedName = String(trigger.dataset.notebookFolder || '').trim();
      if (!requestedName) {
        return;
      }

      const allFolderOptions = Array.isArray(getFolders()) ? getFolders() : [];
      const normalizedName = requestedName.toLowerCase();
      const folderMatch = allFolderOptions.find((folder) => {
        const folderName = typeof folder?.name === 'string' ? folder.name.trim().toLowerCase() : '';
        return folderName === normalizedName;
      });

      currentFolderId = folderMatch?.id || (normalizedName === 'unsorted' ? 'unsorted' : 'all');
      setActiveFolderFilter(currentFolderId);
      setActiveFolderChip(currentFolderId);
      renderFilteredNotes();
    });
  }

  window.addEventListener('memorycue:notes:mode', (event) => {
    applyNotesMode(event?.detail?.mode);
    if (notesMode === 'overview') {
      renderNotesOverview();
    }
  });

  if (folderFilterSelect) {
    folderFilterSelect.addEventListener('change', (event) => {
      const target = event?.target;
      if (!(target instanceof HTMLSelectElement)) {
        return;
      }
      const selectedFolderId = normalizeFolderId(target.value, { fallback: 'all' });
      currentFolderId = selectedFolderId || 'all';
      renderFilteredNotes();
    });
  }

  const applyInitialSelection = () => {
    refreshFromStorage({ preserveDraft: false });
  };

  const openNoteEditorForNewNote = (note) => {
    if (!note) return;
    currentEditingNoteFolderId =
      note.folderId && typeof note.folderId === 'string' ? note.folderId : 'everyday';
    syncNoteFolderButtonLabel(currentEditingNoteFolderId);
    resetEditorScroll();
    setEditorValues(note, { isNew: true });
    updateListSelection();
  };

  const startNewNoteFromUI = () => {
    const timestamp = new Date().toISOString();
    const activeFolderId = currentFolderId && currentFolderId !== 'all' ? currentFolderId : 'everyday';
    const draftNote = createNote('', '', { folderId: activeFolderId, updatedAt: timestamp });
    const newNote = {
      ...draftNote,
      title: '',
      body: '',
      bodyHtml: '',
      bodyText: '',
      updatedAt: timestamp,
      folderId: activeFolderId,
    };
    openNoteEditorForNewNote(newNote);
  };

  saveButton.addEventListener('click', () => {
    if (currentNoteIsNew && !currentNoteHasChanged && !hasMeaningfulContent()) {
      return;
    }
    const existingNotes = loadAllNotes();
    const notesArray = Array.isArray(existingNotes) ? [...existingNotes] : [];
    const noteBodyHtml = getEditorBodyHtml() || '';
    const noteBodyText = getEditorBodyText(noteBodyHtml);
    const rawTitle = typeof titleInput.value === 'string' ? titleInput.value.trim() : '';
    const sanitizedTitle = rawTitle || 'Untitled note';
    const timestamp = new Date().toISOString();
    const normalizedFolderId =
      currentEditingNoteFolderId && currentEditingNoteFolderId !== 'all'
        ? currentEditingNoteFolderId
        : 'everyday';

    if (currentNoteId) {
      const noteIndex = notesArray.findIndex((note) => note.id === currentNoteId);
      if (noteIndex >= 0) {
        notesArray[noteIndex] = {
          ...notesArray[noteIndex],
          title: sanitizedTitle,
          body: noteBodyHtml,
          bodyHtml: noteBodyHtml,
          bodyText: noteBodyText,
          updatedAt: timestamp,
          folderId: normalizedFolderId,
        };
      } else {
        const newNote = createNote(sanitizedTitle, noteBodyHtml, {
          updatedAt: timestamp,
          folderId: normalizedFolderId,
          bodyText: noteBodyText,
        });
        currentNoteId = newNote.id;
        notesArray.unshift(newNote);
      }
    } else {
      const newNote = createNote(sanitizedTitle, noteBodyHtml, {
        folderId: normalizedFolderId,
        bodyText: noteBodyText,
      });
      currentNoteId = newNote.id;
      notesArray.unshift(newNote);
    }

    saveAllNotes(notesArray);
    updateStoredSnapshot();
    currentNoteIsNew = false;
    currentNoteHasChanged = false;
    refreshFromStorage({ preserveDraft: false });
  });

  // Also wire the footer 'New note' floating button to the same behavior
  const footerNewNoteBtn = document.getElementById('mobile-footer-new-note');
  if (footerNewNoteBtn) {
    footerNewNoteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // switch navigation/view if needed
      try {
        // If app uses data-nav-target, attempt to activate the notebook/add-note view
        const target = footerNewNoteBtn.getAttribute('data-nav-target');
        if (target) {
          const navBtns = document.querySelectorAll('[data-nav-target]');
          navBtns.forEach((b) => b.classList.remove('active'));
          footerNewNoteBtn.classList.add('active');
        }
      } catch (err) {
        /* ignore nav activation errors */
      }
      startNewNoteFromUI();
    });
  }

  const newNoteButton = document.getElementById('newNoteMobile');
  if (newNoteButton) {
    newNoteButton.addEventListener('click', (e) => {
      e.preventDefault();
      startNewNoteFromUI();
    });
  }

  const fabNewNoteButton = document.getElementById('mobile-fab-new-note');
  if (fabNewNoteButton) {
    fabNewNoteButton.addEventListener('click', () => {
      // inline script handles navigation; we trigger the editor reset
      startNewNoteFromUI();
    });
  }

  // Autosave: debounce saving when user edits title or body
  const AUTOSAVE_DELAY = 1500; // ms
  const debouncedAutoSave = debounce(() => {
    try {
      if (currentNoteIsNew && !currentNoteHasChanged) {
        return;
      }
      if (!hasUnsavedChanges()) return;
      if (saveButton instanceof HTMLElement && !saveButton.matches(':disabled')) {
        saveButton.click();
      }
    } catch (e) {
      /* ignore autosave errors */
    }
  }, AUTOSAVE_DELAY);

  const handleNoteEditorInput = () => {
    if (currentNoteIsNew) {
      if (!hasMeaningfulContent()) {
        currentNoteHasChanged = false;
        return;
      }
      currentNoteHasChanged = true;
    } else {
      currentNoteHasChanged = true;
    }
    debouncedAutoSave();
  };

  // Listen for input changes on title and editor
  try {
    titleInput.addEventListener('input', handleNoteEditorInput);
  } catch (e) {
    /* ignore */
  }

  try {
    // contenteditable should emit input events
    scratchNotesEditorElement.addEventListener('input', debouncedAutoSave);
    scratchNotesEditorElement.addEventListener('input', updateToolbarState);
    scratchNotesEditorElement.addEventListener('keyup', updateToolbarState);
    scratchNotesEditorElement.addEventListener('mouseup', updateToolbarState);
    scratchNotesEditorElement.addEventListener('keydown', handleListShortcuts);
    scratchNotesEditorElement.addEventListener('keydown', handleFormattingShortcuts);
    // also save on blur (user leaving editor)
    scratchNotesEditorElement.addEventListener('blur', () => {
      // flush any pending autosave immediately
      debouncedAutoSave();
    });
    titleInput.addEventListener('blur', () => debouncedAutoSave());
  } catch (e) {
    /* ignore */
  }

  // Save when the page is about to unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (evt) => {
      try {
        if (hasUnsavedChanges() && saveButton instanceof HTMLElement && !saveButton.matches(':disabled')) {
          // attempt to synchronously save by invoking click
          saveButton.click();
        }
      } catch (e) {
        /* ignore */
      }
    });
  }

  updateToolbarState();
  applyInitialSelection();
  buildFolderFilterSelect();
  renderDashboardPanel();

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === NOTES_STORAGE_KEY) {
        lastSerializedNotes = event.newValue ?? null;
        refreshFromStorage({ preserveDraft: true });
      }
    });

    document.addEventListener('memoryCue:notesUpdated', () => {
      try {
        lastSerializedNotes = readStoredSnapshot();
        refreshFromStorage({ preserveDraft: true });
      } catch (error) {
        console.error('Failed to refresh notes after smart capture update', error);
      }
    });

    if (!window.__memoryCueNotesWatcher) {
      window.__memoryCueNotesWatcher = window.setInterval(() => {
        const snapshot = readStoredSnapshot();
        if (snapshot !== lastSerializedNotes) {
          lastSerializedNotes = snapshot;
          refreshFromStorage({ preserveDraft: true });
        }
      }, 2000);
    }
  }

  try {
    refreshFromStorage({ preserveDraft: true });
  } catch (error) {
    console.warn('[notebook] initial refreshFromStorage failed', error);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileNotes, { once: true });
} else {
  initMobileNotes();
}

async function wireMobileNotesFirebaseAuth() {
  let stopInboxLiveSync = null;
  let stopChatLiveSync = null;

  const debugLog = (...args) => {
    if (isNotesSyncDebugEnabled) {
      try {
        console.debug(...args);
      } catch {
        /* ignore debug logging issues */
      }
    }
  };

  // 1. Initialise the notes sync controller for mobile
  const notesSync = initNotesSync?.({
    debugLogger: isNotesSyncDebugEnabled ? debugLog : null,
    onRemotePull: ({ mergedCount, remoteCount } = {}) => {
      try {
        mobileNotesSyncDidPullFromRemote();
      } catch {
        // ignore UI refresh errors
      }
      debugLog('[notes-sync] Mobile remote pull complete', { mergedCount, remoteCount });
    },
  });
  if (!notesSync) {
    console.warn('[notes-sync] initNotesSync() did not return a controller; notes will remain local-only.');
  } else if (typeof notesSync.syncFromRemote === 'function') {
    // Wrap syncFromRemote so the UI is notified when fresh data arrives
    const originalSyncFromRemote = notesSync.syncFromRemote.bind(notesSync);
    notesSync.syncFromRemote = async (...args) => {
      const result = await originalSyncFromRemote(...args);
      try {
        mobileNotesSyncDidPullFromRemote();
      } catch {
        // ignore UI refresh errors
      }
      return result;
    };
  }

  const stopRealtimeCollections = () => {
    if (typeof stopInboxLiveSync === 'function') {
      try {
        stopInboxLiveSync();
      } catch {
        /* ignore unsubscribe issues */
      }
    }
    if (typeof stopChatLiveSync === 'function') {
      try {
        stopChatLiveSync();
      } catch {
        /* ignore unsubscribe issues */
      }
    }
    stopInboxLiveSync = null;
    stopChatLiveSync = null;
  };

  const startRealtimeCollections = async (uid) => {
    stopRealtimeCollections();

    if (typeof uid !== 'string' || !uid.trim()) {
      return;
    }

    stopInboxLiveSync = await subscribeToInboxChanges({ uid });
    stopChatLiveSync = await subscribeToChatHistoryChanges({ uid });
  };

  // 2. Initialise auth, binding to mobile sign-in / sign-out buttons
  if (typeof initAuth !== 'function') {
    return;
  }

  const authController = await initAuth({
    selectors: {
      // Main sign-in button in the UI, if present
      signInButtons: ['#googleSignInBtn', '#googleSignInBtnMenu'],
      signOutButtons: ['#googleSignOutBtn', '#googleSignOutBtnMenu'],
      // The rest are optional; only wire if these elements exist in the DOM
      userBadge: '#user-badge',
      userBadgeEmail: '#user-badge-email',
      userBadgeInitial: '#user-badge-initial',
      userName: '#googleUserName',
      syncStatus: ['#notesSyncStatus'],
      feedback: ['#notesSyncMessage'],
    },
    disableButtonBinding: false,
    async onSessionChange(user, session) {
      const normalizedUser = user && typeof user.id === 'string' ? user : null;
      debugLog('[notes-sync] Mobile session change', { userId: normalizedUser?.id || null });
      if (notesSync && typeof notesSync.handleSessionChange === 'function') {
        await notesSync.handleSessionChange(normalizedUser, session ?? null);
      }

      if (normalizedUser?.id) {
        await startRealtimeCollections(normalizedUser.id);
      } else {
        stopRealtimeCollections();
      }
    },
  });

  if (!notesSync) {
    return;
  }

  // 3. Prime notes sync with the current Firebase session (if there is one)
  if (typeof window !== 'undefined' && typeof notesSync.handleSessionChange === 'function') {
    const initialUserId = typeof window.__MEMORY_CUE_AUTH_USER_ID === 'string' ? window.__MEMORY_CUE_AUTH_USER_ID.trim() : '';
    if (initialUserId) {
      const normalizedUser = { id: initialUserId, uid: initialUserId, email: '' };
      debugLog('[notes-sync] Mobile initial session', { userId: normalizedUser.id || null });
      notesSync.handleSessionChange(normalizedUser, { user: normalizedUser });
      startRealtimeCollections(normalizedUser.id).catch((error) => {
        console.warn('[sync] Failed to start realtime inbox/chat sync.', error);
      });
    }
  }

  const requestRemoteSync = () => {
    if (typeof notesSync.syncFromRemote === 'function') {
      notesSync
        .syncFromRemote()
        .catch(() => {
          /* best-effort */
        });
    }
  };

  const bindRemoteSyncListeners = () => {
    if (bindRemoteSyncListeners.bound) {
      return;
    }
    bindRemoteSyncListeners.bound = true;
    window.addEventListener('online', requestRemoteSync);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          requestRemoteSync();
        }
      });
    }
  };

  bindRemoteSyncListeners();
}

// DEBUG: global listener to detect clicks on the Save Reminder button
document.addEventListener('click', (ev) => {
  try {
    const target = ev.target;
    if (!target) return;
    // If the actual element clicked is the save button or inside it
    if ((target instanceof HTMLElement && target.id === 'saveReminder') || (target instanceof Element && target.closest && target.closest('#saveReminder'))) {
      // Log and add a temporary visual indicator
      console.log('Global click detected on #saveReminder', { target });
      try {
        const flash = document.createElement('div');
        flash.textContent = 'Save clicked';
        flash.style.position = 'fixed';
        flash.style.right = '16px';
        flash.style.bottom = '16px';
        flash.style.background = 'rgba(34,197,94,0.95)';
        flash.style.color = '#fff';
        flash.style.padding = '8px 12px';
        flash.style.borderRadius = '8px';
        flash.style.zIndex = '99999';
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 900);
      } catch (e) {}
    }
  } catch (e) {}
});

/* BEGIN GPT CHANGE: progressive list loading */
(function () {
  const list = document.getElementById('reminderList');
  if (!list) return;

  const all = Array.from(list.children);
  if (all.length <= 30) return;
  const PAGE_SIZE = 20;
  list.innerHTML = '';
  let index = 0;

  function appendPage() {
    const slice = all.slice(index, index + PAGE_SIZE);
    slice.forEach((node) => list.appendChild(node));
    index += slice.length;
  }

  appendPage();
  const sentinel = document.createElement('div');
  sentinel.id = 'listSentinel';
  list.appendChild(sentinel);

  const io = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && index < all.length) {
      appendPage();
      if (index >= all.length) io.disconnect();
    }
  });
  io.observe(sentinel);
})();
/* END GPT CHANGE */

