import { executeCommand } from '../core/commandEngine.js';
import { processInbox as runInboxProcessor } from '../ai/inboxProcessor.js';
import { createReminder } from '../services/reminderService.js';
import { getInboxEntries, removeInboxEntry, saveInboxEntry } from '../services/inboxService.js';
import { saveMemory } from '../services/memoryService.js?v=20260323a';
import { captureInput } from '../core/capturePipeline.js?v=20260323a';
import { dispatchReminderSheetOpen } from './quickCapture.js';

const categories = ['Inbox', 'Teaching', 'Coaching', 'Ideas', 'Tasks'];

const getEntryText = (entry) => {
  if (!entry || typeof entry !== 'object') return 'Untitled entry';
  const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : '';
  const text = typeof entry.text === 'string' && entry.text.trim() ? entry.text.trim() : '';
  const content = typeof entry.content === 'string' && entry.content.trim() ? entry.content.trim() : '';
  const body = typeof entry.body === 'string' && entry.body.trim() ? entry.body.trim() : '';
  return title || text || content || body || 'Untitled entry';
};

const getEntryCategory = (entry) => {
  const category = typeof entry?.category === 'string' ? entry.category.trim() : '';
  return category || 'inbox';
};

const getEntryCreatedDate = (entry) => {
  const value = entry?.createdAt || entry?.created || entry?.date;
  if (!value) return 'Unknown date';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString();
};

export function initInboxUI() {
  const openButton = document.getElementById('openCategoriesView');
  const backButton = document.getElementById('categoriesBackButton');
  const cardGrid = document.getElementById('categoryCardGrid');
  const entriesPanel = document.getElementById('categoryEntriesPanel');
  const entriesTitle = document.getElementById('categoryEntriesTitle');
  const entriesList = document.getElementById('categoryEntriesList');
  const inboxEntriesList = document.getElementById('inboxEntriesList');
  const processInboxButton = document.getElementById('processInboxButton');

  if (!(cardGrid instanceof HTMLElement) || !(entriesList instanceof HTMLElement) || !(inboxEntriesList instanceof HTMLElement)) return;

  const readEntries = () => getInboxEntries();

  const renderCategoryEntries = (categoryName) => {
    entriesTitle.textContent = categoryName;
    entriesList.innerHTML = '';
    const matchingEntries = readEntries().filter((entry) => getEntryCategory(entry).toLowerCase() === categoryName.toLowerCase());
    matchingEntries.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'category-entry-item';
      item.textContent = getEntryText(entry);
      entriesList.appendChild(item);
    });
    entriesPanel?.classList.remove('hidden');
  };

  const convertToReminder = async (entry) => {
    await captureInput({ text: getEntryText(entry), source: 'inbox' });
    dispatchReminderSheetOpen(null, getEntryText(entry));
  };

  const convertToNote = async (entry) => {
    await saveMemory({
      text: getEntryText(entry),
      type: 'note',
      source: 'inbox',
      entryPoint: 'inboxUI.convertToNote',
    });
  };

  const renderInboxEntries = () => {
    const allEntries = readEntries();
    const inboxEntries = allEntries.filter((entry) => getEntryCategory(entry).toLowerCase() === 'inbox');
    inboxEntriesList.innerHTML = '';

    if (!inboxEntries.length) {
      const empty = document.createElement('li');
      empty.className = 'text-sm opacity-70';
      empty.textContent = 'No inbox entries yet.';
      inboxEntriesList.appendChild(empty);
      return;
    }

    inboxEntries.forEach((entry) => {
      const card = document.createElement('li');
      card.className = 'card bg-base-100 shadow p-3 gap-2';

      const text = document.createElement('p');
      text.className = 'text-sm';
      text.textContent = getEntryText(entry);

      const meta = document.createElement('div');
      meta.className = 'text-xs opacity-60';
      meta.textContent = getEntryCreatedDate(entry);

      const actions = document.createElement('div');
      actions.className = 'flex gap-2 flex-wrap';

      const reminderBtn = document.createElement('button');
      reminderBtn.type = 'button';
      reminderBtn.className = 'btn btn-xs';
      reminderBtn.textContent = 'Reminder';
      reminderBtn.addEventListener('click', () => void convertToReminder(entry));

      const noteBtn = document.createElement('button');
      noteBtn.type = 'button';
      noteBtn.className = 'btn btn-xs btn-outline';
      noteBtn.textContent = 'Note';
      noteBtn.addEventListener('click', () => void convertToNote(entry));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-xs btn-outline';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        removeInboxEntry(entry?.id);
        renderInboxEntries();
      });

      actions.append(reminderBtn, noteBtn, deleteBtn);
      card.append(text, meta, actions);
      inboxEntriesList.appendChild(card);
    });
  };

  const processInboxHandler = async () => {
    const inboxEntries = readEntries();
    const result = await runInboxProcessor(inboxEntries, {
      createReminder: async (payload) => createReminder(payload),
      removeInboxEntry: (id) => removeInboxEntry(id),
    });
    renderInboxEntries();
    if (result?.summary) window.alert(result.summary);
    return Array.isArray(result?.processedItems) ? result.processedItems : [];
  };

  async function processInbox() {
    if (processInboxButton) {
      processInboxButton.disabled = true;
      processInboxButton.textContent = 'Processing...';
    }

    try {
      await executeCommand('processInbox', { handler: processInboxHandler });
    } catch (error) {
      console.error('Unable to process inbox entries.', error);
    } finally {
      if (processInboxButton) {
        processInboxButton.disabled = false;
        processInboxButton.textContent = 'Process Notes';
      }
    }
  }

  const renderCategoryCards = () => {
    cardGrid.innerHTML = '';
    categories.forEach((categoryName) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-card-button';
      button.textContent = categoryName;
      button.addEventListener('click', () => {
        renderCategoryEntries(categoryName);
      });
      cardGrid.appendChild(button);
    });
  };

  openButton?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'categories' } }));
  });
  backButton?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'reminders' } }));
  });

  processInboxButton?.addEventListener('click', processInbox);
  document.addEventListener('memoryCue:entriesUpdated', renderInboxEntries);
  window.addEventListener('storage', (event) => {
    if (event.key === 'memoryCueInbox') renderInboxEntries();
  });

  renderCategoryCards();
  renderInboxEntries();

  // Preserve compatibility for older callers.
  window.memoryCueSaveInboxEntry = (entry) => saveInboxEntry(entry);
}

export function renderInbox() {
  initInboxUI();
}
