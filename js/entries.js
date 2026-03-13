(function wireQuickReminderShortcut() {
  const dispatchReminderSheetOpen = (trigger, prefillText = '') => {
    const detail = {
      mode: 'create',
      trigger: trigger instanceof HTMLElement ? trigger : null,
      prefillText,
    };

    try {
      document.dispatchEvent(new CustomEvent('open-reminder-sheet', { detail }));
      document.dispatchEvent(new CustomEvent('cue:prepare', { detail }));
      document.dispatchEvent(new CustomEvent('cue:open', { detail }));
    } catch (error) {
      console.warn('Failed to open reminder sheet', error);
    }

    const focusEditor = () => {
      const reminderText = document.getElementById('reminderText');
      if (!(reminderText instanceof HTMLElement)) return;
      try {
        reminderText.focus({ preventScroll: true });
      } catch (error) {
        reminderText.focus();
      }
      if (prefillText && reminderText instanceof HTMLInputElement) {
        reminderText.value = prefillText;
        reminderText.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    document.addEventListener('reminder:sheet-opened', focusEditor, { once: true });
  };

  const init = () => {
    const quickForm = document.getElementById('quickAddForm');
    const quickInput = document.getElementById('reminderQuickAdd');
    const voiceButton = document.getElementById('startVoiceCaptureGlobal');

    const startVoiceCapture = () => {
      if (!(quickInput instanceof HTMLInputElement)) {
        return;
      }

      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (typeof SpeechRecognition !== 'function') {
        window.alert('Voice capture not supported on this device.');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.lang = document.documentElement.lang || 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        const transcript = event?.results?.[0]?.[0]?.transcript;
        if (typeof transcript !== 'string') {
          return;
        }

        quickInput.value = transcript.trim();
        quickInput.dispatchEvent(new Event('input', { bubbles: true }));

        try {
          quickInput.focus({ preventScroll: true });
        } catch (error) {
          quickInput.focus();
        }
      };

      recognition.onerror = (event) => {
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          window.alert('Voice capture not supported on this device.');
        }
      };

      recognition.start();
    };

    document.addEventListener('click', (event) => {
      const trigger = event.target instanceof Element
        ? event.target.closest('[data-trigger="open-cue"]')
        : null;
      if (!(trigger instanceof HTMLElement)) return;

      event.preventDefault();
      dispatchReminderSheetOpen(trigger);
    });

    if (!(quickForm instanceof HTMLFormElement) || !(quickInput instanceof HTMLInputElement)) {
      if (voiceButton instanceof HTMLElement) {
        voiceButton.addEventListener('click', startVoiceCapture);
      }
      return;
    }

    if (voiceButton instanceof HTMLElement) {
      voiceButton.addEventListener('click', startVoiceCapture);
    }

    if (typeof window.memoryCueQuickAddNow !== 'function') {
      quickForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = (quickInput.value || '').trim();
        if (!text) return;
        dispatchReminderSheetOpen(quickInput, text);
      });
    }

  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

(function () {
  const categories = ['Inbox', 'Teaching', 'Coaching', 'Ideas', 'Tasks'];
  const openButton = document.getElementById('openCategoriesView');
  const backButton = document.getElementById('categoriesBackButton');
  const cardGrid = document.getElementById('categoryCardGrid');
  const entriesPanel = document.getElementById('categoryEntriesPanel');
  const entriesTitle = document.getElementById('categoryEntriesTitle');
  const entriesList = document.getElementById('categoryEntriesList');
  const inboxEntriesList = document.getElementById('inboxEntriesList');
  const processInboxButton = document.getElementById('processInboxButton');

  if (!(cardGrid instanceof HTMLElement) || !(entriesList instanceof HTMLElement) || !(inboxEntriesList instanceof HTMLElement)) {
    return;
  }

  const readEntries = () => {
    if (window.MemoryCueCaptureService && typeof window.MemoryCueCaptureService.getInboxEntries === 'function') {
      return window.MemoryCueCaptureService.getInboxEntries();
    }
    return [];
  };

  const removeEntry = (id) => {
    if (window.MemoryCueCaptureService && typeof window.MemoryCueCaptureService.removeInboxEntry === 'function') {
      return window.MemoryCueCaptureService.removeInboxEntry(id);
    }
    return false;
  };

  const writeEntries = (entries) => {
    try {
      window.localStorage?.setItem('memoryCueInbox', JSON.stringify(entries));
      document.dispatchEvent(new CustomEvent('memoryCue:entriesUpdated'));
    } catch (error) {
      console.warn('Unable to update memoryCueInbox in localStorage', error);
    }
  };

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

  const QUICK_ACTION_LONG_PRESS_MS = 500;
  let activeQuickActionsMenu = null;
  let activeQuickActionsCleanup = null;

  const closeQuickActionsMenu = () => {
    if (typeof activeQuickActionsCleanup === 'function') {
      activeQuickActionsCleanup();
    }
    activeQuickActionsCleanup = null;
    if (activeQuickActionsMenu instanceof HTMLElement) {
      activeQuickActionsMenu.remove();
    }
    activeQuickActionsMenu = null;
  };

  const sendToAssistant = (text) => {
    const assistantFormEl = document.getElementById('assistantForm');
    const assistantInputEl = document.getElementById('assistantInput');
    const isAssistantInput = assistantInputEl instanceof HTMLInputElement || assistantInputEl instanceof HTMLTextAreaElement;
    if (!(assistantFormEl instanceof HTMLFormElement) || !isAssistantInput) {
      return false;
    }

    if (window.navigationService && typeof window.navigationService.navigate === 'function') {
      window.navigationService.navigate('assistant');
    }

    assistantInputEl.value = text;
    assistantFormEl.requestSubmit();
    return true;
  };

  const convertToReminder = (entry) => {
    dispatchReminderSheetOpen(null, getEntryText(entry));
  };

  const convertToNote = (entry) => {
    if (window.MemoryCueCaptureService && typeof window.MemoryCueCaptureService.convertInboxToNote === 'function') {
      window.MemoryCueCaptureService.convertInboxToNote(String(entry?.id || ''));
      return;
    }

    appendToMainNotesDatabase([
      {
        id: `entry-${Date.now()}`,
        title: getEntryText(entry),
        body: getEntryText(entry),
        bodyHtml: getEntryText(entry),
        bodyText: getEntryText(entry),
        updatedAt: new Date().toISOString(),
      },
    ]);
  };

  const openInboxQuickActions = (entry) => {
    if (!(entry && typeof entry === 'object')) {
      return;
    }

    closeQuickActionsMenu();
    const menu = document.createElement('div');
    menu.className = 'quick-actions-menu';
    menu.setAttribute('role', 'menu');

    const allEntries = readEntries();
    const resolveEntryIndex = () => allEntries.findIndex((item) => (entry?.id && item?.id ? item.id === entry.id : item === entry));

    const runAction = (handler) => {
      handler();
      closeQuickActionsMenu();
      renderInboxEntries();
    };

    const actions = [
      {
        label: 'Create Reminder',
        action: () => convertToReminder(entry),
      },
      {
        label: 'Convert to Note',
        action: () => {
          convertToNote(entry);
        },
      },
      {
        label: 'Ask Assistant',
        action: () => {
          sendToAssistant(getEntryText(entry));
        },
      },
      {
        label: 'Archive',
        action: () => {
          const entryIndex = resolveEntryIndex();
          if (entryIndex === -1) return;
          removeEntry(String(allEntries[entryIndex]?.id || ''));
        },
      },
    ];

    actions.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = item.label.toLowerCase().replace(/\s+/g, '-');
      button.textContent = item.label;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        runAction(item.action);
      });
      menu.appendChild(button);
    });

    document.body.appendChild(menu);
    activeQuickActionsMenu = menu;

    const handleOutsidePress = (event) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (!menu.contains(event.target)) {
        closeQuickActionsMenu();
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeQuickActionsMenu();
      }
    };

    document.addEventListener('pointerdown', handleOutsidePress, true);
    document.addEventListener('keydown', handleEscape);
    activeQuickActionsCleanup = () => {
      document.removeEventListener('pointerdown', handleOutsidePress, true);
      document.removeEventListener('keydown', handleEscape);
    };
  };

  const attachInboxLongPress = (itemEl, entry) => {
    if (!(itemEl instanceof HTMLElement)) {
      return;
    }
    let pressTimer = null;

    const start = () => {
      pressTimer = window.setTimeout(() => {
        openInboxQuickActions(entry);
      }, QUICK_ACTION_LONG_PRESS_MS);
    };

    const cancel = () => {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
      }
      pressTimer = null;
    };

    itemEl.addEventListener('touchstart', start, { passive: true });
    itemEl.addEventListener('touchend', cancel);
    itemEl.addEventListener('touchcancel', cancel);
    itemEl.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      start();
    });
    itemEl.addEventListener('pointerup', cancel);
    itemEl.addEventListener('pointerleave', cancel);
  };

  const renderCategoryEntries = (categoryName) => {
    const targetCategory = String(categoryName || '').trim().toLowerCase();
    const entries = readEntries().filter((entry) => getEntryCategory(entry).toLowerCase() === targetCategory);

    entriesTitle.textContent = `${categoryName} entries`;
    entriesList.innerHTML = '';

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'text-sm opacity-70';
      empty.textContent = 'No entries found in this category.';
      entriesList.appendChild(empty);
    } else {
      entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'category-entry-item';
        item.textContent = getEntryText(entry);
        entriesList.appendChild(item);
      });
    }

    entriesPanel?.classList.remove('hidden');
  };

  const renderInboxEntries = () => {
    const entries = readEntries()
      .filter((entry) => getEntryCategory(entry).toLowerCase() === 'inbox')
      .sort((a, b) => {
        const left = Number(new Date(a?.createdAt || a?.created || a?.date || 0).getTime()) || 0;
        const right = Number(new Date(b?.createdAt || b?.created || b?.date || 0).getTime()) || 0;
        return left - right;
      });
    inboxEntriesList.innerHTML = '';

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'text-sm opacity-70';
      empty.textContent = 'No uncategorized entries in Inbox.';
      inboxEntriesList.appendChild(empty);
      return;
    }

    entries.forEach((entry, index) => {
      const card = document.createElement('article');
      card.className = 'category-entry-item space-y-2';

      const text = document.createElement('p');
      text.className = 'text-sm';
      text.textContent = getEntryText(entry);

      const meta = document.createElement('div');
      meta.className = 'text-xs opacity-70 flex items-center gap-2 flex-wrap';

      const typeTag = document.createElement('span');
      typeTag.className = 'badge badge-outline badge-sm';
      const entryType = typeof entry?.type === 'string' && entry.type.trim() ? entry.type.trim() : 'note';
      typeTag.textContent = `${entryType.charAt(0).toUpperCase()}${entryType.slice(1)} card`;

      const categoryTag = document.createElement('span');
      categoryTag.className = 'badge badge-outline badge-sm';
      categoryTag.textContent = getEntryCategory(entry);

      const createdAt = document.createElement('span');
      createdAt.textContent = getEntryCreatedDate(entry);

      meta.append(typeTag, categoryTag, createdAt);

      const suggestion = entry?.suggestion && typeof entry.suggestion === 'object' ? entry.suggestion : null;
      const suggestionType = typeof suggestion?.type === 'string' ? suggestion.type.trim().toLowerCase() : 'none';
      const suggestionReason = typeof suggestion?.reason === 'string' ? suggestion.reason.trim() : '';
      const shouldShowSuggestion = (suggestionType === 'reminder' || suggestionType === 'note') && suggestionReason;

      if (shouldShowSuggestion) {
        const suggestionPanel = document.createElement('section');
        suggestionPanel.className = 'rounded-md border border-base-300 bg-base-200/50 p-2 text-xs space-y-2';

        const suggestionLabel = document.createElement('p');
        suggestionLabel.className = 'font-medium';
        suggestionLabel.textContent = 'Suggested action';

        const suggestionAction = document.createElement('p');
        suggestionAction.className = 'opacity-80';
        suggestionAction.textContent = suggestionType === 'reminder' ? 'Create Reminder' : 'Convert to Note';

        const suggestionReasonEl = document.createElement('p');
        suggestionReasonEl.className = 'opacity-70';
        suggestionReasonEl.textContent = suggestionReason;

        const suggestionActions = document.createElement('div');
        suggestionActions.className = 'flex items-center gap-2';

        const acceptButton = document.createElement('button');
        acceptButton.type = 'button';
        acceptButton.className = 'btn btn-xs btn-primary';
        acceptButton.textContent = 'Accept';
        acceptButton.addEventListener('click', () => {
          if (suggestionType === 'reminder') {
            convertToReminder(entry);
          } else if (suggestionType === 'note') {
            convertToNote(entry);
          }
        });

        const ignoreButton = document.createElement('button');
        ignoreButton.type = 'button';
        ignoreButton.className = 'btn btn-xs btn-ghost';
        ignoreButton.textContent = 'Ignore';
        ignoreButton.addEventListener('click', () => {
          const allEntries = readEntries();
          const entryIndex = allEntries.findIndex((item) => item?.id && entry?.id ? item.id === entry.id : item === entry);
          if (entryIndex === -1) return;
          allEntries[entryIndex] = {
            ...allEntries[entryIndex],
            suggestion: {
              type: 'none',
              reason: ''
            },
            updatedAt: new Date().toISOString()
          };
          writeEntries(allEntries);
          renderInboxEntries();
        });

        suggestionActions.append(acceptButton, ignoreButton);
        suggestionPanel.append(suggestionLabel, suggestionAction, suggestionReasonEl, suggestionActions);
        card.appendChild(suggestionPanel);
      }

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-2 flex-wrap';

      const moveSelect = document.createElement('select');
      moveSelect.className = 'select select-bordered select-xs';
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Move to category';
      moveSelect.appendChild(defaultOption);

      categories
        .filter((name) => name.toLowerCase() !== 'inbox')
        .forEach((name) => {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          moveSelect.appendChild(option);
        });

      moveSelect.addEventListener('change', () => {
        if (!moveSelect.value) return;
        const allEntries = readEntries();
        const entryIndex = allEntries.findIndex((item) => {
          if (entry?.id && item?.id) return item.id === entry.id;
          return getEntryText(item) === getEntryText(entry) && index === entries.indexOf(entry);
        });
        if (entryIndex === -1) return;
        allEntries[entryIndex] = {
          ...allEntries[entryIndex],
          category: moveSelect.value,
          updatedAt: new Date().toISOString()
        };
        writeEntries(allEntries);
        renderInboxEntries();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-xs btn-ghost';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        const updatedText = window.prompt('Edit entry text', getEntryText(entry));
        if (updatedText === null) return;
        const nextText = updatedText.trim();
        if (!nextText) return;
        const allEntries = readEntries();
        const entryIndex = allEntries.findIndex((item) => item?.id && entry?.id ? item.id === entry.id : getEntryText(item) === getEntryText(entry));
        if (entryIndex === -1) return;
        const target = allEntries[entryIndex];
        const key = typeof target.text === 'string' ? 'text' : typeof target.content === 'string' ? 'content' : 'title';
        allEntries[entryIndex] = {
          ...target,
          [key]: nextText,
          updatedAt: new Date().toISOString()
        };
        writeEntries(allEntries);
        renderInboxEntries();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-xs btn-outline';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        const allEntries = readEntries();
        const nextEntries = allEntries.filter((item) => (entry?.id && item?.id ? item.id !== entry.id : item !== entry));
        writeEntries(nextEntries);
        renderInboxEntries();
      });

      actions.append(moveSelect, editBtn, deleteBtn);
      card.append(text, meta, actions);
      attachInboxLongPress(card, entry);
      inboxEntriesList.appendChild(card);
    });
  };

  const appendToMainNotesDatabase = (notes) => {
    try {
      const raw = window.localStorage?.getItem('memoryCueNotes');
      const existing = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(existing) ? existing.slice() : [];

      notes.forEach((note) => {
        if (!note || typeof note !== 'object') return;
        next.unshift(note);
      });

      window.localStorage?.setItem('memoryCueNotes', JSON.stringify(next));
    } catch (error) {
      console.warn('Unable to update main notes database', error);
    }
  };

  const processInboxHandler = async () => {
    const allEntries = readEntries();
    const inboxEntries = allEntries.filter((entry) => entry?.processed === false);
    if (!inboxEntries.length) {
      return [];
    }

    const prompt = [
      'Classify each note into one category:',
      'Task',
      'Idea',
      'Memory',
      'Note',
      '',
      'Return structured JSON.'
    ].join('\n');

    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        entries: inboxEntries.map((entry) => ({
          id: entry?.id,
          text: getEntryText(entry)
        }))
      })
    });

    if (!response.ok) {
      throw new Error(`Assistant request failed (${response.status})`);
    }

    const data = await response.json();
    const updates = Array.isArray(data) ? data : [];
    if (!updates.length) {
      return [];
    }

    const updatesById = new Map();
    updates.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      if (item.id) {
        updatesById.set(String(item.id), item);
        return;
      }
      const fallback = inboxEntries[index];
      if (fallback?.id) {
        updatesById.set(String(fallback.id), item);
      }
    });

    const timestamp = new Date().toISOString();
    const processedNotes = [];

    inboxEntries.forEach((entry) => {
      const entryId = entry?.id ? String(entry.id) : '';
      if (!entryId || !updatesById.has(entryId)) {
        return;
      }

      const update = updatesById.get(entryId);
      const type = typeof update.type === 'string' && update.type.trim()
        ? update.type.trim().toLowerCase()
        : (typeof entry.type === 'string' && entry.type.trim() ? entry.type.trim().toLowerCase() : 'note');
      const text = typeof update.text === 'string' && update.text.trim()
        ? update.text.trim()
        : getEntryText(entry);

      processedNotes.push({
        text,
        type,
        processed: true,
        timestamp,
        id: entryId,
        title: text.split(/\s+/).slice(0, 8).join(' '),
        body: text,
        bodyText: text,
        bodyHtml: text,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });

    if (!processedNotes.length) {
      return [];
    }

    appendToMainNotesDatabase(processedNotes);
    inboxEntries.forEach((entry) => removeEntry(String(entry?.id || '')));
    renderInboxEntries();
    return processedNotes;
  };

  async function processInbox() {
    if (processInboxButton) {
      processInboxButton.disabled = true;
      processInboxButton.textContent = 'Processing...';
    }

    try {
      const { executeCommand } = await import('../src/core/commandEngine.js');
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
    if (event.key === 'memoryCueInbox') {
      renderInboxEntries();
    }
  });

  if (typeof window.localStorage?.setItem === 'function' && !window.__memoryCueInboxSetItemPatched) {
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = function patchedSetItem(key, value) {
      originalSetItem(key, value);
      if (key === 'memoryCueInbox') {
        document.dispatchEvent(new CustomEvent('memoryCue:entriesUpdated'));
      }
    };
    window.__memoryCueInboxSetItemPatched = true;
  }

  renderCategoryCards();
  renderInboxEntries();
})();

