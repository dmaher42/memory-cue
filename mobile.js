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
import { saveFolders } from './js/modules/notes-storage.js';
import { buildDashboard } from './js/modules/dashboard-data.js';
import { generateWeeklySummary } from './js/modules/weekly-summary.js';
import { getRecallItems } from './js/services/recall-service.js';
import {
  getInboxEntries,
  saveInboxEntry,
  updateMemoryCoachInboxEntry,
} from './js/services/capture-service.js?v=20260323a';
import { executeCommand } from './src/core/commandEngine.js';
import { ENABLE_CHAT_INTERFACE, handleChatMessage } from './src/chat/chatManager.js';
import { clearMessages, getMessages, updateMessage } from './src/chat/messageStore.js';
import { deleteNote, subscribeToInboxChanges, subscribeToChatHistoryChanges } from './src/services/firestoreSyncService.js';
import { createChatComposer } from './src/components/ChatComposer.js';
import { initMobileShellUi } from './src/ui/mobileShellUi.js';
import { initMobileSyncControls } from './src/ui/mobileSyncControls.js';
import { initMobileNotesShellUi } from './src/ui/mobileNotesShellUi.js';
import { initMobileNotesFolderManager } from './src/ui/mobileNotesFolderManager.js';
import { initMobileNotesBrowserUi } from './src/ui/mobileNotesBrowserUi.js';
import { initMobileNotesEditorUi } from './src/ui/mobileNotesEditorUi.js';
import { createMemoryCoachUi } from './src/ui/mobileMemoryCoachUi.js';

let reminderControllerApi = null;