window.memoryCueEmptyStateCtaClasses = 'btn btn-primary btn-sm w-full sm:w-auto';
window.memoryCueMountEmptyState = function mountCompactEmptyState(target, config) {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const { title, description, action } = config || {};
  const wrapper = document.createElement('div');
  wrapper.className = 'empty-state-compact';
  wrapper.setAttribute('role', 'presentation');

  if (title) {
    const heading = document.createElement('h3');
    heading.textContent = title;
    wrapper.appendChild(heading);
  }

  if (description) {
    const paragraph = document.createElement('p');
    paragraph.textContent = description;
    wrapper.appendChild(paragraph);
  }

  if (action) {
    const actions = document.createElement('div');
    actions.className = 'empty-state-actions';
    actions.innerHTML = action;
    wrapper.appendChild(actions);
  }

  target.replaceChildren(wrapper);
};

const viewToggleMenu = document.getElementById('viewToggleMenu');
const viewToggleLabel = document.getElementById('viewToggleLabel');
const reminderList = document.getElementById('reminderList');

if (viewToggleMenu && reminderList) {
  const getPendingNotificationIds = () => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return new Set();
    }

    if (typeof localStorage === 'undefined') {
      return new Set();
    }

    try {
      const stored = JSON.parse(localStorage.getItem('scheduledReminders') || '{}');
      const entries = Object.values(stored || {}).filter((entry) => entry && typeof entry === 'object' && entry.id);
      return new Set(entries.map((entry) => entry.id));
    } catch (error) {
      console.warn('Unable to read scheduled reminders', error);
      return new Set();
    }
  };

  const applyNotificationHighlights = () => {
    const ids = getPendingNotificationIds();
    reminderList.querySelectorAll('[data-reminder]').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const reminderId = el.dataset.id || el.getAttribute('data-id');
      if (reminderId && ids.has(reminderId)) {
        el.setAttribute('data-notification-active', 'true');
      } else {
        el.removeAttribute('data-notification-active');
      }
    });
  };

  const layoutLabels = {
    list: 'View layout: Stacked',
    grid: 'View layout: Grid',
    row: 'View layout: Single row',
  };

  const getCurrentLayout = () => {
    if (reminderList.classList.contains('reminder-single-row')) return 'row';
    if (reminderList.classList.contains('grid-cols-2')) return 'grid';
    return 'list';
  };

  const updateViewToggleLabel = (layout) => {
    if (!viewToggleLabel) return;
    const label = layoutLabels[layout] || layoutLabels.list;
    viewToggleLabel.textContent = label;
  };

  const updateToggleState = (layout) => {
    updateViewToggleLabel(layout);
    viewToggleMenu.setAttribute('data-layout', layout);
    viewToggleMenu.setAttribute('aria-pressed', layout === 'list' ? 'false' : 'true');
  };

  const setCompactMode = (layout) => {
    const compact = layout === 'grid';
    reminderList.querySelectorAll('.task-item, [data-compact]').forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      if (compact) {
        item.setAttribute('data-compact', 'true');
      } else {
        item.removeAttribute('data-compact');
      }
    });
  };

  const applyLayout = (layout) => {
    reminderList.classList.remove('grid-cols-2', 'space-y-3', 'reminder-single-row');

    if (layout === 'grid') {
      reminderList.classList.add('grid-cols-2');
    } else if (layout === 'row') {
      reminderList.classList.add('reminder-single-row');
    } else {
      reminderList.classList.add('space-y-3');
      layout = 'list';
    }

    updateToggleState(layout);
    setCompactMode(layout);
    applyNotificationHighlights();
  };

  const ensureInitialState = () => {
    applyLayout('list');
  };

  const observer = new MutationObserver(() => {
    applyLayout(getCurrentLayout());
  });

  viewToggleMenu.addEventListener('click', function () {
    const currentLayout = getCurrentLayout();
    const nextLayout = currentLayout === 'list' ? 'grid' : currentLayout === 'grid' ? 'row' : 'list';
    applyLayout(nextLayout);
  });

  ensureInitialState();
  observer.observe(reminderList, { childList: true });

  document.addEventListener('memoryCue:remindersUpdated', applyNotificationHighlights);
  window.addEventListener('storage', (event) => {
    if (event && event.key === 'scheduledReminders') {
      applyNotificationHighlights();
    }
  });
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    const trigger = event.target instanceof Element ? event.target : null;
    const dialog = trigger?.closest?.('.sheet, [role="dialog"]');
    if (!(dialog instanceof HTMLElement)) return;
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
  });
});

(function () {
  const list = document.getElementById('reminderList');
  if (!list) return;

  const TEXT_NODE = typeof Node !== 'undefined' ? Node.TEXT_NODE : 3;
  const priorityLabels = {
    high: 'High priority',
    medium: 'Medium priority',
    low: 'Low priority',
  };
  const priorityValues = {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  };
  const priorityClassTokens = ['priority-high', 'priority-medium', 'priority-low'];
  const detectPriorityKey = (value) => {
    const normalized = (value || '').trim().toLowerCase();
    if (normalized.startsWith('h')) return 'high';
    if (normalized.startsWith('m')) return 'medium';
    if (normalized.startsWith('l')) return 'low';
    return '';
  };
  const removePriorityText = (element) => {
    if (!(element instanceof HTMLElement)) return;
    Array.from(element.childNodes).forEach((child) => {
      if (child.nodeType === TEXT_NODE) {
        child.remove();
      } else if (child instanceof HTMLElement) {
        removePriorityText(child);
        if (!child.childNodes.length) {
          child.remove();
        }
      }
    });
  };

  const applyPriorityPills = (container) => {
    const pills = container.querySelectorAll('[data-chip="priority"], [data-priority-pill], .priority-pill');
    let containerPriorityKey = detectPriorityKey(
      container.dataset.priority || container.getAttribute('data-priority') || ''
    );

    pills.forEach((pill) => {
      if (!(pill instanceof HTMLElement)) return;

      const prioritySource =
        pill.dataset.priority ||
        pill.dataset.level ||
        pill.dataset.value ||
        container.dataset.priority ||
        container.getAttribute('data-priority') ||
        '';

      const textPriority = prioritySource || pill.textContent?.trim() || '';
      const priorityKey = detectPriorityKey(textPriority);

      pill.classList.add('priority-pill');
      pill.classList.remove(...priorityClassTokens);

      if (priorityKey) {
        pill.classList.add(`priority-${priorityKey}`);
        if (!containerPriorityKey) {
          containerPriorityKey = priorityKey;
        }
      }

      const accessibleLabel = textPriority || (priorityKey ? priorityLabels[priorityKey] : '');
      if (accessibleLabel) {
        pill.setAttribute('aria-label', accessibleLabel);
        pill.setAttribute('title', accessibleLabel);
      }

      removePriorityText(pill);
    });

    container.classList.remove(...priorityClassTokens);

    if (containerPriorityKey) {
      const priorityValue = priorityValues[containerPriorityKey];
      if (priorityValue) {
        container.dataset.priority = priorityValue;
      }
      container.classList.add(`priority-${containerPriorityKey}`);
    } else if (!detectPriorityKey(container.dataset.priority)) {
      delete container.dataset.priority;
    }
  };

  const ensureTodayToggleInCard = (card) => {
    if (!(card instanceof HTMLElement)) return;
    const titleTarget =
      card.querySelector('.reminder-title-slot [data-reminder-title]') ||
      card.querySelector('.reminder-title-slot .task-title') ||
      card.querySelector('[data-reminder-title]') ||
      card.querySelector('.task-title') ||
      card.querySelector('h3, h4, strong');
    if (!(titleTarget instanceof HTMLElement)) {
      return;
    }
    let toggle = titleTarget.querySelector('[data-role="reminder-today-toggle"]');
    if (toggle instanceof HTMLElement) {
      toggle.classList.add('reminder-title-toggle', 'cursor-pointer');
      if (!toggle.hasAttribute('role')) {
        toggle.setAttribute('role', 'button');
      }
      if (!toggle.hasAttribute('tabindex')) {
        toggle.tabIndex = 0;
      }
      if (!toggle.classList.contains('reminder-title-pinned') && !toggle.classList.contains('reminder-title-unpinned')) {
        toggle.classList.add('reminder-title-unpinned');
      }
      return;
    }
    toggle = document.createElement('span');
    toggle.dataset.role = 'reminder-today-toggle';
    toggle.className = 'reminder-title-toggle cursor-pointer reminder-title-unpinned';
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.tabIndex = 0;
    const fragment = document.createDocumentFragment();
    while (titleTarget.firstChild) {
      fragment.appendChild(titleTarget.firstChild);
    }
    if (!fragment.childNodes.length && card.dataset.title) {
      fragment.appendChild(document.createTextNode(card.dataset.title));
    }
    toggle.appendChild(fragment);
    titleTarget.appendChild(toggle);
  };

  const restructureReminderCard = (card) => {
    if (!(card instanceof HTMLElement)) return;
    if (card.dataset.compactLayout === 'true') {
      ensureTodayToggleInCard(card);
      return;
    }

    const modernTitleSlot = card.querySelector('.reminder-title-slot');
    if (modernTitleSlot instanceof HTMLElement) {
      const contentColumn = modernTitleSlot.parentElement;
      if (!(contentColumn instanceof HTMLElement)) return;

      const existingToggle = card.querySelector('[data-role="reminder-today-toggle-wrapper"]');
      if (existingToggle) {
        card.dataset.compactLayout = 'true';
        if (list.classList.contains('grid-cols-2')) {
          card.dataset.compact = 'true';
        } else {
          card.removeAttribute('data-compact');
        }
        return;
      }

      const trailingChildren = Array.from(contentColumn.children).filter(
        (child) => child instanceof HTMLElement && child !== modernTitleSlot
      );

      const primaryRow = document.createElement('div');
      primaryRow.className = 'reminder-primary-row flex w-full items-start justify-between gap-2 flex-wrap';

      const titleCol = document.createElement('div');
      titleCol.className = 'flex-1 min-w-0';
      titleCol.appendChild(modernTitleSlot);

      const metaSlot = document.createElement('div');
      metaSlot.className = 'reminder-meta-slot flex items-center gap-2 shrink-0';
      const metaActions = document.createElement('div');
      metaActions.className = 'reminder-meta-actions flex items-center gap-2 flex-wrap justify-end text-right';
      metaSlot.appendChild(metaActions);

      primaryRow.append(titleCol, metaSlot);
      contentColumn.replaceChildren(primaryRow);

      if (trailingChildren.length) {
        const secondaryRow = document.createElement('div');
        secondaryRow.className = 'reminder-secondary-row flex flex-wrap gap-2 items-center w-full text-xs text-base-content/70';
        trailingChildren.forEach((child) => {
          if (child instanceof HTMLElement) {
            secondaryRow.appendChild(child);
          }
        });
        if (secondaryRow.childElementCount) {
          contentColumn.appendChild(secondaryRow);
        }
      }

      card.dataset.compactLayout = 'true';
      if (list.classList.contains('grid-cols-2')) {
        card.dataset.compact = 'true';
      } else {
        card.removeAttribute('data-compact');
      }
      return;
    }

    const content = card.querySelector('.task-content') || card;
    if (!(content instanceof HTMLElement)) {
      ensureTodayToggleInCard(card);
      return;
    }

    const header = content.querySelector('.task-header');
    const titleEl = header?.querySelector('.task-title, [data-reminder-title], strong');
    if (!(titleEl instanceof HTMLElement)) {
      ensureTodayToggleInCard(card);
      return;
    }

    const toolbar = header?.querySelector('.task-toolbar');
    const metaTextEl = content.querySelector('.task-meta-text');
    const metaContainer = content.querySelector('.task-meta');
    const notesEl = content.querySelector('.task-notes');

    const primaryRow = document.createElement('div');
    primaryRow.className = 'reminder-primary-row flex w-full items-start justify-between gap-2 flex-wrap';

    const controlSlot = document.createElement('div');
    controlSlot.className = 'reminder-control-slot';
    const control =
      card.querySelector('[data-action="toggle"]') ||
      card.querySelector('[data-done]') ||
      card.querySelector('[data-complete]') ||
      card.querySelector('input[type="checkbox"]');
    if (control instanceof HTMLElement) {
      controlSlot.appendChild(control);
    } else {
      controlSlot.classList.add('reminder-control-slot--empty');
    }

    const titleSlot = document.createElement('div');
    titleSlot.className = 'reminder-title-slot flex-1 min-w-0';
    titleSlot.appendChild(titleEl);

    const metaSlot = document.createElement('div');
    metaSlot.className = 'reminder-meta-slot flex items-center gap-2 shrink-0';

    const metaActions = document.createElement('div');
    metaActions.className = 'reminder-meta-actions flex items-center gap-2 flex-wrap justify-end text-right';
    metaSlot.appendChild(metaActions);

    let extraMetaEl = null;
    if (metaTextEl instanceof HTMLElement) {
      const segments = (metaTextEl.textContent || '')
        .split('•')
        .map((segment) => segment.trim())
        .filter(Boolean);
      const dueSegments = [];
      if (segments.length) {
        dueSegments.push(segments.shift());
      }
      if (segments.length) {
        dueSegments.push(segments.shift());
      }
      if (dueSegments.length) {
        const dueEl = document.createElement('span');
        dueEl.className = 'reminder-due';
        dueEl.textContent = dueSegments.join(' • ');
        metaActions.appendChild(dueEl);
      }
      if (segments.length) {
        metaTextEl.textContent = segments.join(' • ');
        extraMetaEl = metaTextEl;
      } else {
        metaTextEl.remove();
      }
    }

    let priorityChip = null;
    const secondaryChips = [];
    if (metaContainer instanceof HTMLElement) {
      Array.from(metaContainer.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        if (!priorityChip && child.matches('[data-chip="priority"], [data-priority-pill], .priority-pill')) {
          priorityChip = child;
        } else {
          secondaryChips.push(child);
        }
      });
    }

    if (priorityChip) {
      priorityChip.remove();
    }
    if (metaContainer instanceof HTMLElement) {
      metaContainer.remove();
    }

    if (!metaSlot.childElementCount) {
      metaSlot.classList.add('reminder-meta-slot--empty');
    }

    primaryRow.append(controlSlot, titleSlot, metaSlot);

    const secondaryRow = document.createElement('div');
    secondaryRow.className = 'reminder-secondary-row';

    if (extraMetaEl) {
      secondaryRow.appendChild(extraMetaEl);
    }
    secondaryChips.forEach((chip) => secondaryRow.appendChild(chip));
    if (notesEl instanceof HTMLElement) {
      secondaryRow.appendChild(notesEl);
    }
    if (toolbar instanceof HTMLElement) {
      secondaryRow.appendChild(toolbar);
    }

    content.replaceChildren(primaryRow);
    if (secondaryRow.childElementCount) {
      content.appendChild(secondaryRow);
    }

    card.dataset.compactLayout = 'true';
    if (list.classList.contains('grid-cols-2')) {
      card.dataset.compact = 'true';
    } else {
      card.removeAttribute('data-compact');
    }
    ensureTodayToggleInCard(card);
  };

  const ensureMobileReminderHeader = (card) => {
    if (!(card instanceof HTMLElement)) return;
    if (!card.classList.contains('reminder-card')) return;
    if (card.querySelector('.reminder-primary-row')) return;

    const titleSlot = card.querySelector('.reminder-title-slot');
    if (!(titleSlot instanceof HTMLElement)) return;

    const content = card.querySelector('.reminder-header-row')?.parentElement || titleSlot.closest('.flex') || titleSlot.parentElement;
    if (!(content instanceof HTMLElement)) return;

    let headerRow = content.querySelector('.reminder-header-row');
    if (!headerRow) {
      headerRow = document.createElement('div');
      headerRow.className = 'reminder-header-row flex items-center justify-between gap-2 flex-wrap';
      content.insertBefore(headerRow, content.firstChild || null);
    }

    let headerMain = headerRow.querySelector('.reminder-header-main');
    if (!headerMain) {
      headerMain = document.createElement('div');
      headerMain.className = 'reminder-header-main flex-1 min-w-0';
      headerRow.insertBefore(headerMain, headerRow.firstChild || null);
    }

    if (!headerMain.contains(titleSlot)) {
      headerMain.appendChild(titleSlot);
    }

    let headerActions = headerRow.querySelector('.reminder-header-actions');
    if (!headerActions) {
      headerActions = document.createElement('div');
      headerActions.className = 'reminder-header-actions flex items-center gap-2 flex-shrink-0';
      headerRow.appendChild(headerActions);
    }

    ensureTodayToggleInCard(card);
  };

  const upgrade = (node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.parentElement !== list) return;
    if (!node.classList.contains('reminder-card')) {
      if (node.classList.contains('card')) {
        node.classList.remove('card');
      }
      node.classList.add('reminder-card');
    }
    applyPriorityPills(node);
    restructureReminderCard(node);
    ensureMobileReminderHeader(node);
  };

  Array.from(list.children).forEach((child) => {
    upgrade(child);
  });

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          upgrade(node);
        } else if (node instanceof DocumentFragment) {
          Array.from(node.childNodes).forEach((child) => {
            if (child instanceof HTMLElement) {
              upgrade(child);
            }
          });
        }
      });
    });
  });

  observer.observe(list, { childList: true });
})();