const removeSavedNoteById = async (noteId) => {
  const normalizedId = typeof noteId === 'string' ? noteId.trim() : '';
  if (!normalizedId) {
    return false;
  }

  const existingNotes = loadAllNotes();
  if (!Array.isArray(existingNotes) || !existingNotes.some((note) => note?.id === normalizedId)) {
    return false;
  }

  const saved = saveAllNotes(existingNotes.filter((note) => note?.id !== normalizedId));
  if (!saved) {
    return false;
  }

  try {
    await deleteNote(normalizedId);
  } catch (error) {
    console.warn('[notes-sync] Failed to delete note from Firebase.', error);
  }
  return true;
};

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
    const thinkingBarContainer = document.getElementById('thinkingBarContainer');
    const thinkingBarInput = document.getElementById('thinkingBarInput');
    const thinkingBarForm = document.getElementById('thinkingBarForm');
    const thinkingBarSubmit = document.getElementById('thinkingBarSubmit');
    const thinkingBarVoiceButton = document.getElementById('thinkingBarVoiceButton');
    const thinkingBarStatus = document.getElementById('thinkingBarStatus');
    const thinkingBarLabel = document.querySelector('label[for="thinkingBarInput"]');
    const memoryCoachLauncher = document.getElementById('memoryCoachLauncher');
    const memoryCoachModeBar = document.getElementById('memoryCoachModeBar');
    const memoryCoachModeLabel = document.getElementById('memoryCoachModeLabel');
    const memoryCoachExitButton = document.getElementById('memoryCoachExitButton');
    const wordRescueLauncher = document.getElementById('wordRescueLauncher');
    const wordRescueModeBar = document.getElementById('wordRescueModeBar');
    const wordRescueModeLabel = document.getElementById('wordRescueModeLabel');
    const wordRescueExitButton = document.getElementById('wordRescueExitButton');
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
    let isWordRescueChoiceOpen = false;
    let activeWordRescueMode = '';
    let activeWordRescueSession = null;
    let memoryCoachUi = null;
    let wordRescueRequestGeneration = 0;
    const MAX_VISIBLE_CAPTURE_MESSAGES = 12;
    const CAPTURE_UNDO_WINDOW_MS = 10000;
    const DEFAULT_THINKING_BAR_PLACEHOLDER = thinkingBarInput?.getAttribute('placeholder')
      || 'Add a reminder, note, or ask…';
    const DEFAULT_THINKING_BAR_LABEL = thinkingBarLabel?.textContent
      || 'Add a reminder, note, or ask anything';
    if (!isTextEntryElement(thinkingBarInput)) {
      return;
    }

    const splitRelatedMemoryText = (content) => {
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text) {
        return { mainText: '', relatedItems: [] };
      }

      const [mainText, relatedBlock = ''] = text.split(/\n\s*\nRelated from your memory:\s*/i);
      const relatedItems = relatedBlock
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(?:[-*]|\u2022|\u2022)\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3);

      return {
        mainText: mainText.trim(),
        relatedItems,
      };
    };

    const normalizeRelatedMemoryItems = (textItems = [], relatedMemories = []) => {
      const structuredItems = Array.isArray(relatedMemories)
        ? relatedMemories
          .map((memory) => {
            const noteId = typeof memory?.noteId === 'string' ? memory.noteId.trim() : '';
            const label = typeof memory?.label === 'string' ? memory.label.trim() : '';
            const score = Number(memory?.score);
            return noteId && label && Number.isFinite(score) && score >= 2
              ? { noteId, label, score }
              : null;
          })
          .filter(Boolean)
          .slice(0, 3)
        : [];

      return structuredItems;
    };

    const toValidDate = (value) => {
      if (value == null || value === '') {
        return null;
      }

      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const formatClockTime = (date) => date
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s+/g, ' ')
      .replace(/\b(?:am|pm)\b/gi, (period) => period.toLowerCase());

    const formatReminderSchedule = (value) => {
      if (typeof value === 'string') {
        const naturalSchedule = value.trim().match(/^(today|tomorrow)(?:\s+at\s+(.+))?$/i);
        if (naturalSchedule) {
          const day = naturalSchedule[1].charAt(0).toUpperCase() + naturalSchedule[1].slice(1).toLowerCase();
          const time = naturalSchedule[2]
            ? naturalSchedule[2].trim().replace(/\b(?:am|pm)\b/gi, (period) => period.toLowerCase())
            : '';
          return time ? `${day}, ${time}` : day;
        }
      }

      const date = toValidDate(value);
      if (!date) {
        return '';
      }

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const startOfTomorrow = new Date(startOfToday.getTime());
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
      const time = formatClockTime(date);

      if (startOfTarget.getTime() === startOfToday.getTime()) {
        return `Today, ${time}`;
      }
      if (startOfTarget.getTime() === startOfTomorrow.getTime()) {
        return `Tomorrow, ${time}`;
      }

      const dateLabel = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      return `${dateLabel}, ${time}`;
    };

    const formatCaptureResultTimestamp = (value) => {
      const date = toValidDate(value);
      if (!date) {
        return '';
      }

      const elapsedMs = Math.max(0, Date.now() - date.getTime());
      if (elapsedMs < 60000) {
        return 'Just now';
      }
      if (elapsedMs < 3600000) {
        const minutes = Math.max(1, Math.floor(elapsedMs / 60000));
        return `${minutes} min ago`;
      }

      const now = new Date();
      if (
        date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
      ) {
        return `Today, ${formatClockTime(date)}`;
      }

      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const findMatchingCaptureReminder = (messageTimestamp, reminderTitle = '') => {
      const messageDate = toValidDate(messageTimestamp);
      if (!messageDate || typeof localStorage === 'undefined') {
        return null;
      }

      try {
        const reminders = JSON.parse(localStorage.getItem('memoryCue:offlineReminders') || '[]');
        if (!Array.isArray(reminders)) {
          return null;
        }

        const normalizedTitle = reminderTitle.trim().toLowerCase();
        return reminders
          .map((reminder) => {
            const createdDate = toValidDate(reminder?.createdAt);
            const title = typeof reminder?.title === 'string'
              ? reminder.title.trim()
              : typeof reminder?.text === 'string'
                ? reminder.text.trim()
                : '';
            const timeDifference = createdDate
              ? Math.abs(messageDate.getTime() - createdDate.getTime())
              : Number.POSITIVE_INFINITY;
            const titleMatches = Boolean(normalizedTitle && title.toLowerCase() === normalizedTitle);
            const isCaptureSource = reminder?.source === 'capture';
            return { reminder, timeDifference, titleMatches, isCaptureSource };
          })
          .filter(({ timeDifference, titleMatches, isCaptureSource }) => (
            timeDifference <= 120000 && (isCaptureSource || titleMatches)
          ))
          .sort((left, right) => {
            if (left.titleMatches !== right.titleMatches) {
              return left.titleMatches ? -1 : 1;
            }
            return left.timeDifference - right.timeDifference;
          })[0]?.reminder || null;
      } catch {
        return null;
      }
    };

    const findMatchingCaptureNote = (messageTimestamp, noteTitle = '') => {
      const messageDate = toValidDate(messageTimestamp);
      if (!messageDate) {
        return null;
      }

      const notes = loadAllNotes();
      if (!Array.isArray(notes)) {
        return null;
      }

      const normalizedTitle = noteTitle.trim().toLowerCase();
      return notes
        .map((note) => {
          const createdDate = toValidDate(note?.createdAt);
          const title = typeof note?.title === 'string' ? note.title.trim() : '';
          const timeDifference = createdDate
            ? Math.abs(messageDate.getTime() - createdDate.getTime())
            : Number.POSITIVE_INFINITY;
          const titleMatches = Boolean(normalizedTitle && title.toLowerCase() === normalizedTitle);
          const source = typeof note?.metadata?.source === 'string'
            ? note.metadata.source.trim().toLowerCase()
            : '';
          const isCaptureSource = source === 'chat' || source === 'capture';
          return { note, timeDifference, titleMatches, isCaptureSource };
        })
        .filter(({ timeDifference, titleMatches, isCaptureSource }) => (
          timeDifference <= 120000 && (isCaptureSource || titleMatches)
        ))
        .sort((left, right) => {
          if (left.titleMatches !== right.titleMatches) {
            return left.titleMatches ? -1 : 1;
          }
          return left.timeDifference - right.timeDifference;
        })[0]?.note || null;
    };

    const getCaptureResultModel = (content, messageTimestamp = null, relatedMemories = []) => {
      const { mainText, relatedItems: textRelatedItems } = splitRelatedMemoryText(content);
      const relatedItems = normalizeRelatedMemoryItems(textRelatedItems, relatedMemories);
      const normalized = mainText.toLowerCase();
      if (!normalized) {
        return null;
      }

      if (normalized.startsWith('reminder created')) {
        const reminderSummary = mainText.replace(/^reminder created\s*/i, '').trim();
        let reminderDetail = reminderSummary.replace(/^:\s*/, '');
        let reminderSchedule = '';
        if (/^for\s+/i.test(reminderSummary)) {
          const scheduledSummary = reminderSummary.replace(/^for\s+/i, '');
          const titleSeparatorIndex = scheduledSummary.indexOf(': ');
          reminderSchedule = titleSeparatorIndex >= 0
            ? scheduledSummary.slice(0, titleSeparatorIndex).trim()
            : scheduledSummary.trim();
          reminderDetail = titleSeparatorIndex >= 0
            ? scheduledSummary.slice(titleSeparatorIndex + 2)
            : '';
        }

        reminderDetail = reminderDetail.replace(/[.\s]+$/g, '').trim();
        const matchingReminder = findMatchingCaptureReminder(messageTimestamp, reminderDetail);
        const storedTitle = typeof matchingReminder?.title === 'string'
          ? matchingReminder.title.trim()
          : typeof matchingReminder?.text === 'string'
            ? matchingReminder.text.trim()
            : '';
        const dueValue = matchingReminder?.due ?? matchingReminder?.dueAt ?? matchingReminder?.dueDate;
        const category = typeof matchingReminder?.category === 'string' ? matchingReminder.category.trim() : '';
        const schedule = formatReminderSchedule(dueValue || reminderSchedule);
        const metadata = [schedule ? `Due ${schedule}` : ''].filter(Boolean);

        return {
          tone: 'reminder',
          eyebrow: 'Reminder',
          statusLabel: 'Reminder set',
          statusIcon: '\u2713',
          title: reminderDetail || storedTitle,
          fallbackTitle: 'Reminder',
          detail: '',
          categoryLabel: category,
          metadata,
          reminderId: typeof matchingReminder?.id === 'string' ? matchingReminder.id : '',
          relatedItems,
        };
      }

      if (normalized.startsWith('reminder creation undone')) {
        return {
          tone: 'undone',
          eyebrow: 'Reminder removed',
          statusLabel: '',
          title: mainText.replace(/^reminder creation undone\s*:?\s*/i, '').replace(/[.\s]+$/g, '').trim(),
          fallbackTitle: 'Removed reminder',
          detail: 'removed',
          relatedItems: [],
        };
      }

      if (normalized.startsWith('note creation undone')) {
        return {
          tone: 'undone',
          eyebrow: 'Note removed',
          statusLabel: '',
          title: mainText.replace(/^note creation undone\s*:?\s*/i, '').replace(/[.\s]+$/g, '').trim(),
          fallbackTitle: 'Removed note',
          detail: 'removed',
          relatedItems: [],
        };
      }

      if (
        normalized.startsWith('saved note')
        || normalized.startsWith('saved to notebook')
        || normalized.startsWith('saved to notes')
      ) {
        const notebookMatch = mainText.match(/^saved to notebook\s*\(([^)]+)\)/i);
        const matchingNote = findMatchingCaptureNote(messageTimestamp);
        const storedTitle = typeof matchingNote?.title === 'string' ? matchingNote.title.trim() : '';
        const notebookName = matchingNote?.folderId
          ? getFolderNameById(matchingNote.folderId)
          : notebookMatch?.[1]?.trim() || '';
        return {
          tone: 'note',
          eyebrow: 'Note',
          statusLabel: 'Note captured',
          statusIcon: '\u270e',
          title: storedTitle,
          fallbackTitle: 'Saved note',
          detail: '',
          categoryLabel: notebookName,
          metadata: [],
          noteId: typeof matchingNote?.id === 'string' ? matchingNote.id : '',
          relatedItems,
        };
      }

      if (normalized.startsWith('saved for later review') || normalized.startsWith('added to inbox for later review')) {
        return {
          tone: 'review',
          eyebrow: 'Review',
          statusLabel: 'Saved for review',
          title: '',
          fallbackTitle: 'Saved for later review',
          detail: '',
          relatedItems,
        };
      }

      if (normalized === 'when should i remind you?') {
        return {
          tone: 'clarify',
          eyebrow: 'Reminder',
          title: 'Needs a time',
          detail: mainText,
          relatedItems,
        };
      }

      return null;
    };

    const getCompactCaptureStatus = (content) => {
      const model = getCaptureResultModel(content);
      if (!model) {
        return content;
      }

      if (model.tone === 'reminder' || model.tone === 'note' || model.tone === 'review') return '';
      if (model.tone === 'clarify') return 'Needs a time.';
      if (model.tone === 'undone') return `${model.eyebrow}.`;
      return model.title;
    };

    const renderCaptureResultMessage = (
      row,
      model,
      messageTimestamp = null,
      messageId = '',
      confirmedContent = '',
    ) => {
      row.classList.add('chat-message--capture-result', `chat-message--capture-${model.tone}`);
      if (model.statusLabel) {
        row.classList.add('chat-message--capture-confirmed');
      }

      const capturedItemType = model.reminderId ? 'reminder' : model.noteId ? 'note' : '';
      const capturedItemId = model.reminderId || model.noteId || '';
      const resolvedTitle = [model.title, confirmedContent, model.fallbackTitle, model.detail]
        .find((value) => typeof value === 'string' && value.trim())
        ?.trim() || 'Captured item';
      const contentSurface = document.createElement(capturedItemType && capturedItemId ? 'button' : 'div');
      contentSurface.className = capturedItemType && capturedItemId
        ? 'capture-result-content capture-result-card-action'
        : 'capture-result-content';

      if (capturedItemType && capturedItemId) {
        contentSurface.type = 'button';
        contentSurface.dataset.captureAction = `open-${capturedItemType}`;
        contentSurface.setAttribute('aria-label', `Open ${capturedItemType}: ${resolvedTitle}`);
        contentSurface.addEventListener('click', () => {
          const savedNotes = capturedItemType === 'note' ? loadAllNotes() : [];
          const opened = capturedItemType === 'reminder'
            ? reminderControllerApi?.openReminderById?.(capturedItemId)
            : Array.isArray(savedNotes) && savedNotes.some((note) => note?.id === capturedItemId);
          if (opened && capturedItemType === 'note') {
            document.dispatchEvent(new CustomEvent('thinkingBar:openNote', {
              detail: { noteId: capturedItemId },
            }));
          }
          if (!opened) {
            setThinkingBarStatus(`${capturedItemType === 'reminder' ? 'Reminder' : 'Note'} is no longer available.`);
          }
        });
      }

      const header = document.createElement('div');
      header.className = 'capture-result-header';

      const status = document.createElement('span');
      status.className = model.statusLabel ? 'capture-result-status' : 'capture-result-eyebrow';
      status.textContent = model.statusLabel
        ? `${model.statusLabel}${model.statusIcon ? ` ${model.statusIcon}` : ''}`
        : model.eyebrow;
      header.appendChild(status);

      const categoryLabel = typeof model.categoryLabel === 'string' ? model.categoryLabel.trim() : '';
      if (categoryLabel) {
        const category = document.createElement('span');
        category.className = 'capture-result-category';
        category.textContent = categoryLabel;
        header.appendChild(category);
      }

      const title = document.createElement('strong');
      title.className = 'capture-result-title';
      title.textContent = resolvedTitle;

      contentSurface.append(header, title);

      if (typeof model.detail === 'string' && model.detail.trim() && model.detail.trim() !== resolvedTitle) {
        const detail = document.createElement('span');
        detail.className = 'capture-result-detail';
        detail.textContent = model.detail.trim();
        contentSurface.appendChild(detail);
      }

      const timestampLabel = model.statusLabel ? '' : formatCaptureResultTimestamp(messageTimestamp);
      if ((Array.isArray(model.metadata) && model.metadata.length) || timestampLabel) {
        const context = document.createElement('div');
        context.className = 'capture-result-context';

        if (Array.isArray(model.metadata) && model.metadata.length) {
          const metadata = document.createElement('div');
          metadata.className = 'capture-result-meta';
          metadata.setAttribute('aria-label', `${model.eyebrow} details: ${model.metadata.join(', ')}`);

          model.metadata.forEach((metadataText) => {
            const item = document.createElement('span');
            item.className = 'capture-result-meta-item';
            item.textContent = metadataText;
            metadata.appendChild(item);
          });

          context.appendChild(metadata);
        }

        if (timestampLabel) {
          const timestamp = document.createElement('time');
          timestamp.className = 'capture-result-time';
          timestamp.dateTime = toValidDate(messageTimestamp)?.toISOString() || '';
          timestamp.textContent = timestampLabel;
          context.appendChild(timestamp);
        }

        contentSurface.appendChild(context);
      }

      row.appendChild(contentSurface);

      const footer = document.createElement('div');
      footer.className = 'capture-result-footer';

      if (capturedItemType && capturedItemId) {
        const messageDate = toValidDate(messageTimestamp);
        const undoRemainingMs = messageDate
          ? CAPTURE_UNDO_WINDOW_MS - Math.max(0, Date.now() - messageDate.getTime())
          : 0;
        if (undoRemainingMs > 0 && messageId) {
          const undoButton = document.createElement('button');
          undoButton.type = 'button';
          undoButton.className = 'capture-result-action capture-result-action--undo';
          undoButton.dataset.captureAction = `undo-${capturedItemType}`;
          undoButton.textContent = 'Undo';
          const undoExpiryTimer = window.setTimeout(() => {
            undoButton.remove();
            if (!footer.childElementCount) {
              footer.remove();
            }
          }, undoRemainingMs);
          undoButton.addEventListener('click', async () => {
            window.clearTimeout(undoExpiryTimer);
            undoButton.disabled = true;
            undoButton.textContent = 'Undoing...';
            const removed = capturedItemType === 'reminder'
              ? await reminderControllerApi?.undoCapturedReminder?.(capturedItemId)
              : await removeSavedNoteById(capturedItemId);
            if (!removed) {
              undoButton.disabled = false;
              undoButton.textContent = 'Undo';
              setThinkingBarStatus(`Could not undo that ${capturedItemType}.`);
              return;
            }

            const itemLabel = capturedItemType === 'reminder' ? 'Reminder' : 'Note';
            updateMessage(messageId, {
              content: `${itemLabel} creation undone: ${resolvedTitle}.`,
              quickActions: [],
            });
            setThinkingBarStatus(`${itemLabel} removed.`);
          });
          footer.appendChild(undoButton);
        }
      }

      if (Array.isArray(model.relatedItems) && model.relatedItems.length) {
        const related = document.createElement('details');
        related.className = 'capture-result-related';

        const relatedSummary = document.createElement('summary');
        relatedSummary.className = 'capture-result-related-summary';
        relatedSummary.setAttribute(
          'aria-label',
          `${model.relatedItems.length} high-confidence related ${model.relatedItems.length === 1 ? 'memory' : 'memories'}`,
        );
        relatedSummary.title = 'Related memories';
        const relatedIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        relatedIcon.classList.add('capture-result-related-icon');
        relatedIcon.setAttribute('viewBox', '0 0 24 24');
        relatedIcon.setAttribute('aria-hidden', 'true');
        relatedIcon.setAttribute('fill', 'none');
        relatedIcon.setAttribute('stroke', 'currentColor');
        relatedIcon.setAttribute('stroke-width', '2');
        relatedIcon.setAttribute('stroke-linecap', 'round');
        relatedIcon.setAttribute('stroke-linejoin', 'round');
        const firstLink = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        firstLink.setAttribute('d', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71');
        const secondLink = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        secondLink.setAttribute('d', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71');
        relatedIcon.append(firstLink, secondLink);
        relatedSummary.appendChild(relatedIcon);
        related.appendChild(relatedSummary);

        const relatedList = document.createElement('ul');
        relatedList.className = 'capture-result-related-list';

        model.relatedItems.forEach((relatedMemory) => {
          const item = document.createElement('li');
          item.className = 'capture-result-related-item';

          const label = typeof relatedMemory?.label === 'string' ? relatedMemory.label.trim() : '';
          const noteId = typeof relatedMemory?.noteId === 'string' ? relatedMemory.noteId.trim() : '';
          if (!label) {
            return;
          }

          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'capture-result-related-link';
          link.dataset.relatedNoteId = noteId;
          link.textContent = label;
          link.setAttribute('aria-label', `Open related note: ${label}`);
          link.addEventListener('click', () => {
            const notes = loadAllNotes();
            const noteExists = Array.isArray(notes) && notes.some((note) => note?.id === noteId);
            if (!noteExists) {
              setThinkingBarStatus('Related note is no longer available.');
              return;
            }

            document.dispatchEvent(new CustomEvent('thinkingBar:openNote', {
              detail: { noteId },
            }));
          });
          item.appendChild(link);
          relatedList.appendChild(item);
        });

        related.appendChild(relatedList);
        related.addEventListener('toggle', () => {
          if (related.open) {
            revealLatestCaptureMessage();
          }
        });
        footer.appendChild(related);
      }

      if (footer.childElementCount) {
        row.appendChild(footer);
      }
    };

    const renderQueryResultItems = (row, resultItems = []) => {
      if (!(row instanceof HTMLElement) || !Array.isArray(resultItems) || !resultItems.length) {
        return;
      }

      row.classList.add('chat-message--query-answer');
      const list = document.createElement('div');
      list.className = 'capture-query-results';
      list.setAttribute('aria-label', 'Matching notes and reminders');

      const normalizeResultTitle = (value) => {
        if (typeof value !== 'string') {
          return '';
        }
        const normalized = value
          .replace(/<br\s*\/?\s*>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/\s+/g, ' ')
          .trim();
        return normalized.length > 80
          ? `${normalized.slice(0, 79).trimEnd()}…`
          : normalized;
      };

      resultItems.forEach((result) => {
        const type = result?.type === 'reminder' ? 'reminder' : result?.type === 'note' ? 'note' : '';
        const id = typeof result?.id === 'string' ? result.id.trim() : '';
        const title = normalizeResultTitle(result?.title);
        if (!type || !id || !title) {
          return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'capture-query-result';
        button.dataset.queryResultType = type;
        button.dataset.queryResultId = id;
        button.setAttribute('aria-label', `Open ${type}: ${title}`);

        const typeLabel = document.createElement('span');
        typeLabel.className = 'capture-query-result-type';
        typeLabel.textContent = type === 'reminder' ? 'Reminder' : 'Note';

        const titleLabel = document.createElement('strong');
        titleLabel.className = 'capture-query-result-title';
        titleLabel.textContent = title;

        button.append(typeLabel, titleLabel);

        const dueValue = typeof result?.due === 'string' ? result.due.trim() : '';
        if (type === 'reminder' && dueValue) {
          const dueLabel = document.createElement('span');
          dueLabel.className = 'capture-query-result-meta';
          const formattedDue = formatReminderSchedule(dueValue);
          dueLabel.textContent = formattedDue ? `Due ${formattedDue}` : 'Reminder';
          button.appendChild(dueLabel);
        }

        button.addEventListener('click', () => {
          if (type === 'reminder') {
            const opened = reminderControllerApi?.openReminderById?.(id);
            if (!opened) {
              setThinkingBarStatus('That reminder is no longer available.');
            }
            return;
          }

          const notes = loadAllNotes();
          const noteExists = Array.isArray(notes) && notes.some((note) => note?.id === id);
          if (!noteExists) {
            setThinkingBarStatus('That note is no longer available.');
            return;
          }
          document.dispatchEvent(new CustomEvent('thinkingBar:openNote', {
            detail: { noteId: id },
          }));
        });

        list.appendChild(button);
      });

      if (list.childElementCount) {
        row.appendChild(list);
      }
    };

    const appendConversationMessage = (
      role,
      content,
      quickActions = [],
      messageTimestamp = null,
      messageId = '',
      relatedMemories = [],
      options = {},
    ) => {
      if (!(chatConversationContainer instanceof HTMLElement)) {
        return;
      }

      const row = document.createElement('div');
      row.className = `chat-message ${role === 'user' ? 'chat-message--user' : 'chat-message--assistant'}`;
      const normalizedContent = typeof content === 'string' ? content.trim().toLowerCase() : '';
      const captureResultModel = options.captureResultModel || (role !== 'user'
        ? getCaptureResultModel(content, messageTimestamp, relatedMemories)
        : null);
      if (
        role !== 'user' &&
        (normalizedContent === 'reminder created.' || normalizedContent === 'reminder created')
      ) {
        row.classList.add('chat-message--status');
      }
      if (captureResultModel) {
        renderCaptureResultMessage(
          row,
          captureResultModel,
          messageTimestamp,
          messageId,
          options.confirmedContent,
        );
      } else {
        const messageText = document.createElement('span');
        messageText.className = 'chat-message-text';
        messageText.textContent = content;
        row.appendChild(messageText);

        const timestampLabel = formatCaptureResultTimestamp(messageTimestamp);
        if (timestampLabel) {
          const timestamp = document.createElement('time');
          timestamp.className = 'chat-message-time';
          timestamp.dateTime = toValidDate(messageTimestamp)?.toISOString() || '';
          timestamp.textContent = timestampLabel;
          row.appendChild(timestamp);
        }

        renderQueryResultItems(row, options.resultItems);
      }

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

    const isCaptureViewActive = () => {
      const activeView = typeof document.body?.dataset?.activeView === 'string'
        ? document.body.dataset.activeView
        : '';
      return !activeView || activeView === 'capture';
    };

    const normalizeWordRescueCoachSession = (value, cue = '') => {
      if (!value || typeof value !== 'object' || value.mode !== 'coach') {
        return null;
      }
      const hints = Array.isArray(value.hints)
        ? value.hints
          .map((hint) => (typeof hint === 'string' ? hint.trim() : ''))
          .filter(Boolean)
          .slice(0, 3)
        : [];
      const answerSource = value.answer && typeof value.answer === 'object' ? value.answer : {};
      const answer = {
        word: typeof answerSource.word === 'string' ? answerSource.word.trim() : '',
        explanation: typeof answerSource.explanation === 'string' ? answerSource.explanation.trim() : '',
        example: typeof answerSource.example === 'string' ? answerSource.example.trim() : '',
      };
      const alternatives = Array.isArray(value.alternatives)
        ? value.alternatives
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
          .slice(0, 3)
        : [];

      if (hints.length !== 3 || !answer.word || !answer.explanation) {
        return null;
      }
      return {
        mode: 'coach',
        cue: typeof cue === 'string' ? cue.trim() : '',
        hints,
        answer,
        alternatives,
        hintIndex: 0,
        revealed: false,
      };
    };

    const normalizeWordRescueFastSession = (value, cue = '') => {
      if (!value || typeof value !== 'object' || value.mode !== 'fast') {
        return null;
      }
      const candidates = Array.isArray(value.candidates)
        ? value.candidates
          .map((candidate) => ({
            word: typeof candidate?.word === 'string' ? candidate.word.trim() : '',
            meaning: typeof candidate?.meaning === 'string' ? candidate.meaning.trim() : '',
            example: typeof candidate?.example === 'string' ? candidate.example.trim() : '',
          }))
          .filter((candidate) => candidate.word && candidate.meaning)
          .slice(0, 3)
        : [];
      if (!candidates.length) {
        return null;
      }
      return {
        mode: 'fast',
        cue: typeof cue === 'string' ? cue.trim() : '',
        candidates,
      };
    };

    const updateWordRescueModeUi = () => {
      const modeIsActive = Boolean(activeWordRescueMode) && isCaptureViewActive();
      const modeName = activeWordRescueMode === 'coach' ? 'Coach me' : 'Find it now';
      wordRescueModeBar?.classList.toggle('hidden', !modeIsActive);
      if (wordRescueModeLabel instanceof HTMLElement) {
        wordRescueModeLabel.textContent = modeName;
      }
      if (wordRescueLauncher instanceof HTMLButtonElement) {
        wordRescueLauncher.setAttribute('aria-expanded', String(isWordRescueChoiceOpen));
        wordRescueLauncher.setAttribute('aria-pressed', String(modeIsActive));
      }
      document.body?.classList.toggle('word-rescue-mode-active', modeIsActive);
      thinkingBarInput.placeholder = modeIsActive
        ? activeWordRescueMode === 'coach'
          ? 'Describe the word and retrieve it with clues…'
          : 'Describe the meaning or paste your sentence…'
        : DEFAULT_THINKING_BAR_PLACEHOLDER;
      if (thinkingBarLabel instanceof HTMLElement) {
        thinkingBarLabel.textContent = modeIsActive
          ? activeWordRescueMode === 'coach'
            ? 'Describe the word you want to retrieve with coaching clues'
            : 'Describe the word you need or paste the sentence'
          : DEFAULT_THINKING_BAR_LABEL;
      }
    };

    const setWordRescueBusy = (busy) => {
      if (wordRescueLauncher instanceof HTMLButtonElement) {
        wordRescueLauncher.disabled = Boolean(busy);
      }
      if (wordRescueExitButton instanceof HTMLButtonElement) {
        wordRescueExitButton.disabled = Boolean(busy);
      }
      wordRescueModeBar?.setAttribute('aria-busy', String(Boolean(busy)));
    };

    const activateWordRescueMode = (mode) => {
      activeWordRescueMode = mode === 'coach' ? 'coach' : 'fast';
      activeWordRescueSession = null;
      isWordRescueChoiceOpen = false;
      updateWordRescueModeUi();
      renderConversationHistory();
      thinkingBarInput.focus();
      revealLatestCaptureMessage();
    };

    const closeWordRescue = ({ keepFocus = true } = {}) => {
      wordRescueRequestGeneration += 1;
      activeWordRescueMode = '';
      activeWordRescueSession = null;
      isWordRescueChoiceOpen = false;
      updateWordRescueModeUi();
      renderConversationHistory();
      if (keepFocus) {
        thinkingBarInput.focus();
      }
    };

    const renderWordRescueChoice = () => {
      if (
        !isWordRescueChoiceOpen
        || !isCaptureViewActive()
        || !(chatConversationContainer instanceof HTMLElement)
      ) {
        return;
      }

      const region = document.createElement('section');
      region.className = 'word-rescue-choice';
      region.setAttribute('role', 'region');
      region.setAttribute('aria-labelledby', 'wordRescueChoiceTitle');

      const title = document.createElement('h3');
      title.id = 'wordRescueChoiceTitle';
      title.className = 'word-rescue-choice-title';
      title.textContent = 'How would you like help?';

      const copy = document.createElement('p');
      copy.className = 'word-rescue-choice-copy';
      copy.textContent = 'Get likely words immediately, or retrieve the word through progressively stronger clues.';

      const actions = document.createElement('div');
      actions.className = 'word-rescue-choice-actions';

      const findButton = document.createElement('button');
      findButton.type = 'button';
      findButton.className = 'word-rescue-choice-button word-rescue-choice-button--primary';
      findButton.dataset.wordRescueAction = 'find';
      findButton.textContent = 'Find it now';
      findButton.addEventListener('click', () => activateWordRescueMode('fast'));

      const coachButton = document.createElement('button');
      coachButton.type = 'button';
      coachButton.className = 'word-rescue-choice-button';
      coachButton.dataset.wordRescueAction = 'coach';
      coachButton.textContent = 'Coach me';
      coachButton.addEventListener('click', () => activateWordRescueMode('coach'));

      actions.append(findButton, coachButton);
      region.append(title, copy, actions);
      chatConversationContainer.appendChild(region);
    };

    const createLearnWordButton = (payload, actionId) => {
      const word = typeof payload?.word === 'string' ? payload.word.trim() : '';
      if (!word) {
        return null;
      }
      const saveState = typeof memoryCoachUi?.getVocabularyState === 'function'
        ? memoryCoachUi.getVocabularyState(word)
        : memoryCoachUi?.hasSavedWord?.(word)
          ? 'saved'
          : 'new';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'word-rescue-learn-button';
      button.dataset.wordRescueLearn = actionId;
      if (saveState === 'saved') {
        button.setAttribute('aria-disabled', 'true');
      }
      button.textContent = saveState === 'saved'
        ? `${word} — Saved for practice`
        : saveState === 'paused'
          ? `Resume “${word}”`
          : `Learn “${word}”`;
      button.addEventListener('click', () => {
        if (saveState === 'saved') {
          setThinkingBarStatus(`${word} is already saved for practice.`);
          return;
        }
        const result = memoryCoachUi?.saveVocabulary?.(payload);
        if (!result || result.status === 'invalid' || result.status === 'save_failed') {
          setThinkingBarStatus('That word could not be saved for practice.');
          return;
        }
        renderConversationHistory();
        const nextButton = Array.from(
          chatConversationContainer?.querySelectorAll('[data-word-rescue-learn]') || [],
        ).find((candidate) => candidate.dataset.wordRescueLearn === actionId);
        nextButton?.focus();
        revealLatestCaptureMessage();
      });
      return button;
    };

    const renderWordRescueFastPractice = () => {
      const session = activeWordRescueSession;
      if (
        !session
        || session.mode !== 'fast'
        || !isCaptureViewActive()
        || !(chatConversationContainer instanceof HTMLElement)
      ) {
        return;
      }

      const region = document.createElement('section');
      region.className = 'word-rescue-coach-controls word-rescue-fast-save';
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Save a word for memory practice');
      const title = document.createElement('h3');
      title.className = 'word-rescue-coach-title';
      title.textContent = 'Keep one for later';
      const copy = document.createElement('p');
      copy.className = 'word-rescue-coach-copy';
      copy.textContent = 'Save only the word you want Memory Coach to bring back for retrieval practice.';
      const actions = document.createElement('div');
      actions.className = 'word-rescue-learn-actions';
      session.candidates.forEach((candidate, index) => {
        const button = createLearnWordButton({
          word: candidate.word,
          cue: session.cue,
          explanation: candidate.meaning,
          example: candidate.example,
          alternatives: session.candidates
            .filter((_, candidateIndex) => candidateIndex !== index)
            .map((item) => item.word),
        }, `fast-${index}`);
        if (button) {
          actions.appendChild(button);
        }
      });
      region.append(title, copy, actions);
      chatConversationContainer.appendChild(region);
    };

    const renderWordRescueCoachProgress = () => {
      const session = activeWordRescueSession;
      if (
        !session
        || session.mode !== 'coach'
        || !isCaptureViewActive()
        || !(chatConversationContainer instanceof HTMLElement)
      ) {
        return;
      }

      for (let index = 1; index <= session.hintIndex; index += 1) {
        appendConversationMessage('assistant', `Hint ${index + 1} of 3: ${session.hints[index]}`);
      }

      if (session.revealed) {
        const reveal = document.createElement('section');
        reveal.className = 'word-rescue-reveal';
        reveal.setAttribute('role', 'status');

        const word = document.createElement('strong');
        word.className = 'word-rescue-reveal-word';
        word.textContent = session.answer.word;

        const explanation = document.createElement('span');
        explanation.className = 'word-rescue-reveal-detail';
        explanation.textContent = session.answer.explanation;
        reveal.append(word, explanation);

        if (session.answer.example) {
          const example = document.createElement('span');
          example.className = 'word-rescue-reveal-detail';
          example.textContent = `Example: ${session.answer.example}`;
          reveal.appendChild(example);
        }
        if (session.alternatives.length) {
          const alternatives = document.createElement('span');
          alternatives.className = 'word-rescue-reveal-detail';
          alternatives.textContent = `Also consider: ${session.alternatives.join(', ')}`;
          reveal.appendChild(alternatives);
        }
        chatConversationContainer.appendChild(reveal);
      }

      const controls = document.createElement('section');
      controls.className = 'word-rescue-coach-controls';
      controls.setAttribute('role', 'region');
      controls.setAttribute('aria-label', 'Word coaching controls');

      const title = document.createElement('h3');
      title.className = 'word-rescue-coach-title';
      title.textContent = session.revealed ? 'Ready for another?' : 'Keep retrieving';
      const copy = document.createElement('p');
      copy.className = 'word-rescue-coach-copy';
      copy.textContent = session.revealed
        ? 'Start a new coached search using the same message bar.'
        : `${session.hintIndex + 1} of 3 clues shown. The answer stays hidden until you choose to reveal it.`;
      const actions = document.createElement('div');
      actions.className = 'word-rescue-coach-actions';

      if (!session.revealed && session.hintIndex < session.hints.length - 1) {
        const hintButton = document.createElement('button');
        hintButton.type = 'button';
        hintButton.className = 'word-rescue-coach-button word-rescue-coach-button--primary';
        hintButton.dataset.wordRescueAction = 'hint';
        hintButton.textContent = 'Another hint';
        hintButton.addEventListener('click', () => {
          session.hintIndex += 1;
          renderConversationHistory();
          setThinkingBarStatus(`Hint ${session.hintIndex + 1} of 3 shown.`);
          const nextAction = session.hintIndex < session.hints.length - 1 ? 'hint' : 'reveal';
          chatConversationContainer
            ?.querySelector(`[data-word-rescue-action="${nextAction}"]`)
            ?.focus();
          revealLatestCaptureMessage();
        });
        actions.appendChild(hintButton);
      }

      if (!session.revealed) {
        const revealButton = document.createElement('button');
        revealButton.type = 'button';
        revealButton.className = 'word-rescue-coach-button';
        revealButton.dataset.wordRescueAction = 'reveal';
        revealButton.textContent = 'Show word';
        revealButton.addEventListener('click', () => {
          session.revealed = true;
          renderConversationHistory();
          setThinkingBarStatus('Word revealed.');
          chatConversationContainer
            ?.querySelector('[data-word-rescue-action="restart"]')
            ?.focus();
          revealLatestCaptureMessage();
        });
        actions.appendChild(revealButton);
      } else {
        const learnButton = createLearnWordButton({
          word: session.answer.word,
          cue: session.cue,
          explanation: session.answer.explanation,
          example: session.answer.example,
          hints: session.hints,
          alternatives: session.alternatives,
        }, 'coach-answer');
        if (learnButton) {
          actions.appendChild(learnButton);
        }
        const restartButton = document.createElement('button');
        restartButton.type = 'button';
        restartButton.className = 'word-rescue-coach-button word-rescue-coach-button--primary';
        restartButton.dataset.wordRescueAction = 'restart';
        restartButton.textContent = 'Try another word';
        restartButton.addEventListener('click', () => {
          activeWordRescueSession = null;
          renderConversationHistory();
          thinkingBarInput.focus();
        });
        actions.appendChild(restartButton);
      }

      controls.append(title, copy, actions);
      chatConversationContainer.appendChild(controls);
    };

    const renderWordRescueSupplementalUi = () => {
      if (memoryCoachUi?.isActive?.()) {
        memoryCoachUi.render();
        return;
      }
      renderWordRescueChoice();
      renderWordRescueFastPractice();
      renderWordRescueCoachProgress();
    };

    const formatCaptureTimestamp = (value) => {
      const parsed =
        typeof value === 'number'
          ? new Date(value)
          : typeof value === 'string'
            ? new Date(value)
            : null;

      if (!parsed || Number.isNaN(parsed.getTime())) {
        return '';
      }

      const now = new Date();
      if (
        parsed.getFullYear() === now.getFullYear() &&
        parsed.getMonth() === now.getMonth() &&
        parsed.getDate() === now.getDate()
      ) {
        return `Today - ${parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      }

      return parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const renderCaptureHomeState = () => {
      if (!(chatConversationContainer instanceof HTMLElement)) {
        return;
      }

      const dashboard = buildDashboard();
      const recentItems = Array.isArray(dashboard.recent) ? dashboard.recent.slice(0, 3) : [];
      const todayCount = Array.isArray(dashboard.today) ? dashboard.today.length : 0;
      const inboxCount = Array.isArray(dashboard.inbox) ? dashboard.inbox.length : 0;
      const reminderCount = readRemindersForRecall().length;

      chatConversationContainer.innerHTML = '';

      const shell = document.createElement('div');
      shell.className = 'capture-home-shell w-full';
      shell.style.alignSelf = 'stretch';

      const statsRow = document.createElement('div');
      statsRow.className = 'flex flex-wrap gap-2';
      [
        { label: 'Today', value: todayCount },
        { label: 'Reminders', value: reminderCount },
        { label: 'Inbox', value: inboxCount },
      ].forEach(({ label, value }) => {
        const chip = document.createElement('span');
        chip.className = 'badge badge-outline badge-sm';
        chip.textContent = `${label} ${value}`;
        statsRow.appendChild(chip);
      });

      const actionsRow = document.createElement('div');
      actionsRow.className = 'capture-home-actions';

      const notebooksButton = document.createElement('button');
      notebooksButton.type = 'button';
      notebooksButton.className = 'btn btn-sm btn-primary';
      notebooksButton.textContent = 'Open notes';
      notebooksButton.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'notebooks' } }));
      });

      const remindersButton = document.createElement('button');
      remindersButton.type = 'button';
      remindersButton.className = 'btn btn-sm btn-ghost';
      remindersButton.textContent = 'Open reminders';
      remindersButton.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'reminders' } }));
      });

      actionsRow.append(notebooksButton, remindersButton);

      const recentSection = document.createElement('section');
      recentSection.className = 'capture-recent';

      const recentHeading = document.createElement('h3');
      recentHeading.textContent = 'Recent notes';
      recentSection.appendChild(recentHeading);

      const recentList = document.createElement('div');
      recentList.className = 'mt-2 grid gap-2';

      if (!recentItems.length) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-base-content/60';
        empty.textContent = 'No recent notes yet.';
        recentList.appendChild(empty);
      } else {
        recentItems.forEach((item) => {
          const recentButton = document.createElement('button');
          recentButton.type = 'button';
          recentButton.className = 'group w-full rounded-xl border border-base-300 bg-base-100 px-3 py-2 text-left transition hover:border-primary/30 hover:bg-primary/5';

          const recentTitle = document.createElement('div');
          recentTitle.className = 'text-sm font-medium text-base-content';
          recentTitle.textContent = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : 'Untitled note';

          const recentMeta = document.createElement('div');
          recentMeta.className = 'mt-1 text-xs text-base-content/60';
          const metaParts = [];
          if (typeof item?.folder === 'string' && item.folder.trim()) {
            metaParts.push(item.folder.trim());
          }
          const timestamp = formatCaptureTimestamp(item?.updatedAt || item?.createdAt);
          if (timestamp) {
            metaParts.push(timestamp);
          }
          recentMeta.textContent = metaParts.join(' | ');

          recentButton.append(recentTitle, recentMeta);
          recentButton.addEventListener('click', () => {
            if (typeof openNoteFromDashboard === 'function' && item?.id) {
              openNoteFromDashboard(item.id);
              return;
            }

            document.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'notebooks' } }));
          });

          recentList.appendChild(recentButton);
        });
      }

      recentSection.appendChild(recentList);
      shell.append(statsRow, actionsRow, recentSection);
      chatConversationContainer.appendChild(shell);
    };

    const renderConversationHistory = () => {
      if (!(chatConversationContainer instanceof HTMLElement)) {
        return;
      }
      chatConversationContainer.innerHTML = '';
      const messages = getMessages();

      if (!Array.isArray(messages) || messages.length === 0) {
        renderCaptureHomeState();
        renderWordRescueSupplementalUi();
        return;
      }

      const orderedMessages = messages
        .map((message, index) => {
          const messageDate = toValidDate(
            message?.timestamp ?? message?.createdAt ?? message?.updatedAt,
          );
          return {
            message,
            index,
            timestamp: messageDate?.getTime() ?? 0,
          };
        })
        .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)
        .map(({ message }) => message);

      const hiddenMessageCount = Math.max(0, orderedMessages.length - MAX_VISIBLE_CAPTURE_MESSAGES);
      if (hiddenMessageCount > 0) {
        const trimmedNotice = document.createElement('div');
        trimmedNotice.className = 'chat-history-trimmed';
        trimmedNotice.textContent =
          hiddenMessageCount === 1
            ? 'Showing the latest capture. 1 older item is hidden here.'
            : `Showing the latest captures. ${hiddenMessageCount} older items are hidden here.`;
        chatConversationContainer.appendChild(trimmedNotice);
      }

      const visibleMessages = orderedMessages.slice(-MAX_VISIBLE_CAPTURE_MESSAGES);
      for (let index = 0; index < visibleMessages.length; index += 1) {
        const message = visibleMessages[index];
        const content = typeof message?.content === 'string' ? message.content.trim() : '';
        if (!content) {
          continue;
        }

        appendConversationMessage(
          message?.role === 'user' ? 'user' : 'assistant',
          content,
          message?.quickActions,
          message?.timestamp,
          message?.id,
          message?.relatedMemories,
          { resultItems: message?.resultItems },
        );
      }
      renderWordRescueSupplementalUi();
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

    const setupThinkingBarVoiceCapture = () => {
      if (
        !(thinkingBarVoiceButton instanceof HTMLElement)
        || !isTextEntryElement(thinkingBarInput)
        || typeof window === 'undefined'
      ) {
        return;
      }

      const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const unavailableMessage = 'Voice input is not available in this browser.';

      if (typeof SpeechRecognitionCtor !== 'function') {
        thinkingBarVoiceButton.setAttribute('aria-disabled', 'true');
        thinkingBarVoiceButton.title = unavailableMessage;
        thinkingBarVoiceButton.addEventListener('click', () => {
          setThinkingBarStatus(unavailableMessage);
        });
        return;
      }

      let recognition;
      try {
        recognition = new SpeechRecognitionCtor();
      } catch (error) {
        console.warn('[capture] failed to initialise voice input', error);
        thinkingBarVoiceButton.setAttribute('aria-disabled', 'true');
        thinkingBarVoiceButton.title = unavailableMessage;
        thinkingBarVoiceButton.addEventListener('click', () => {
          setThinkingBarStatus(unavailableMessage);
        });
        return;
      }

      recognition.lang = 'en-AU';
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      let isListening = false;
      let hasVoiceOutcome = false;
      let ignoreRecognitionEvents = false;
      let isCancelling = false;

      const updateListeningState = (listening) => {
        isListening = Boolean(listening);
        thinkingBarVoiceButton.classList.toggle('is-listening', isListening);
        thinkingBarVoiceButton.setAttribute('aria-pressed', isListening ? 'true' : 'false');
        thinkingBarVoiceButton.setAttribute(
          'aria-label',
          isListening ? 'Stop listening' : 'Add with voice',
        );
        thinkingBarVoiceButton.title = isListening
          ? 'Stop listening'
          : 'Add a reminder, note, or question with voice';
      };

      const stopListening = ({ announce = true, cancel = false } = {}) => {
        if (!isListening) {
          return;
        }
        hasVoiceOutcome = true;
        if (cancel) {
          ignoreRecognitionEvents = true;
          isCancelling = true;
        }
        try {
          if (cancel && typeof recognition.abort === 'function') {
            recognition.abort();
          } else {
            recognition.stop();
          }
        } catch (error) {
          console.warn('[capture] failed to stop voice input', error);
          isCancelling = false;
        }
        updateListeningState(false);
        if (announce) {
          setThinkingBarStatus('Voice capture stopped.');
        }
      };

      recognition.onstart = () => {
        if (ignoreRecognitionEvents) {
          return;
        }
        hasVoiceOutcome = false;
        updateListeningState(true);
        setThinkingBarStatus('Listening… Speak your reminder, note, or question.');
      };

      recognition.onresult = (event) => {
        if (ignoreRecognitionEvents) {
          return;
        }
        const transcript = Array.from(event?.results || [])
          .map((result) => result?.[0]?.transcript || '')
          .join(' ')
          .trim();

        hasVoiceOutcome = true;
        updateListeningState(false);

        if (!transcript) {
          setThinkingBarStatus('I did not catch that. Tap the microphone to try again.');
          return;
        }

        const existingText = thinkingBarInput.value.trim();
        thinkingBarInput.value = existingText ? `${existingText} ${transcript}` : transcript;
        thinkingBarInput.dispatchEvent(new Event('input', { bubbles: true }));
        setThinkingBarStatus('Voice captured. Review it, then tap Send.');
        thinkingBarInput.focus();
      };

      recognition.onerror = (event) => {
        if (ignoreRecognitionEvents) {
          return;
        }
        hasVoiceOutcome = true;
        updateListeningState(false);
        const errorCode = typeof event?.error === 'string' ? event.error : '';
        if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
          setThinkingBarStatus('Microphone access was blocked. Allow microphone access and try again.');
        } else if (errorCode === 'no-speech') {
          setThinkingBarStatus('I did not hear anything. Tap the microphone to try again.');
        } else if (errorCode === 'audio-capture') {
          setThinkingBarStatus('No microphone was found on this device.');
        } else {
          setThinkingBarStatus('Voice capture stopped. Tap the microphone to try again.');
        }
      };

      recognition.onend = () => {
        if (ignoreRecognitionEvents) {
          isCancelling = false;
          updateListeningState(false);
          return;
        }
        const shouldAnnounceEnd = isListening && !hasVoiceOutcome;
        updateListeningState(false);
        if (shouldAnnounceEnd) {
          setThinkingBarStatus('Listening stopped. Tap the microphone to try again.');
        }
      };

      thinkingBarVoiceButton.removeAttribute('aria-disabled');
      thinkingBarVoiceButton.addEventListener('click', () => {
        if (isCancelling) {
          setThinkingBarStatus('Voice capture is stopping. Try again in a moment.');
          return;
        }
        if (isListening) {
          stopListening();
          return;
        }

        try {
          hasVoiceOutcome = false;
          ignoreRecognitionEvents = false;
          recognition.start();
          updateListeningState(true);
          setThinkingBarStatus('Listening… Speak your reminder, note, or question.');
        } catch (error) {
          console.warn('[capture] failed to start voice input', error);
          updateListeningState(false);
          setThinkingBarStatus('Voice capture could not start. Tap the microphone to try again.');
        }
      });

      thinkingBarForm?.addEventListener('submit', () => {
        if (isListening) {
          stopListening({ announce: false, cancel: true });
        }
      });
      window.addEventListener('pagehide', () => {
        if (isListening) {
          stopListening({ announce: false, cancel: true });
        }
      });
      window.addEventListener('memorycue:navigation:changed', (event) => {
        if (event?.detail?.view === 'notebooks' && isListening) {
          stopListening({ announce: false, cancel: true });
          setThinkingBarStatus('');
        }
      });

      updateListeningState(false);
    };

    memoryCoachUi = createMemoryCoachUi({
      container: chatConversationContainer,
      launcher: memoryCoachLauncher,
      controlsRegion: thinkingBarContainer,
      modeBar: memoryCoachModeBar,
      modeLabel: memoryCoachModeLabel,
      exitButton: memoryCoachExitButton,
      loadEntries: () => getInboxEntries({ includeMemoryCoach: true }),
      createEntry: saveInboxEntry,
      updateEntry: updateMemoryCoachInboxEntry,
      setStatus: setThinkingBarStatus,
      requestRender: () => {
        renderConversationHistory();
        revealLatestCaptureMessage();
      },
      beforeActivate: () => {
        if (activeWordRescueMode || isWordRescueChoiceOpen) {
          closeWordRescue({ keepFocus: false });
        }
      },
      onFindWord: () => {
        isWordRescueChoiceOpen = true;
        updateWordRescueModeUi();
        renderConversationHistory();
        chatConversationContainer
          ?.querySelector('[data-word-rescue-action="find"]')
          ?.focus();
        revealLatestCaptureMessage();
      },
    });

    const revealLatestCaptureMessage = () => {
      const appContent = document.getElementById('main');
      const latestMessage = chatConversationContainer?.lastElementChild;
      if (
        !(appContent instanceof HTMLElement)
        || !(latestMessage instanceof HTMLElement)
        || !(
          latestMessage.classList.contains('chat-message')
          || latestMessage.classList.contains('word-rescue-choice')
          || latestMessage.classList.contains('word-rescue-coach-controls')
          || latestMessage.classList.contains('word-rescue-reveal')
          || latestMessage.classList.contains('memory-coach-card')
        )
      ) {
        return;
      }

      const scheduleFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => callback();
      const adjustScroll = () => {
        const composerTop = thinkingBarContainer?.getBoundingClientRect().top ?? window.innerHeight;
        const messageBottom = latestMessage.getBoundingClientRect().bottom;
        const overlap = messageBottom - composerTop + 12;
        if (overlap > 0) {
          appContent.scrollTop += overlap;
        }
      };
      scheduleFrame(() => {
        adjustScroll();
        scheduleFrame(adjustScroll);
      });
    };

    const refreshCaptureConversation = () => {
      renderConversationHistory();
      revealLatestCaptureMessage();
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
        return `${index + 1}. ${title}${tags}${summarySource ? ` \u2013 ${summarySource}` : ''}`;
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
      const wordRescueModeForRequest = isCaptureViewActive() ? activeWordRescueMode : '';
      const wordRescueRequestToken = wordRescueModeForRequest
        ? ++wordRescueRequestGeneration
        : wordRescueRequestGeneration;
      if (wordRescueModeForRequest) {
        activeWordRescueSession = null;
      }
      setWordRescueBusy(true);

      try {
        const reply = await handleChatMessage(trimmedMessage, wordRescueModeForRequest
          ? {
            assistantTask: 'word_rescue',
            assistantMode: wordRescueModeForRequest,
          }
          : {});
        const replyMessage = typeof reply?.message === 'string' && reply.message.trim()
          ? reply.message.trim()
          : 'Saved to Inbox';
        const coachSession = normalizeWordRescueCoachSession(reply?.wordRescue, trimmedMessage);
        const fastSession = normalizeWordRescueFastSession(reply?.wordRescue, trimmedMessage);
        const canApplyWordRescueResponse = isCaptureViewActive()
          && (!wordRescueModeForRequest || (
            wordRescueRequestToken === wordRescueRequestGeneration
            && activeWordRescueMode === wordRescueModeForRequest
          ));
        if (coachSession && canApplyWordRescueResponse) {
          activeWordRescueMode = 'coach';
          activeWordRescueSession = coachSession;
          isWordRescueChoiceOpen = false;
          updateWordRescueModeUi();
        } else if (fastSession && canApplyWordRescueResponse) {
          activeWordRescueMode = 'fast';
          activeWordRescueSession = fastSession;
          isWordRescueChoiceOpen = false;
          updateWordRescueModeUi();
        }
        renderConversationHistory();
        setThinkingBarStatus(getCompactCaptureStatus(replyMessage));

        thinkingBarInput.value = '';
        thinkingBarComposer?.autoResize();
        thinkingBarInput.focus();
        revealLatestCaptureMessage();
      } catch (error) {
        console.error('[capture] failed to process smart capture', error);
        appendAssistantMessage("Sorry, I couldn't process that capture.", 'assistant-message assistant-message--error');
      } finally {
        isAssistantSending = false;
        setWordRescueBusy(false);
      }
    };

    const thinkingBarComposer = createChatComposer({
      form: thinkingBarForm,
      textarea: thinkingBarInput,
      button: thinkingBarSubmit,
    });

    thinkingBarForm?.addEventListener('submit', sendAssistantMessage);
    setupThinkingBarVoiceCapture();

    wordRescueLauncher?.addEventListener('click', () => {
      if (memoryCoachUi?.isActive?.()) {
        memoryCoachUi.deactivate({ restoreFocus: false });
      }
      if (activeWordRescueMode || isWordRescueChoiceOpen) {
        closeWordRescue({ keepFocus: false });
        wordRescueLauncher.focus();
        return;
      }
      isWordRescueChoiceOpen = true;
      updateWordRescueModeUi();
      renderConversationHistory();
      chatConversationContainer
        ?.querySelector('[data-word-rescue-action="find"]')
        ?.focus();
      revealLatestCaptureMessage();
    });

    wordRescueExitButton?.addEventListener('click', () => closeWordRescue());

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || (!activeWordRescueMode && !isWordRescueChoiceOpen)) {
        return;
      }
      event.preventDefault();
      closeWordRescue({ keepFocus: false });
      wordRescueLauncher?.focus();
    });

    window.addEventListener('memorycue:navigation:changed', (event) => {
      if (event?.detail?.view !== 'capture' && (activeWordRescueMode || isWordRescueChoiceOpen)) {
        closeWordRescue({ keepFocus: false });
      } else {
        updateWordRescueModeUi();
      }
    });

    updateWordRescueModeUi();
    refreshCaptureConversation();
    document.addEventListener('memoryCue:chatUpdated', refreshCaptureConversation);
    document.addEventListener('memoryCue:notesUpdated', refreshCaptureConversation);
    document.addEventListener('memoryCue:entriesUpdated', refreshCaptureConversation);
    document.addEventListener('memoryCue:remindersUpdated', refreshCaptureConversation);
    window.addEventListener('resize', revealLatestCaptureMessage);
    window.visualViewport?.addEventListener('resize', revealLatestCaptureMessage);

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
The mobile runtime uses js/services/navigation-service-v2.js as the single navigation controller.
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
    const sheetScrollArea = sheet.querySelector('.reminder-sheet-content');
    const titleInput = sheet.querySelector('#reminderText');
    const detailsInput = sheet.querySelector('#reminderDetails');
    const dateInput = sheet.querySelector('#reminderDate');
    const detailsDisclosure = sheet.querySelector('#reminderDetailsDisclosure');
    const optionsDisclosure = sheet.querySelector('#reminderOptionsDisclosure');
    const detailsSummary = sheet.querySelector('#reminderDetailsSummary');
    const optionsSummary = sheet.querySelector('#reminderOptionsSummary');
    const notificationStatus = sheet.querySelector('#reminderNotificationStatus');
    const statusMessage = sheet.querySelector('#statusMessage');
    const datePresetButtons = Array.from(
      sheet.querySelectorAll('[data-reminder-date-preset]')
    );
    const notifSwitchRow = sheet.querySelector('.reminder-notification-setting');
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

    const toLocalDateValue = (value) => {
      const local = new Date(value);
      const year = local.getFullYear();
      const month = String(local.getMonth() + 1).padStart(2, '0');
      const day = String(local.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const getDatePresetValues = () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        today: toLocalDateValue(today),
        tomorrow: toLocalDateValue(tomorrow),
      };
    };

    const syncDatePresets = () => {
      const values = getDatePresetValues();
      const currentDate = dateInput instanceof HTMLInputElement ? dateInput.value : '';
      datePresetButtons.forEach((button) => {
        const preset = button.dataset.reminderDatePreset;
        const isActive = preset === 'today'
          ? currentDate === values.today
          : preset === 'tomorrow'
            ? currentDate === values.tomorrow
            : preset === 'choose' && Boolean(currentDate) &&
              currentDate !== values.today && currentDate !== values.tomorrow;
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    };

    const openNativeDatePicker = () => {
      if (!(dateInput instanceof HTMLInputElement)) return;
      if (typeof dateInput.showPicker === 'function') {
        try {
          dateInput.showPicker();
          return;
        } catch {
          /* fall through to focus for browsers without an available picker */
        }
      }
      dateInput.focus();
      dateInput.click();
    };

    datePresetButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!(dateInput instanceof HTMLInputElement)) return;
        const preset = button.dataset.reminderDatePreset;
        if (preset === 'choose') {
          openNativeDatePicker();
          return;
        }
        const nextValue = getDatePresetValues()[preset];
        if (!nextValue) return;
        dateInput.value = nextValue;
        dateInput.dispatchEvent(new Event('input', { bubbles: true }));
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
        syncDatePresets();
      });
    });
    dateInput?.addEventListener('input', syncDatePresets);
    dateInput?.addEventListener('change', syncDatePresets);

    const syncDisclosureSummaries = () => {
      if (detailsSummary instanceof HTMLElement) {
        detailsSummary.textContent = detailsInput?.value?.trim() ? 'Added' : 'Optional';
      }
      if (optionsSummary instanceof HTMLElement) {
        optionsSummary.textContent = `${prioritySelect?.value || 'Medium'} priority`;
      }
    };

    const prepareDisclosureState = () => {
      syncDisclosureSummaries();
      if (detailsDisclosure instanceof HTMLElement) {
        detailsDisclosure.open = Boolean(detailsInput?.value?.trim());
      }
      if (optionsDisclosure instanceof HTMLElement) {
        optionsDisclosure.open = (prioritySelect?.value || 'Medium') !== 'Medium';
      }
    };

    detailsInput?.addEventListener('input', syncDisclosureSummaries);
    prioritySelect?.addEventListener('change', syncDisclosureSummaries);

    const syncNotificationPresentation = () => {
      if (!(notifToggle instanceof HTMLInputElement)) return;
      let message = 'Enable alerts on this device';
      let checked = false;
      let disabled = false;

      if (typeof window === 'undefined' || !('Notification' in window)) {
        message = 'Alerts are not supported on this device';
        disabled = true;
      } else if (window.Notification.permission === 'granted') {
        message = 'Alerts enabled on this device';
        checked = true;
        disabled = true;
      } else if (window.Notification.permission === 'denied') {
        message = 'Blocked in browser settings';
        disabled = true;
      }

      notifToggle.checked = checked;
      notifToggle.disabled = disabled;
      notifToggle.setAttribute('aria-checked', checked ? 'true' : 'false');
      if (notificationStatus instanceof HTMLElement) {
        notificationStatus.textContent = message;
      }
    };

    notifToggle?.addEventListener('click', () => {
      setTimeout(syncNotificationPresentation, 50);
      setTimeout(syncNotificationPresentation, 500);
    });
    document.addEventListener('reminder:notification-permission-changed', syncNotificationPresentation);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncNotificationPresentation();
    });

    const focusFirstField = () => {
      const focusTarget = titleInput;
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
      syncDatePresets();
      prepareDisclosureState();
      syncNotificationPresentation();
      if (statusMessage instanceof HTMLElement) {
        statusMessage.textContent = '';
      }
      if (sheetScrollArea instanceof HTMLElement) {
        sheetScrollArea.scrollTop = 0;
      }
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
      syncDatePresets();
      prepareDisclosureState();
      syncNotificationPresentation();
      if (statusMessage instanceof HTMLElement) {
        statusMessage.textContent = '';
      }
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
        if (event.submitter === saveBtn) {
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
    exportBtnSel: '#exportBackupBtn',
    importFileSel: '#importBackupFile',
    importBtnSel: '#importBackupBtn',
    openSettingsSel: '[data-open="settings"]',
    dateFeedbackSel: '#dateFeedback',
    voiceBtnSel: '#startVoiceCaptureGlobal',
  })
    .then((controllerApi) => {
      reminderControllerApi = controllerApi;
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
  if (typeof window !== 'undefined' && window.__memoryCueMobileNotesInit === true) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__memoryCueMobileNotesInit = true;
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

  // These controls were authored inside the retired saved-notes overlay. The current
  // Saved Notes overview keeps that overlay hidden, so fixed sheets and dialogs must be
  // hosted by the document body to remain visible and usable.
  [
    noteFolderSheet,
    noteFolderSheetBackdrop,
    document.getElementById('moveFolderSheet'),
    document.getElementById('note-options-overlay'),
    document.getElementById('note-options-sheet'),
    document.getElementById('newFolderModal'),
    document.getElementById('renameFolderModal'),
    document.getElementById('deleteFolderModal'),
  ].forEach((element) => {
    if (element instanceof HTMLElement && element.parentElement !== document.body) {
      document.body.appendChild(element);
    }
  });

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
        });
    }

    scratchNotesEditorElement.setAttribute('contenteditable', 'true');
    scratchNotesEditorElement.setAttribute('role', 'textbox');
    scratchNotesEditorElement.setAttribute('aria-multiline', 'true');

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
    'justifyleft',
    'justifycenter',
    'justifyright',
  ]);

  const FONT_SIZE_OPTIONS = [
    { px: 13, legacySize: '2' },
    { px: 15, legacySize: '3' },
    { px: 17, legacySize: '4' },
    { px: 20, legacySize: '5' },
    { px: 24, legacySize: '6' },
    { px: 30, legacySize: '7' },
  ];
  const DEFAULT_FONT_SIZE_OPTION = FONT_SIZE_OPTIONS.find((option) => option.px === 17) || FONT_SIZE_OPTIONS[2];
  const TEXT_STYLE_OPTIONS = [
    { id: 'heading', label: 'Heading', compactLabel: 'Heading', tagName: 'h2' },
    { id: 'subheading', label: 'Subheading', compactLabel: 'Subhead', tagName: 'h3' },
    { id: 'body', label: 'Body', compactLabel: 'Body', tagName: 'p' },
    { id: 'small', label: 'Small notes', compactLabel: 'Small', tagName: 'p' },
  ];
  const DEFAULT_TEXT_STYLE_OPTION = TEXT_STYLE_OPTIONS.find((option) => option.id === 'body');
  const ALIGNMENT_OPTIONS = [
    { id: 'left', label: 'Left', command: 'justifyleft' },
    { id: 'center', label: 'Centre', command: 'justifycenter' },
    { id: 'right', label: 'Right', command: 'justifyright' },
  ];

  const getFontSizeOption = (value) => {
    const numericValue = Number.parseInt(String(value || ''), 10);
    return FONT_SIZE_OPTIONS.find((option) => option.px === numericValue)
      || FONT_SIZE_OPTIONS.find((option) => option.legacySize === String(value || ''))
      || DEFAULT_FONT_SIZE_OPTION;
  };
  let pendingFontSizePx = null;

  const normalizeEditorFontSizes = (preferredPixelSize = null) => {
    if (!(scratchNotesEditorElement instanceof HTMLElement)) {
      return false;
    }

    const fontElements = Array.from(scratchNotesEditorElement.querySelectorAll('font[size]'));
    if (!fontElements.length) {
      return false;
    }

    fontElements.forEach((fontElement) => {
      const sizeAttribute = fontElement.getAttribute('size');
      const option = FONT_SIZE_OPTIONS.find((candidate) => candidate.legacySize === String(sizeAttribute || ''))
        || getFontSizeOption(preferredPixelSize);
      const spanElement = document.createElement('span');
      spanElement.style.fontSize = `${option.px}px`;

      const colorAttribute = fontElement.getAttribute('color');
      if (colorAttribute) {
        spanElement.style.color = colorAttribute;
      }

      while (fontElement.firstChild) {
        spanElement.appendChild(fontElement.firstChild);
      }
      fontElement.replaceWith(spanElement);
    });

    return true;
  };

  const selectionBelongsToEditor = (selection) => {
    if (!selection || selection.rangeCount === 0 || !(scratchNotesEditorElement instanceof HTMLElement)) {
      return false;
    }
    const range = selection.getRangeAt(0);
    const anchorNode = range.commonAncestorContainer;
    return anchorNode === scratchNotesEditorElement || scratchNotesEditorElement.contains(anchorNode);
  };

  const getElementFromSelectionNode = (node) => {
    if (node instanceof Element) {
      return node;
    }
    return node?.parentElement instanceof Element ? node.parentElement : null;
  };

  const EDITOR_BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, div, blockquote, li';

  const getSelectedEditorBlocks = () => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!selectionBelongsToEditor(selection)) {
      return [];
    }

    const range = selection.getRangeAt(0);
    const selectedBlocks = Array.from(scratchNotesEditorElement.querySelectorAll(EDITOR_BLOCK_SELECTOR))
      .filter((element) => {
        try {
          return range.intersectsNode(element);
        } catch {
          return false;
        }
      });

    if (selectedBlocks.length) {
      return selectedBlocks;
    }

    const selectionElement = getElementFromSelectionNode(range.commonAncestorContainer);
    const closestBlock = selectionElement?.closest(EDITOR_BLOCK_SELECTOR);
    return closestBlock
      && closestBlock !== scratchNotesEditorElement
      && scratchNotesEditorElement.contains(closestBlock)
      ? [closestBlock]
      : [];
  };

  const getCurrentTextStyleOption = () => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!selectionBelongsToEditor(selection)) {
      return DEFAULT_TEXT_STYLE_OPTION;
    }

    const range = selection.getRangeAt(0);
    const selectionElement = getElementFromSelectionNode(range.commonAncestorContainer);
    const currentBlock = selectionElement?.closest(EDITOR_BLOCK_SELECTOR);
    if (currentBlock?.getAttribute('data-note-text-style') === 'small') {
      return TEXT_STYLE_OPTIONS.find((option) => option.id === 'small') || DEFAULT_TEXT_STYLE_OPTION;
    }

    const currentTagName = currentBlock?.tagName?.toLowerCase();
    return TEXT_STYLE_OPTIONS.find((option) => option.tagName === currentTagName)
      || DEFAULT_TEXT_STYLE_OPTION;
  };

  const applyPixelFontSize = (value) => {
    const option = getFontSizeOption(value);
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!selectionBelongsToEditor(selection)) {
      pendingFontSizePx = option.px;
      return;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      pendingFontSizePx = option.px;
      return;
    }

    pendingFontSizePx = null;
    document.execCommand('fontSize', false, option.legacySize);
    normalizeEditorFontSizes(option.px);
  };

  const insertPendingFontSizeText = (text = '') => {
    if (!pendingFontSizePx || !(scratchNotesEditorElement instanceof HTMLElement) || !text) {
      return false;
    }

    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!selectionBelongsToEditor(selection)) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const spanElement = document.createElement('span');
    spanElement.style.fontSize = `${pendingFontSizePx}px`;
    const textNode = document.createTextNode(text);
    spanElement.appendChild(textNode);

    range.deleteContents();
    range.insertNode(spanElement);

    const nextRange = document.createRange();
    nextRange.setStart(textNode, textNode.length);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    pendingFontSizePx = null;
    return true;
  };

  const applyTextStyle = (styleId) => {
    const option = TEXT_STYLE_OPTIONS.find((candidate) => candidate.id === styleId)
      || DEFAULT_TEXT_STYLE_OPTION;
    if (!option) {
      return;
    }

    applyFormatCommand('formatBlock', option.tagName);
    getSelectedEditorBlocks().forEach((blockElement) => {
      if (option.id === 'small') {
        blockElement.setAttribute('data-note-text-style', 'small');
      } else {
        blockElement.removeAttribute('data-note-text-style');
      }
    });
    updateToolbarState();
  };

  function updateToolbarState() {
    const buttons = document.querySelectorAll('.rte-btn[data-cmd], .rte-align-option[data-cmd]');
    let activeAlignment = ALIGNMENT_OPTIONS[0];
    buttons.forEach((button) => {
      const command = (button.dataset.cmd || '').toLowerCase();
      if (!command || !TOGGLE_COMMANDS.has(command)) {
        button.classList.remove('active');
        return;
      }
      try {
        const active = document.queryCommandState(command);
        button.classList.toggle('active', !!active);
        if (button.classList.contains('rte-align-option')) {
          button.setAttribute('aria-checked', active ? 'true' : 'false');
          if (active) {
            activeAlignment = ALIGNMENT_OPTIONS.find((option) => option.command === command)
              || activeAlignment;
          }
        }
      } catch (err) {
        button.classList.remove('active');
      }
    });

    if (!document.querySelector('.rte-align-option.active')) {
      const leftAlignmentButton = document.querySelector('.rte-align-option[data-alignment="left"]');
      if (leftAlignmentButton instanceof HTMLButtonElement) {
        leftAlignmentButton.classList.add('active');
        leftAlignmentButton.setAttribute('aria-checked', 'true');
      }
    }

    const alignmentTrigger = document.getElementById('rteAlignmentTrigger');
    if (alignmentTrigger instanceof HTMLButtonElement) {
      alignmentTrigger.dataset.alignment = activeAlignment.id;
      alignmentTrigger.setAttribute('aria-label', `Text alignment: ${activeAlignment.label}`);
    }

    const textStyleOption = getCurrentTextStyleOption() || DEFAULT_TEXT_STYLE_OPTION;
    const textStyleTrigger = document.getElementById('rteTextStyleTrigger');
    if (textStyleTrigger instanceof HTMLButtonElement && textStyleOption) {
      textStyleTrigger.setAttribute('aria-label', `Text type: ${textStyleOption.label}`);
      const currentLabel = textStyleTrigger.querySelector('[data-rte-text-style-label]');
      if (currentLabel instanceof HTMLElement) {
        currentLabel.textContent = textStyleOption.compactLabel || textStyleOption.label;
      }
    }
    document.querySelectorAll('.rte-text-style-option[data-text-style]').forEach((button) => {
      const isActive = button.getAttribute('data-text-style') === textStyleOption?.id;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  const applyFormatCommand = (command, value = null) => {
    if (!command || !scratchNotesEditorElement) return;
    const previousScrollTop = scratchNotesEditorElement.scrollTop;
    const previousScrollLeft = scratchNotesEditorElement.scrollLeft;
    try {
      scratchNotesEditorElement.focus({ preventScroll: true });
    } catch {
      try {
        scratchNotesEditorElement.focus();
      } catch {
        /* ignore focus errors */
      }
    }
    try {
      if (command === 'fontSizePx') {
        applyPixelFontSize(value);
      } else if (command === 'foreColor' || command === 'hiliteColor' || command === 'backColor') {
        try {
          document.execCommand('styleWithCSS', false, true);
        } catch {
          /* ignore styleWithCSS errors */
        }
      }
      document.execCommand(command, false, value);
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
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        scratchNotesEditorElement.scrollTop = previousScrollTop;
        scratchNotesEditorElement.scrollLeft = previousScrollLeft;
      });
    } else {
      scratchNotesEditorElement.scrollTop = previousScrollTop;
      scratchNotesEditorElement.scrollLeft = previousScrollLeft;
    }
  };

  let isHandlingClipboardPaste = false;

  const getPlainTextFromClipboard = (clipboardData) => {
    if (!clipboardData || typeof clipboardData.getData !== 'function') {
      return null;
    }

    const plainText = clipboardData.getData('text/plain');
    if (typeof plainText === 'string' && plainText.length > 0) {
      return plainText;
    }

    const htmlText = clipboardData.getData('text/html');
    if (typeof htmlText !== 'string' || !htmlText.trim()) {
      return null;
    }

    const temp = document.createElement('div');
    temp.innerHTML = htmlText;
    const extractedText = (temp.textContent || temp.innerText || '').replace(/\r\n?/g, '\n');
    return extractedText.length > 0 ? extractedText : null;
  };

  const insertPlainTextAtSelection = (text = '') => {
    if (!scratchNotesEditorElement || typeof text !== 'string' || !text.length) {
      return;
    }

    try {
      scratchNotesEditorElement.focus({ preventScroll: true });
    } catch {
      try {
        scratchNotesEditorElement.focus();
      } catch {
        /* ignore focus errors */
      }
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      const fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(scratchNotesEditorElement);
      fallbackRange.collapse(false);
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(fallbackRange);
      }
    }

    const activeSelection = window.getSelection();
    if (!activeSelection || activeSelection.rangeCount === 0) {
      return;
    }

    const range = activeSelection.getRangeAt(0);
    const normalizedText = text.replace(/\r\n?/g, '\n');
    const fragment = document.createDocumentFragment();
    const lines = normalizedText.split('\n');

    lines.forEach((line, index) => {
      if (index > 0) {
        fragment.appendChild(document.createElement('br'));
      }
      if (line.length > 0) {
        fragment.appendChild(document.createTextNode(line));
      }
    });

    range.deleteContents();
    range.insertNode(fragment);
    range.collapse(false);
    activeSelection.removeAllRanges();
    activeSelection.addRange(range);
    updateCurrentNoteSections(getEditorBodyHtml());
    try {
      scratchNotesEditorElement.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      /* ignore synthetic input errors */
    }
    updateToolbarState();
    if (typeof autoSave === 'function') {
      autoSave();
    }
  };

  // Wire up formatting toolbar controls while preserving the editor selection.
  const toolbarEl = document.getElementById('scratchNotesToolbar');
  if (toolbarEl && scratchNotesEditorElement) {
    const closeToolbarMenus = (menuToKeep = null) => {
      toolbarEl.querySelectorAll('.rte-menu').forEach((menu) => {
        if (menu === menuToKeep) {
          return;
        }
        const trigger = menu.querySelector('.rte-menu-trigger');
        const panel = menu.querySelector('.rte-menu-panel');
        if (trigger instanceof HTMLButtonElement) {
          trigger.setAttribute('aria-expanded', 'false');
        }
        if (panel instanceof HTMLElement) {
          panel.hidden = true;
        }
      });
    };

    toolbarEl.addEventListener('mousedown', (event) => {
      if (event.target.closest('.rte-menu-trigger, .rte-menu-option')) {
        event.preventDefault();
      }
    });

    toolbarEl.addEventListener('click', (event) => {
      const menuTrigger = event.target.closest('.rte-menu-trigger');
      if (menuTrigger instanceof HTMLButtonElement) {
        event.preventDefault();
        const menu = menuTrigger.closest('.rte-menu');
        const panel = menu?.querySelector('.rte-menu-panel');
        if (menu instanceof HTMLElement && panel instanceof HTMLElement) {
          const shouldOpen = panel.hidden;
          closeToolbarMenus(shouldOpen ? menu : null);
          panel.hidden = !shouldOpen;
          menuTrigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
          const moreMenu = toolbarEl.querySelector('.rte-more');
          if (shouldOpen && moreMenu && 'open' in moreMenu) {
            moreMenu.open = false;
          }
        }
        return;
      }

      const textStyleButton = event.target.closest('.rte-text-style-option[data-text-style]');
      if (textStyleButton instanceof HTMLButtonElement) {
        event.preventDefault();
        applyTextStyle(textStyleButton.dataset.textStyle);
        closeToolbarMenus();
        return;
      }

      const commandButton = event.target.closest('[data-cmd]');
      if (!(commandButton instanceof HTMLButtonElement)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const command = commandButton.getAttribute('data-cmd');
      if (command) {
        applyFormatCommand(command);
        closeToolbarMenus();
        const moreMenu = commandButton.closest('.rte-more');
        if (moreMenu && 'open' in moreMenu) {
          moreMenu.open = false;
        }
      }
    });

    document.addEventListener('click', (event) => {
      if (!toolbarEl.contains(event.target)) {
        closeToolbarMenus();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeToolbarMenus();
      }
    });
  }

  const textColorInputEl = document.getElementById('rteTextColor');
  if (textColorInputEl instanceof HTMLInputElement) {
    textColorInputEl.addEventListener('input', () => {
      const value = textColorInputEl.value || '#1e293b';
      applyFormatCommand('foreColor', value);
    });
  }

  const highlightColorInputEl = document.getElementById('rteHighlightColor');
  if (highlightColorInputEl instanceof HTMLInputElement) {
    highlightColorInputEl.addEventListener('input', () => {
      const value = highlightColorInputEl.value || '#fff59d';
      const highlightCommand =
        typeof document.queryCommandSupported === 'function' && document.queryCommandSupported('hiliteColor')
          ? 'hiliteColor'
          : 'backColor';
      applyFormatCommand(highlightCommand, value);
    });
  }

  if (scratchNotesEditorElement instanceof HTMLElement) {
    scratchNotesEditorElement.addEventListener('beforeinput', (event) => {
      if (!event || event.inputType !== 'insertText' || typeof event.data !== 'string') {
        return;
      }
      if (insertPendingFontSizeText(event.data)) {
        event.preventDefault();
        try {
          scratchNotesEditorElement.dispatchEvent(new Event('input', { bubbles: true }));
        } catch {
          /* ignore synthetic input errors */
        }
      }
    });

    const handleClipboardPaste = (event, clipboardData) => {
      if (isHandlingClipboardPaste) {
        return;
      }

      const plainText = getPlainTextFromClipboard(clipboardData);
      if (plainText === null) {
        return;
      }

      isHandlingClipboardPaste = true;
      event.preventDefault();
      insertPlainTextAtSelection(plainText);
      window.setTimeout(() => {
        isHandlingClipboardPaste = false;
      }, 0);
    };

    scratchNotesEditorElement.addEventListener('paste', (event) => {
      handleClipboardPaste(event, event.clipboardData || window.clipboardData);
    });

    scratchNotesEditorElement.addEventListener('beforeinput', (event) => {
      if (!event || event.inputType !== 'insertFromPaste') {
        return;
      }

      handleClipboardPaste(event, event.dataTransfer || event.clipboardData || window.clipboardData);
    });
  }

  const getEditorBodyHtml = () => {
    if (scratchNotesEditorElement instanceof HTMLElement) {
      normalizeEditorFontSizes();
      const focusedBody = scratchNotesEditorElement.dataset.noteSectionFocusBody;
      if (typeof focusedBody === 'string' && focusedBody.length > 0) {
        return focusedBody;
      }
    }
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
    if (scratchNotesEditorElement instanceof HTMLElement) {
      delete scratchNotesEditorElement.dataset.noteSectionFocusBody;
      delete scratchNotesEditorElement.dataset.noteSectionFocusLabel;
      delete scratchNotesEditorElement.dataset.noteSectionFocused;
    }
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

  const getCurrentEditorBodyText = () => {
    if (!(scratchNotesEditorElement instanceof HTMLElement)) {
      return '';
    }
    const liveText = scratchNotesEditorElement.dataset.noteSectionFocusText
      || scratchNotesEditorElement.innerText
      || scratchNotesEditorElement.textContent
      || '';
    return liveText.replace(/\s+/g, ' ').trim();
  };

  const normalizeSectionLabel = (value = '') => value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[:\-\u2013\u2014]+$/, '')
    .trim();

  const formatSectionLabel = (value = '') => {
    const normalized = normalizeSectionLabel(value);
    if (!normalized) {
      return '';
    }
    return normalized
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  };

  const extractMarkdownSectionLabel = (rawText = '') => {
    const markdownMatch = String(rawText || '').trim().match(/^\s{0,3}(#{1,6})\s*(.+?)\s*#*\s*$/);
    if (!markdownMatch?.[2]) {
      return '';
    }

    const headingText = markdownMatch[2]
      .replace(/\s+/g, ' ')
      .trim();
    if (!headingText || headingText.length > 80) {
      return '';
    }

    return formatSectionLabel(headingText);
  };

  // Build a lightweight section index from markdown headings inside the note.
  const buildNoteSectionsFromHtml = (html = '') => {
    const temp = document.createElement('div');
    temp.innerHTML = typeof html === 'string' ? html : '';
    const sections = [];
    const seenLabels = new Set();
    const appendSectionLabel = (value = '', kind = 'label') => {
      const label = formatSectionLabel(value);
      if (!label) {
        return;
      }

      const normalizedKey = label.toLowerCase();
      if (seenLabels.has(normalizedKey)) {
        return;
      }
      seenLabels.add(normalizedKey);
      sections.push({
        id: `section-${normalizedKey.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || sections.length + 1}`,
        label,
        kind,
      });
    };

    const nodes = Array.from(temp.childNodes || []);
    nodes.forEach((node) => {
      const nodeText = String(node?.textContent || '').trim();
      if (!nodeText) {
        return;
      }
      nodeText
        .split(/\r?\n+/)
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .forEach((line) => {
          const label = extractMarkdownSectionLabel(line);
          if (!label) {
            return;
          }
          appendSectionLabel(label, 'markdown');
        });
    });

    return sections;
  };

  const setEditorContent = (value = '') => {
    const normalizedValue = typeof value === 'string' ? value : '';
    setEditorBodyHtml(normalizedValue);
    updateCurrentNoteSections(normalizedValue);
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

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const debounce = (fn, delay = 200) => {
    let timeoutId;
    const debounced = (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        timeoutId = null;
        fn(...args);
      }, delay);
    };
    debounced.cancel = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    return debounced;
  };

  let currentNoteId = null;
  let currentTeacherView = 'plan';
  // Assigned from initMobileNotesEditorUi() below; flushes a pending autosave before a note switch.
  let flushNoteAutoSave = () => {};
  let resizeNoteTitleInput = () => {};
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
  let currentNoteSections = [];
  let noteSectionsInputTimeoutId = null;

  const updateCurrentNoteSections = (html = getEditorBodyHtml()) => {
    currentNoteSections = buildNoteSectionsFromHtml(html);
    if (scratchNotesEditorElement instanceof HTMLElement) {
      scratchNotesEditorElement.dataset.sectionCount = String(currentNoteSections.length);
      scratchNotesEditorElement.dataset.sectionLabels = currentNoteSections
        .map((section) => section.label)
        .join('|');
    }
  };

  const scheduleCurrentNoteSectionsUpdate = () => {
    if (noteSectionsInputTimeoutId) {
      clearTimeout(noteSectionsInputTimeoutId);
    }
    noteSectionsInputTimeoutId = setTimeout(() => {
      noteSectionsInputTimeoutId = null;
      updateCurrentNoteSections();
    }, 250);
  };

  try {
    scratchNotesEditorElement.addEventListener('input', scheduleCurrentNoteSectionsUpdate);
  } catch {
    /* ignore section index errors */
  }

  const getCurrentNoteSections = () => currentNoteSections.slice();

  const clearSearchFilter = () => {
    filterQuery = '';
    if (filterInput) {
      filterInput.value = '';
    }
  };

  updateCurrentNoteSections('');

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
      const hasActiveFilter = Boolean((notesOverviewQuery || '').trim())
        || (notesOverviewStateValue || 'all').toLowerCase() !== 'all';
      const empty = document.createElement('div');
      empty.className = 'notes-overview-empty';

      const title = document.createElement('h3');
      title.className = 'notes-overview-empty-title';
      title.textContent = hasActiveFilter ? 'No notes found' : 'No saved notes yet';
      empty.appendChild(title);

      const copy = document.createElement('p');
      copy.className = 'notes-overview-empty-copy';
      copy.textContent = hasActiveFilter
        ? 'Try a different search.'
        : 'Your notes will appear here as soon as you start writing.';
      empty.appendChild(copy);

      if (!hasActiveFilter) {
        const startButton = document.createElement('button');
        startButton.type = 'button';
        startButton.className = 'note-inline-action';
        startButton.textContent = 'Start a note';
        startButton.addEventListener('click', () => {
          applyNotesMode('notebooks');
          document.getElementById('newNoteMobile')?.click();
        });
        empty.appendChild(startButton);
      }

      notesOverviewList.appendChild(empty);
      return;
    }

    items.slice(0, 30).forEach((note) => {
      const item = document.createElement('article');
      item.className = 'notes-overview-item';
      item.dataset.noteId = note.id;
      const safeTitle = note?.title || 'Untitled note';

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'notes-overview-item-main';
      openButton.dataset.noteId = note.id;
      openButton.innerHTML = `
        <div class="notes-overview-item-title-row">
          <div class="notes-overview-item-title">${escapeHtml(safeTitle)}</div>
          ${note?.pinned ? '<span class="notes-overview-pinned-label">Pinned</span>' : ''}
        </div>
      `;
      openButton.addEventListener('click', () => {
        setEditorValues(note);
        updateListSelection();
        applyNotesMode('notebooks');
        const notebooksBtn = document.getElementById('mobile-footer-notebooks');
        if (notebooksBtn instanceof HTMLElement) {
          notebooksBtn.click();
        }
      });

      const actionsButton = document.createElement('button');
      actionsButton.type = 'button';
      actionsButton.className = 'notes-overview-item-actions note-options-button';
      actionsButton.dataset.role = 'note-menu';
      actionsButton.dataset.noteId = note.id;
      actionsButton.setAttribute('aria-label', `Actions for ${safeTitle}`);
      actionsButton.setAttribute('aria-haspopup', 'menu');
      actionsButton.textContent = '\u22ef';
      actionsButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openNoteOptionsMenu(note.id, actionsButton);
      });

      item.appendChild(openButton);
      item.appendChild(actionsButton);
      notesOverviewList.appendChild(item);
    });
    updateListSelection();
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
    const { isNew = false, teacherView = null, force = false } = options;
    const nextTeacherView = note ? resolveTeacherView(note, teacherView || currentTeacherView) : 'plan';
    if (note && currentNoteId === note.id && !isNew && nextTeacherView === currentTeacherView && !force) {
      renderRelatedNotes(note);
      return;
    }
    // Switching to a different note (or clearing the editor): persist the outgoing note's
    // pending edits now, before its content is replaced, so a debounced autosave can't fire
    // later against the new note and silently drop the previous note's changes.
    if (currentNoteId && (!note || note.id !== currentNoteId)) {
      flushNoteAutoSave();
    }
    if (!note) {
      currentTeacherView = 'plan';
      currentNoteIsNew = false;
      currentNoteHasChanged = false;
      currentNoteId = null;
      titleInput.value = '';
      resizeNoteTitleInput();
      setEditorContent('');
      setEditorReadOnlyState(false);
      delete titleInput.dataset.noteOriginalTitle;
      scratchNotesEditorElement.dataset.noteOriginalBody = getEditorHTML();
      syncNoteFolderButtonLabel(currentEditingNoteFolderId);
      renderRelatedNotes(null);
      return;
    }
    currentTeacherView = nextTeacherView;
    currentNoteIsNew = Boolean(isNew);
    currentNoteHasChanged = false;
    currentNoteId = note.id;
    const nextTitle = note.title || '';
    const preferredHtml = currentTeacherView === 'cue'
      ? (typeof note?.metadata?.lessonCueHtml === 'string' ? note.metadata.lessonCueHtml : null)
      : typeof note.bodyHtml === 'string'
        ? note.bodyHtml
        : null;
    const fallbackBody = typeof note.body === 'string' ? note.body : '';
    const cueFallbackBody = typeof note?.metadata?.lessonCueBody === 'string' ? note.metadata.lessonCueBody : '';
    const nextBody = currentTeacherView === 'cue'
      ? (preferredHtml ?? cueFallbackBody) || ''
      : (preferredHtml ?? fallbackBody) || '';
    titleInput.value = isNew ? '' : nextTitle;
    resizeNoteTitleInput();
    setEditorContent(isNew ? '' : nextBody);
    setEditorReadOnlyState(currentTeacherView === 'cue');
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

  const hasEmbeddedLessonCue = (note) => (
    typeof note?.metadata?.lessonCueBody === 'string' && note.metadata.lessonCueBody.trim().length > 0
  );

  const resolveTeacherView = (note, requestedView = currentTeacherView) => {
    if (requestedView === 'cue' && hasEmbeddedLessonCue(note)) {
      return 'cue';
    }
    return 'plan';
  };

  const setEditorReadOnlyState = (isReadOnly = false) => {
    if (titleInput instanceof HTMLElement) {
      titleInput.readOnly = isReadOnly;
    }
    if (scratchNotesEditorElement instanceof HTMLElement) {
      scratchNotesEditorElement.contentEditable = isReadOnly ? 'false' : 'true';
      scratchNotesEditorElement.setAttribute('aria-readonly', isReadOnly ? 'true' : 'false');
    }
    if (saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = isReadOnly;
    }
    if (noteFolderBtn instanceof HTMLButtonElement) {
      noteFolderBtn.disabled = isReadOnly;
    }
    if (toolbarEl instanceof HTMLElement) {
      toolbarEl.classList.toggle('opacity-50', isReadOnly);
      toolbarEl.classList.toggle('pointer-events-none', isReadOnly);
    }
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

  const openNoteFromDashboard = (noteId, options = {}) => {
    if (!noteId) {
      return;
    }
    const note = allNotes.find((item) => item?.id === noteId);
    if (!note) {
      return;
    }

    setEditorValues(note, {
      teacherView: options?.teacherView || 'plan',
      force: options?.force === true,
    });
    applyNotesMode('notebooks');
    updateListSelection();
    if (isSavedNotesSheetOpen()) {
      hideSavedNotesSheet();
    }

    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'notebooks' } }));
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
          button.textContent = `\u2022 ${getDashboardItemLabel(note)}`;
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
    if (!listElement && !(notesOverviewList instanceof HTMLElement)) {
      return;
    }
    const buttons = listElement?.querySelectorAll('[data-role="open-note"][data-note-id]') || [];
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

    if (notesOverviewList instanceof HTMLElement) {
      const overviewItems = notesOverviewList.querySelectorAll('.notes-overview-item[data-note-id]');
      overviewItems.forEach((item) => {
        if (!(item instanceof HTMLElement)) {
          return;
        }
        const isActive = item.dataset.noteId === currentNoteId;
        item.classList.toggle('is-active', isActive);
        item.setAttribute('aria-current', isActive ? 'true' : 'false');
      });
    }
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
      return `Today \u00b7 ${timeString}`;
    }
    const dateString = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateString} \u00b7 ${timeString}`;
  };

  const hasUnsavedChanges = () => {
    if (currentTeacherView === 'cue') {
      return false;
    }
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
    const bodyText =
      scratchNotesEditorElement instanceof HTMLElement
        ? (scratchNotesEditorElement.textContent || scratchNotesEditorElement.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
        : getEditorText();
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

  const handleDeleteNote = async (noteId) => {
    const removed = await removeSavedNoteById(noteId);
    if (!removed) {
      return false;
    }
    updateStoredSnapshot();

    if (currentNoteId === noteId) {
      setEditorValues(null);
      skipAutoSelectOnce = true;
    }

    refreshFromStorage({ preserveDraft: false });
    return true;
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
        pinIcon.textContent = '\ud83d\udccc';
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
      actionBtn.textContent = '\u22ee';

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
        overflowBtn.innerHTML = '\u22ef';
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

  const noteFolderBtn =
    document.getElementById('note-folder-button') ||
    document.getElementById('noteFolderPillMobile');
  let setAfterFolderCreated = () => {};
  let openNewFolderDialog = () => {};
  let syncNoteFolderButtonLabel = () => {};
  let closeOverflowMenu = () => {};
  let handleMoveNoteToFolder = () => {};
  let openFolderOverflowMenu = () => {};
  let afterFolderCreated = null;

  ({
    setAfterFolderCreated,
    openNewFolderDialog,
    syncNoteFolderButtonLabel,
    closeOverflowMenu,
    handleMoveNoteToFolder,
    openFolderOverflowMenu,
  } = initMobileNotesFolderManager({
    folderFilterNewButton,
    newFolderModalEl: document.getElementById('newFolderModal'),
    newFolderNameInput: document.getElementById('newFolderName'),
    newFolderError: document.getElementById('newFolderError'),
    newFolderCreateBtn: document.getElementById('newFolderCreate'),
    newFolderCancelBtn: document.getElementById('newFolderCancel'),
    noteFolderBtn,
    renameFolderModalEl: document.getElementById('renameFolderModal'),
    renameFolderNameInput: document.getElementById('renameFolderName'),
    renameFolderError: document.getElementById('renameFolderError'),
    renameFolderSaveBtn: document.getElementById('renameFolderSave'),
    renameFolderCancelBtn: document.getElementById('renameFolderCancel'),
    deleteFolderModalEl: document.getElementById('deleteFolderModal'),
    deleteFolderConfirmBtn: document.getElementById('deleteFolderConfirm'),
    deleteFolderCancelBtn: document.getElementById('deleteFolderCancel'),
    getFolders,
    saveFolders,
    getFolderNameById,
    assignNoteToFolder,
    buildFolderChips,
    buildFolderFilterSelect,
    renderFilteredNotes: () => renderFilteredNotes(),
    refreshFromStorage,
    showMoveToast,
    loadAllNotes,
    saveAllNotes,
    clearSearchFilter,
    getCurrentNoteId: () => currentNoteId,
    getCurrentTeacherView: () => currentTeacherView,
    getCurrentEditingNoteFolderId: () => currentEditingNoteFolderId,
    setCurrentEditingNoteFolderId: (value) => {
      currentEditingNoteFolderId = value;
    },
    getCurrentFolderId: () => currentFolderId,
    setCurrentFolderId: (value) => {
      currentFolderId = value;
    },
  }));

  // Legacy folder modal and overflow wiring lives in src/ui/mobileNotesFolderManager.js.

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
        openNoteOptionsMenu(noteId, menuTrigger);
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
          setEditorValues(note, { teacherView: 'plan' });
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
        openNoteOptionsMenu(noteId, menuTrigger);
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
    getCurrentNoteSections,
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
    flushCurrentNote: () => flushNoteAutoSave(),
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
    onOpenNoteFromDashboard: (noteId, options = {}) => {
      openNoteFromDashboard(noteId, options);
    },
    onOpenTeacherNoteView: (noteId, teacherView = 'plan') => {
      openNoteFromDashboard(noteId, { teacherView, force: true });
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

  if (noteFolderBtn) {
    noteFolderBtn.addEventListener('click', (event) => {
      event.preventDefault();
      openFolderSelectorForNote(currentNoteId, {
        initialFolderId: currentEditingNoteFolderId,
        triggerEl: noteFolderBtn,
      });
    });
  }

  if (typeof window !== 'undefined') {
    window.getCurrentNoteSections = getCurrentNoteSections;
  }

  initMobileNotesBrowserUi({
    filterInput,
    notesOverviewSearch,
    notesOverviewSort,
    notesOverviewState,
    notebookBrowserList,
    folderFilterSelect,
    debounce,
    getFolders,
    normalizeFolderId,
    setCurrentFolderId: (value) => {
      currentFolderId = value;
    },
    setFilterQuery: (value) => {
      filterQuery = value;
    },
    setNotesOverviewQuery: (value) => {
      notesOverviewQuery = value;
    },
    setNotesOverviewSortValue: (value) => {
      notesOverviewSortValue = value;
    },
    setNotesOverviewStateValue: (value) => {
      notesOverviewStateValue = value;
    },
    setActiveFolderFilter,
    setActiveFolderChip,
    renderFilteredNotes: () => renderFilteredNotes(),
    renderNotesOverview,
    applyNotesMode,
    getNotesMode: () => notesMode,
  });
  // Legacy notebook browser wiring lives in src/ui/mobileNotesBrowserUi.js.

  const applyInitialSelection = () => {
    refreshFromStorage({ preserveDraft: false });
  };

  const footerNewNoteBtn = document.getElementById('mobile-footer-new-note');
  const newNoteButton = document.getElementById('newNoteMobile');
  const fabNewNoteButton = document.getElementById('mobile-fab-new-note');

  const {
    openNoteEditorForNewNote,
    startNewNoteFromUI,
    flushAutoSave: editorFlushAutoSave,
    resizeTitleInput: editorResizeTitleInput,
  } = initMobileNotesEditorUi({
    saveButton,
    titleInput,
    scratchNotesEditorElement,
    footerNewNoteBtn,
    newNoteButton,
    fabNewNoteButton,
    debounce,
    createNote,
    loadAllNotes,
    saveAllNotes,
    getEditorBodyHtml,
    getEditorBodyText: getCurrentEditorBodyText,
    getCurrentNoteId: () => currentNoteId,
    setCurrentNoteId: (value) => {
      currentNoteId = value;
    },
    getCurrentFolderId: () => currentFolderId,
    getCurrentEditingNoteFolderId: () => currentEditingNoteFolderId,
    setCurrentEditingNoteFolderId: (value) => {
      currentEditingNoteFolderId = value;
    },
    getCurrentNoteIsNew: () => currentNoteIsNew,
    setCurrentNoteIsNew: (value) => {
      currentNoteIsNew = value;
    },
    getCurrentNoteHasChanged: () => currentNoteHasChanged,
    setCurrentNoteHasChanged: (value) => {
      currentNoteHasChanged = value;
    },
    hasMeaningfulContent,
    hasUnsavedChanges,
    resetEditorScroll,
    setEditorValues,
    updateListSelection,
    updateStoredSnapshot,
    refreshFromStorage,
    syncNoteFolderButtonLabel,
    updateToolbarState,
    handleListShortcuts,
    handleFormattingShortcuts,
  });

  if (typeof editorFlushAutoSave === 'function') {
    flushNoteAutoSave = editorFlushAutoSave;
  }
  if (typeof editorResizeTitleInput === 'function') {
    resizeNoteTitleInput = editorResizeTitleInput;
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