// Enhanced add button functionality
(function () {
  const addBtn = document.getElementById('addReminderBtn');
  const addOptionsFab = document.getElementById('addOptionsFab');
  if (!addBtn || !addOptionsFab) return;

  let suppressVoiceTrigger = false;

  addBtn.addEventListener('click', function () {
    const isExpanded = this.getAttribute('aria-expanded') === 'true';
    this.setAttribute('aria-expanded', String(!isExpanded));
    addOptionsFab.classList.toggle('active');

    if (!isExpanded) {
      this.style.transform = 'rotate(45deg)';
    } else {
      this.style.transform = 'rotate(0deg)';
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.add-button-container')) {
      addOptionsFab.classList.remove('active');
      addBtn.setAttribute('aria-expanded', 'false');
      addBtn.style.transform = 'rotate(0deg)';
    }
  });

  document.querySelectorAll('.add-option-item').forEach((item) => {
    item.addEventListener('click', function () {
      const addType = this.dataset.addType;

      addOptionsFab.classList.remove('active');
      addBtn.setAttribute('aria-expanded', 'false');
      addBtn.style.transform = 'rotate(0deg)';

      switch (addType) {
        case 'reminder': {
          const quickAddInput = document.getElementById('reminderQuickAdd');
          quickAddInput?.focus();
          break;
        }
        case 'voice': {
          if (suppressVoiceTrigger) {
            suppressVoiceTrigger = false;
            break;
          }
          const voiceOption = document.getElementById('voiceAddBtn');
          if (voiceOption) {
            suppressVoiceTrigger = true;
            voiceOption.click();
            const resetTrigger = () => {
              suppressVoiceTrigger = false;
            };
            if (typeof queueMicrotask === 'function') {
              queueMicrotask(resetTrigger);
            } else {
              setTimeout(resetTrigger, 0);
            }
          }
          break;
        }
        case 'note': {
          // Add note creation logic here
          break;
        }
        default:
          break;
      }
    });
  });
})();


/*
DEPRECATED NAVIGATION BLOCK
Phase 3 uses js/services/navigation-service.js as the single navigation controller.
*/
;

(function () {
  // Keep full reminder list mounted to avoid items disappearing during scroll.
  return;
  const list = document.getElementById('reminderList');
  if (!list) return;

  const allChildren = Array.from(list.children);
  if (allChildren.length <= 30) return;

  const PAGE_SIZE = 20;
  list.innerHTML = '';
  let index = 0;

  const appendPage = () => {
    const slice = allChildren.slice(index, index + PAGE_SIZE);
    slice.forEach((node) => list.appendChild(node));
    index += slice.length;
  };

  appendPage();

  const sentinel = document.createElement('div');
  sentinel.id = 'listSentinel';
  list.appendChild(sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && index < allChildren.length) {
      appendPage();
      if (index >= allChildren.length) {
        observer.disconnect();
      }
    }
  });

  observer.observe(sentinel);
})();

(function () {
  const settingsModal = document.getElementById('settingsModal');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const settingsBackdrop = settingsModal?.querySelector('.modal-backdrop');
  const settingsOpenBtn = document.getElementById('settingsOpenBtn');

  if (
    !(settingsModal instanceof HTMLElement) ||
    !(settingsCloseBtn instanceof HTMLElement) ||
    !(settingsOpenBtn instanceof HTMLElement)
  ) return;

  let lastSettingsTrigger = null;

  const getFocusableElements = () =>
    Array.from(
      settingsModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el instanceof HTMLElement && !el.hasAttribute('disabled'));

  const openSettingsModal = (trigger = null) => {
    lastSettingsTrigger = trigger instanceof HTMLElement ? trigger : null;
    settingsModal.classList.remove('hidden');
    settingsModal.setAttribute('aria-hidden', 'false');
    settingsCloseBtn.focus();
  };

  const closeSettingsModal = () => {
    settingsModal.classList.add('hidden');
    settingsModal.setAttribute('aria-hidden', 'true');

    if (lastSettingsTrigger instanceof HTMLElement && document.body.contains(lastSettingsTrigger)) {
      try {
        lastSettingsTrigger.focus({ preventScroll: true });
      } catch (error) {
        lastSettingsTrigger.focus();
      }
    }

    lastSettingsTrigger = null;
  };

  settingsOpenBtn.addEventListener('click', (event) => {
    event.preventDefault();
    lastSettingsTrigger = event.currentTarget;
    openSettingsModal(lastSettingsTrigger);
  });

  settingsCloseBtn.addEventListener('click', (event) => {
    event.preventDefault();
    closeSettingsModal();
  });

  settingsBackdrop?.addEventListener('click', (event) => {
    event.preventDefault();
    closeSettingsModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || settingsModal.classList.contains('hidden')) return;
    closeSettingsModal();
  });

  settingsModal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    const focusableElements = getFocusableElements();
    if (!focusableElements.length) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();

(function () {
  const GOOGLE_SCRIPT_ENDPOINT =
    (window.__ENV && window.__ENV.GOOGLE_SCRIPT_ENDPOINT) ||
    "https://script.google.com/macros/s/AKfycbylH5GmqeojNoZ-MA9WRg-w1S-ei9cv8Jo1M0qL7t5cn59LBRCCJ779WOyLi7qQwkSx/exec";

  const statusContainer = document.getElementById('syncStatus');
  const statusDotEl = document.getElementById('mcStatus');
  const statusTextEl = document.getElementById('mcStatusText');
  if (!statusTextEl) return;

  const syncUrlInput = document.getElementById('syncUrl');
  const saveSettingsBtn = document.getElementById('saveSyncSettings');
  const testSyncBtn = document.getElementById('testSync');
  const syncAllBtn = document.getElementById('syncAll');
  const STORAGE_KEY = 'syncUrl';
  const ACTIVE_CLASSES = ['online', 'offline', 'error'];
  const DOT_CLASSES = ['online', 'offline'];

  let currentState = null;

  const DEFAULT_MESSAGES = {
    checking: 'Checking connection…',
    syncing: 'Syncing your latest changes…',
    online: 'Connected. Changes sync automatically.',
    offline: "You're offline. Changes are saved on this device until you reconnect.",
    error: "We couldn't sync right now. We'll retry soon.",
    info: '',
  };

  const DISPLAY_MESSAGES = {
    checking: 'Checking…',
    syncing: 'Syncing…',
    online: 'Synced. Auto-save on.',
    offline: 'Offline. Saving locally.',
    error: 'Sync issue. Retrying.',
    info: '',
  };

  const applyDotState = (state) => {
    if (!statusDotEl) return;
    DOT_CLASSES.forEach((cls) => statusDotEl.classList.remove(cls));
    const isOnline = state !== 'offline' && state !== 'error';
    statusDotEl.classList.add(isOnline ? 'online' : 'offline');
    statusDotEl.setAttribute('aria-label', isOnline ? 'Online' : 'Offline');
  };

  const setStatus = (state, message) => {
    currentState = state;
    ACTIVE_CLASSES.forEach((cls) => statusTextEl.classList.remove(cls));
    if (statusContainer) {
      ACTIVE_CLASSES.forEach((cls) => statusContainer.classList.remove(cls));
    }

    if (statusContainer) {
      statusContainer.setAttribute('data-state', state);
    }

    if (state === 'online') {
      statusTextEl.classList.add('online');
      if (statusContainer) statusContainer.classList.add('online');
    } else if (state === 'error') {
      statusTextEl.classList.add('error');
      if (statusContainer) statusContainer.classList.add('error');
    } else {
      statusTextEl.classList.add('offline');
      if (statusContainer) statusContainer.classList.add('offline');
    }

    const fullText =
      typeof message === 'string' && message.trim()
        ? message.trim()
        : DEFAULT_MESSAGES[state] || '';

    const displayText =
      typeof message === 'string' && message.trim()
        ? message.trim()
        : DISPLAY_MESSAGES[state] || fullText;

    const srText = fullText || displayText || '';
    statusTextEl.dataset.state = state;
    statusTextEl.textContent = srText;

    if (srText) {
      statusTextEl.setAttribute('title', srText);
      statusTextEl.setAttribute('aria-label', srText);
    } else {
      statusTextEl.removeAttribute('title');
      statusTextEl.removeAttribute('aria-label');
    }

    applyDotState(state);
  };

  const updateOnlineState = () => {
    if (currentState === 'syncing') return;
    if (navigator.onLine) {
      if (currentState !== 'online') setStatus('online');
    } else {
      setStatus('offline');
    }
  };

  const persistUrl = (value) => {
    if (typeof localStorage === 'undefined') return;
    if (value) {
      localStorage.setItem(STORAGE_KEY, value);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const getStoredUrl = () => {
    if (typeof localStorage === 'undefined') return '';
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  };

  const normaliseReminder = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.id || raw.uid || raw.key || raw.slug || raw.uuid;
    let title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title && typeof raw.name === 'string') {
      title = raw.name.trim();
    }
    if (!title) return null;

    const dueIso = typeof raw.dueIso === 'string' && raw.dueIso
      ? raw.dueIso
      : (typeof raw.due === 'string' ? raw.due : null);

    const priority = typeof raw.priority === 'string' && raw.priority.trim()
      ? raw.priority.trim()
      : (raw.level || raw.importance || 'Medium');

    const category = typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : (raw.group || raw.bucket || 'General');

    const done = typeof raw.done === 'boolean'
      ? raw.done
      : Boolean(raw.completed || raw.isDone || raw.status === 'done');

    const ensuredId = id || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`);

    return {
      id: ensuredId,
      title,
      dueIso: dueIso && dueIso.trim() ? dueIso.trim() : null,
      priority,
      category,
      done,
    };
  };

  const collectFromDom = () => {
    const elements = Array.from(document.querySelectorAll('[data-reminder]'));
    if (!elements.length) return [];

    return elements
      .map((el) => {
        const dataset = el.dataset || {};
        let raw = null;

        if (dataset.reminder) {
          try {
            const parsed = JSON.parse(dataset.reminder);
            if (parsed && typeof parsed === 'object') {
              raw = parsed;
            }
          } catch {
            raw = null;
          }
        }

        const candidate = raw || {
          id: dataset.id || dataset.reminderId || el.getAttribute('data-id') || null,
          title: dataset.title || dataset.reminderTitle || '',
          dueIso: dataset.due || dataset.reminderDue || el.getAttribute('data-due') || null,
          priority: dataset.priority || dataset.reminderPriority || el.getAttribute('data-priority') || '',
          category: dataset.category || dataset.reminderCategory || el.getAttribute('data-category') || '',
          done: dataset.done === 'true' || dataset.reminderDone === 'true' || el.getAttribute('data-done') === 'true',
        };

        if (!candidate.title) {
          const titleEl = el.querySelector('[data-reminder-title], [data-title], h3, h4, strong');
          if (titleEl) {
            candidate.title = titleEl.textContent.trim();
          }
        }

        if (!candidate.dueIso) {
          const dueEl = el.querySelector('[data-due], time');
          if (dueEl) {
            const attr = dueEl.getAttribute('datetime') || dueEl.getAttribute('data-due');
            candidate.dueIso = attr || dueEl.textContent.trim();
          }
        }

        return normaliseReminder(candidate);
      })
      .filter(Boolean);
  };

  const collectFromStorage = () => {
    if (typeof localStorage === 'undefined') return [];
    const reminders = [];
    const triedKeys = new Set();
    const preferredKeys = [
      'memoryCue.reminders.v1',
      'memoryCue.reminders',
      'memoryCueMobile.reminders',
      'memoryCue.reminders.cache',
      'reminders',
    ];

    preferredKeys.forEach((key) => {
      if (triedKeys.has(key)) return;
      triedKeys.add(key);
      try {
        const value = localStorage.getItem(key);
        if (!value) return;
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => reminders.push(item));
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
          if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
        }
      } catch {
        // ignore invalid storage entries
      }
    });

    if (!reminders.length) {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || triedKeys.has(key) || !/remind/i.test(key)) continue;
        triedKeys.add(key);
        try {
          const value = localStorage.getItem(key);
          if (!value) continue;
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => reminders.push(item));
          } else if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed.items)) parsed.items.forEach((item) => reminders.push(item));
            if (Array.isArray(parsed.reminders)) parsed.reminders.forEach((item) => reminders.push(item));
          }
        } catch {
          // ignore
        }
      }
    }

    return reminders.map(normaliseReminder).filter(Boolean);
  };

  const collectReminders = () => {
    const fromDom = collectFromDom();
    if (fromDom.length) return fromDom;
    return collectFromStorage();
  };

  const toggleBusy = (isBusy) => {
    if (isBusy) {
      syncAllBtn?.setAttribute('aria-busy', 'true');
      syncAllBtn?.setAttribute('disabled', 'disabled');
      testSyncBtn?.setAttribute('aria-busy', 'true');
      testSyncBtn?.setAttribute('disabled', 'disabled');
    } else {
      syncAllBtn?.removeAttribute('aria-busy');
      testSyncBtn?.removeAttribute('aria-busy');
      updateButtonState();
    }
  };

  const updateButtonState = () => {
    const hasUrl = true; // Always enable since we have a default/env endpoint
    if (hasUrl) {
      syncAllBtn?.removeAttribute('disabled');
      testSyncBtn?.removeAttribute('disabled');
    } else {
      syncAllBtn?.setAttribute('disabled', 'disabled');
      testSyncBtn?.setAttribute('disabled', 'disabled');
    }
  };

  const storedUrl = getStoredUrl();
  if (syncUrlInput && storedUrl) {
    syncUrlInput.value = storedUrl;
  }

  updateButtonState();
  setStatus(navigator.onLine ? 'online' : 'offline');

  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);

  syncUrlInput?.addEventListener('input', updateButtonState);

  saveSettingsBtn?.addEventListener('click', () => {
    const value = (syncUrlInput?.value || '').trim();
    if (!value) {
      persistUrl('');
      setStatus('info', 'Sync URL cleared. Add one to enable sync.');
      updateButtonState();
      return;
    }

    try {
      const parsed = new URL(value);
      if (!/^https?:/.test(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      setStatus('error', 'Enter a valid sync URL before saving.');
      return;
    }

    persistUrl(value);
    setStatus('online', 'Sync settings saved.');
    updateButtonState();
  });

  testSyncBtn?.addEventListener('click', async () => {
    const url = GOOGLE_SCRIPT_ENDPOINT;

    toggleBusy(true);
    setStatus('syncing', 'Testing connection…');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      if (response.ok) {
        setStatus('online', 'Connection looks good.');
      } else {
        setStatus('error', 'Test failed. Check your Apps Script deployment.');
      }
    } catch (error) {
      console.error('Test sync failed', error);
      setStatus('error', 'Test failed. Check your Apps Script deployment.');
    } finally {
      toggleBusy(false);
    }
  });

  syncAllBtn?.addEventListener('click', async () => {
    const url = GOOGLE_SCRIPT_ENDPOINT;

    const reminders = collectReminders();
    if (!reminders.length) {
      setStatus('info', 'Nothing to sync right now.');
      return;
    }

    toggleBusy(true);
    setStatus('syncing', `Syncing ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}…`);

    const chunkSize = 20;
    let okCount = 0;
    let failCount = 0;

    const makePayload = (reminder) => ({
      id: reminder.id,
      title: reminder.title,
      dueIso: reminder.dueIso || null,
      priority: reminder.priority || 'Medium',
      category: reminder.category || 'General',
      done: Boolean(reminder.done),
      source: 'memory-cue-mobile',
    });

    try {
      for (let index = 0; index < reminders.length; index += chunkSize) {
        const slice = reminders.slice(index, index + chunkSize);
        const results = await Promise.allSettled(slice.map((reminder) => (
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(makePayload(reminder)),
          })
        )));

        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value?.ok) {
            okCount += 1;
          } else if (result.status === 'fulfilled') {
            failCount += 1;
          } else {
            failCount += 1;
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (!failCount) {
        setStatus('online', `Sync complete. ${okCount} updated.`);
      } else if (!okCount) {
        setStatus('error', 'Sync failed. Check your sync URL and retry.');
      } else {
        setStatus('error', `Partial sync: ${okCount} success, ${failCount} failed.`);
      }
    } catch (error) {
      console.error('Sync failed', error);
      setStatus('error', 'Sync failed. Try again soon.');
    } finally {
      toggleBusy(false);
    }
  });
})();
