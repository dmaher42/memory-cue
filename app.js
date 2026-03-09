(function () {
  const DB_KEY = 'memoryCueDB';
  const LEGACY_KEY = 'memoryCueEntries';
  const SCHEMA_VERSION = 2;

  const TYPE_LABELS = ['all', 'task', 'idea', 'note', 'reflection', 'lesson', 'drill'];
  const PREFIX_MAP = {
    task: 'task',
    todo: 'task',
    idea: 'idea',
    note: 'note',
    notes: 'note',
    reflection: 'reflection',
    lesson: 'lesson',
    drill: 'drill'
  };

  let db = null;
  let storageAvailable = true;
  let activeTypeFilter = 'all';
  let activeTagFilter = 'all';
  let activeSearch = '';
  let pendingDelete = null;
  let toastTimer = null;

  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
  const captureInput = document.getElementById('captureInput');
  const captureButton = document.getElementById('captureButton');
  const brainDumpToggle = document.getElementById('brainDumpToggle');
  const brainDumpHint = document.getElementById('brainDumpHint');
  const searchInput = document.getElementById('searchInput');
  const tagsInput = document.getElementById('tagsInput');
  const typeFilters = document.getElementById('typeFilters');
  const tagFilters = document.getElementById('tagFilters');
  const entriesList = document.getElementById('entriesList');
  const timelineList = document.getElementById('timelineList');
  const assistantInput = document.getElementById('assistantInput');
  const askButton = document.getElementById('askButton');
  const assistantResponses = document.getElementById('assistantResponses');
  const toastLive = document.getElementById('toastLive');

  function safeStorageCheck() {
    try {
      const testKey = '__memory_cue_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      console.error('localStorage is not available.', error);
      return false;
    }
  }

  function createUUID() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      const random = (Math.random() * 16) | 0;
      const value = char === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function cleanLine(line) {
    return line.replace(/^[-•*]\s+/, '').trim();
  }

  function parseTags(rawTags) {
    if (!rawTags) {
      return [];
    }

    return String(rawTags)
      .split(',')
      .map(function (tag) {
        return tag.trim().toLowerCase();
      })
      .filter(function (tag, index, array) {
        return tag.length > 0 && array.indexOf(tag) === index;
      });
  }

  function parseTypeAndContent(text) {
    const trimmed = text.trim();
    const match = trimmed.match(/^([a-zA-Z]+)\s*:\s*(.+)$/);
    if (!match) {
      return { type: 'note', content: trimmed };
    }

    const mappedType = PREFIX_MAP[match[1].toLowerCase()];
    if (!mappedType) {
      return { type: 'note', content: trimmed };
    }

    return { type: mappedType, content: match[2].trim() };
  }

  function makeEntry(rawText, tags) {
    const parsed = parseTypeAndContent(rawText);
    const now = new Date().toISOString();
    const title = parsed.content.length > 80 ? `${parsed.content.slice(0, 77)}...` : parsed.content;

    return {
      id: createUUID(),
      createdAt: now,
      updatedAt: now,
      type: parsed.type,
      status: parsed.type === 'task' ? 'open' : 'active',
      title,
      body: parsed.content,
      tags: Array.isArray(tags) ? tags : [],
      dueAt: null,
      source: {
        channel: 'capture',
        app: 'memory-cue-mobile'
      },
      deletedAt: null
    };
  }

  function defaultDB() {
    return {
      schemaVersion: SCHEMA_VERSION,
      settings: {
        brainDumpMode: false
      },
      entries: []
    };
  }

  function saveDB(nextDB) {
    db = nextDB;
    if (!storageAvailable) {
      return;
    }
    try {
      window.localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (error) {
      console.error('Failed to save Memory Cue DB.', error);
      showToast('Could not save to local storage.');
    }
  }

  function migrateLegacyEntries(legacyEntries) {
    const migratedEntries = legacyEntries
      .filter(function (item) {
        return item && (item.content || '').trim();
      })
      .map(function (item) {
        const iso = item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString();
        const type = item.category ? String(item.category).replace(/s$/, '') : 'note';
        const body = String(item.content || '').trim();
        const title = body.length > 80 ? `${body.slice(0, 77)}...` : body;

        return {
          id: item.id || createUUID(),
          createdAt: iso,
          updatedAt: iso,
          type: TYPE_LABELS.includes(type) ? type : 'note',
          status: type === 'task' ? 'open' : 'active',
          title,
          body,
          tags: Array.isArray(item.tags)
            ? item.tags.map(function (tag) {
                return String(tag).trim().toLowerCase();
              }).filter(Boolean)
            : [],
          dueAt: null,
          source: {
            channel: 'legacy-import',
            app: 'memory-cue-mobile'
          },
          deletedAt: null
        };
      });

    const migrated = defaultDB();
    migrated.entries = migratedEntries;
    return migrated;
  }

  function loadDB() {
    if (!storageAvailable) {
      return defaultDB();
    }

    try {
      const raw = window.localStorage.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.entries)) {
          return {
            schemaVersion: SCHEMA_VERSION,
            settings: Object.assign({ brainDumpMode: false }, parsed.settings || {}),
            entries: parsed.entries.map(function (entry) {
              return Object.assign({}, entry, {
                tags: Array.isArray(entry.tags) ? entry.tags : []
              });
            })
          };
        }
      }

      const legacyRaw = window.localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        if (Array.isArray(legacyParsed)) {
          const migrated = migrateLegacyEntries(legacyParsed);
          window.localStorage.setItem(DB_KEY, JSON.stringify(migrated));
          return migrated;
        }
      }
    } catch (error) {
      console.error('Failed to load Memory Cue DB.', error);
      showToast('Could not load your saved entries.');
    }

    const initial = defaultDB();
    saveDB(initial);
    return initial;
  }

  function setTab(tabId, shouldFocusPanel) {
    tabs.forEach(function (tab) {
      const isSelected = tab.id === tabId;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      tab.tabIndex = isSelected ? 0 : -1;
      tab.classList.toggle('is-active', isSelected);
    });

    panels.forEach(function (panel) {
      const controllingTab = panel.getAttribute('aria-labelledby');
      const isActive = controllingTab === tabId;
      panel.hidden = !isActive;
      panel.classList.toggle('is-active', isActive);
      if (isActive && shouldFocusPanel) {
        panel.focus();
      }
    });

    if (tabId === 'tab-entries') {
      renderEntries();
    }

    if (tabId === 'tab-timeline') {
      renderTimeline();
    }
  }

  function moveTabFocus(currentIndex, key) {
    let target = currentIndex;
    if (key === 'ArrowRight') {
      target = (currentIndex + 1) % tabs.length;
    }
    if (key === 'ArrowLeft') {
      target = (currentIndex - 1 + tabs.length) % tabs.length;
    }
    if (key === 'Home') {
      target = 0;
    }
    if (key === 'End') {
      target = tabs.length - 1;
    }
    tabs[target].focus();
  }

  function currentEntries() {
    return db.entries.filter(function (entry) {
      return !entry.deletedAt;
    });
  }

  function filteredEntries() {
    return currentEntries()
      .filter(function (entry) {
        return activeTypeFilter === 'all' ? true : entry.type === activeTypeFilter;
      })
      .filter(function (entry) {
        if (activeTagFilter === 'all') {
          return true;
        }
        return (entry.tags || []).includes(activeTagFilter);
      })
      .filter(function (entry) {
        if (!activeSearch) {
          return true;
        }
        const haystack = `${entry.title} ${entry.body} ${(entry.tags || []).join(' ')}`.toLowerCase();
        return haystack.includes(activeSearch);
      })
      .sort(function (a, b) {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  function getStartOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function getStartOfWeek(date) {
    const start = getStartOfDay(date);
    const day = start.getDay();
    const offset = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - offset);
    return start;
  }

  function getTimelineGroup(entryDate, now) {
    const todayStart = getStartOfDay(now);
    const entryStart = getStartOfDay(entryDate);
    const diffDays = Math.floor((todayStart.getTime() - entryStart.getTime()) / 86400000);

    if (diffDays === 0) {
      return 'Today';
    }

    if (diffDays === 1) {
      return 'Yesterday';
    }

    if (entryStart >= getStartOfWeek(now)) {
      return 'Earlier this week';
    }

    return 'Older';
  }

  function renderTimeline() {
    if (!timelineList) {
      return;
    }

    const grouped = {
      Today: [],
      Yesterday: [],
      'Earlier this week': [],
      Older: []
    };

    const orderedEntries = filteredEntries();
    const now = new Date();

    orderedEntries.forEach(function (entry) {
      const createdDate = new Date(entry.createdAt);
      const group = getTimelineGroup(createdDate, now);
      grouped[group].push(entry);
    });

    timelineList.innerHTML = '';

    if (!orderedEntries.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No entries in your timeline yet.';
      timelineList.appendChild(empty);
      return;
    }

    ['Today', 'Yesterday', 'Earlier this week', 'Older'].forEach(function (groupName) {
      const entries = grouped[groupName];
      if (!entries.length) {
        return;
      }

      const section = document.createElement('section');
      section.className = 'timeline-group';

      const heading = document.createElement('h3');
      heading.className = 'timeline-heading';
      heading.textContent = groupName;
      section.appendChild(heading);

      entries.forEach(function (entry) {
        const item = document.createElement('article');
        item.className = 'timeline-entry';
        item.setAttribute('role', 'listitem');

        const text = document.createElement('p');
        text.className = 'timeline-text';
        text.textContent = entry.body || entry.title || '(Untitled)';

        const meta = document.createElement('p');
        meta.className = 'timeline-meta';
        const timeCreated = new Date(entry.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        meta.textContent = `Category: ${entry.type} • Created: ${timeCreated}`;

        item.appendChild(text);
        item.appendChild(meta);
        section.appendChild(item);
      });

      timelineList.appendChild(section);
    });
  }

  function renderTypeFilters() {
    typeFilters.innerHTML = '';
    TYPE_LABELS.forEach(function (label) {
      const count = label === 'all'
        ? currentEntries().length
        : currentEntries().filter(function (entry) {
            return entry.type === label;
          }).length;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `filter-pill${activeTypeFilter === label ? ' is-active' : ''}`;
      button.textContent = `${label} (${count})`;
      button.setAttribute('aria-pressed', activeTypeFilter === label ? 'true' : 'false');
      button.addEventListener('click', function () {
        activeTypeFilter = label;
        renderTypeFilters();
        renderTagFilters();
        renderEntries();
        renderTimeline();
      });
      typeFilters.appendChild(button);
    });
  }

  function renderTagFilters() {
    if (!tagFilters) {
      return;
    }

    const counts = {};
    currentEntries().forEach(function (entry) {
      (entry.tags || []).forEach(function (tag) {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });

    const tags = Object.keys(counts).sort();
    tagFilters.innerHTML = '';

    const allButton = document.createElement('button');
    allButton.type = 'button';
    allButton.className = `filter-pill${activeTagFilter === 'all' ? ' is-active' : ''}`;
    allButton.textContent = `all tags (${currentEntries().length})`;
    allButton.setAttribute('aria-pressed', activeTagFilter === 'all' ? 'true' : 'false');
    allButton.addEventListener('click', function () {
      activeTagFilter = 'all';
      renderTagFilters();
      renderEntries();
      renderTimeline();
    });
    tagFilters.appendChild(allButton);

    tags.forEach(function (tag) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `filter-pill${activeTagFilter === tag ? ' is-active' : ''}`;
      button.textContent = `${tag} (${counts[tag]})`;
      button.setAttribute('aria-pressed', activeTagFilter === tag ? 'true' : 'false');
      button.addEventListener('click', function () {
        activeTagFilter = tag;
        renderTagFilters();
        renderEntries();
        renderTimeline();
      });
      tagFilters.appendChild(button);
    });
  }

  function showToast(message, options) {
    clearTimeout(toastTimer);
    toastLive.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'toast';

    const text = document.createElement('span');
    text.textContent = message;
    wrap.appendChild(text);

    if (options && options.undo) {
      const undoButton = document.createElement('button');
      undoButton.type = 'button';
      undoButton.textContent = 'Undo';
      undoButton.addEventListener('click', function () {
        options.undo();
        toastLive.innerHTML = '';
      });
      wrap.appendChild(undoButton);
    }

    toastLive.appendChild(wrap);
    toastTimer = setTimeout(function () {
      toastLive.innerHTML = '';
    }, options && options.sticky ? 8000 : 2200);
  }

  function renderEntries() {
    renderTypeFilters();
    renderTagFilters();
    const list = filteredEntries();
    entriesList.innerHTML = '';

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No entries match your filters.';
      entriesList.appendChild(empty);
      return;
    }

    list.forEach(function (entry) {
      const card = document.createElement('article');
      card.className = 'entry-card';
      card.setAttribute('role', 'listitem');

      const topRow = document.createElement('div');
      topRow.className = 'entry-row-top';

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = entry.type;

      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = entry.status;

      topRow.appendChild(badge);
      topRow.appendChild(status);

      const title = document.createElement('h3');
      title.className = 'entry-title';
      title.textContent = entry.title || '(Untitled)';

      const body = document.createElement('p');
      body.className = 'entry-body';
      body.textContent = entry.body;

      const tagsRow = document.createElement('div');
      tagsRow.className = 'entry-tags';
      (entry.tags || []).forEach(function (tag) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.textContent = tag;
        tagsRow.appendChild(chip);
      });

      const bottomRow = document.createElement('div');
      bottomRow.className = 'entry-row-bottom';

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = new Date(entry.createdAt).toLocaleString();

      const actions = document.createElement('div');
      actions.className = 'entry-actions';

      if (entry.type === 'task' && entry.status !== 'done') {
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'btn-small success';
        doneBtn.textContent = 'Mark done';
        doneBtn.addEventListener('click', function () {
          entry.status = 'done';
          entry.updatedAt = new Date().toISOString();
          saveDB(db);
          renderEntries();
          renderTimeline();
          showToast('Task marked done.');
        });
        actions.appendChild(doneBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-small danger';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function () {
        entry.deletedAt = new Date().toISOString();
        entry.updatedAt = entry.deletedAt;
        pendingDelete = entry.id;
        saveDB(db);
        renderEntries();
        renderTimeline();
        showToast('Entry deleted.', {
          undo: function () {
            const target = db.entries.find(function (item) {
              return item.id === pendingDelete;
            });
            if (target) {
              target.deletedAt = null;
              target.updatedAt = new Date().toISOString();
              saveDB(db);
              renderEntries();
              renderTimeline();
              showToast('Delete undone.');
            }
          },
          sticky: true
        });
      });

      actions.appendChild(deleteBtn);
      bottomRow.appendChild(meta);
      bottomRow.appendChild(actions);

      card.appendChild(topRow);
      card.appendChild(title);
      card.appendChild(body);
      if (tagsRow.childElementCount > 0) {
        card.appendChild(tagsRow);
      }
      card.appendChild(bottomRow);
      entriesList.appendChild(card);
    });
  }

  function updateBrainDumpUI() {
    const enabled = !!db.settings.brainDumpMode;
    brainDumpToggle.checked = enabled;
    brainDumpHint.textContent = enabled
      ? 'ON: each non-empty line saves as a separate entry.'
      : 'OFF: save as one entry.';
  }

  function addEntriesFromCapture(rawText) {
    const text = rawText.trim();
    if (!text) {
      return 0;
    }

    const created = [];
    const tags = parseTags(tagsInput ? tagsInput.value : '');
    if (db.settings.brainDumpMode) {
      const lines = text
        .split('\n')
        .map(cleanLine)
        .filter(function (line) {
          return line.length > 0;
        });

      lines.forEach(function (line) {
        created.push(makeEntry(line, tags));
      });
    } else {
      created.push(makeEntry(text, tags));
    }

    if (!created.length) {
      return 0;
    }

    db.entries = db.entries.concat(created);
    saveDB(db);
    return created.length;
  }

  function saveCapture() {
    if (!storageAvailable) {
      showToast('Storage is unavailable. Entries cannot be saved on this device.');
      return;
    }

    const count = addEntriesFromCapture(captureInput.value);
    if (!count) {
      showToast('Add some text before saving.');
      return;
    }

    captureInput.value = '';
    if (tagsInput) {
      tagsInput.value = '';
    }
    showToast(count === 1 ? 'Saved 1 entry.' : `Saved ${count} entries.`);
    renderEntries();
    renderTimeline();
  }

  function appendAssistantBubble(text, type) {
    const bubble = document.createElement('p');
    bubble.className = `bubble bubble-${type}`;
    bubble.textContent = text;
    assistantResponses.prepend(bubble);
  }

  async function askAssistant() {
    const question = assistantInput.value.trim();
    if (!question) {
      return;
    }

    appendAssistantBubble(question, 'user');
    assistantInput.value = '';

    if (!window.MemoryCueAssistant || typeof window.MemoryCueAssistant.askMemoryCue !== 'function') {
      appendAssistantBubble('Assistant integration is unavailable in this build.', 'assistant');
      return;
    }

    appendAssistantBubble('Thinking...', 'assistant');

    try {
      const result = await window.MemoryCueAssistant.askMemoryCue(question);
      const answerText = result && typeof result.answer === 'string' ? result.answer : String(result || 'No answer returned.');
      const usedOfflineFallback = !!(result && result.offline_fallback);
      assistantResponses.firstChild.textContent = usedOfflineFallback
        ? `Offline fallback:
${answerText}`
        : answerText;
    } catch (error) {
      console.error(error);
      assistantResponses.firstChild.textContent = 'Sorry, the assistant is unavailable right now.';
    }
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function (event) {
      const isMod = event.ctrlKey || event.metaKey;
      if (!isMod) {
        return;
      }

      const key = String(event.key).toLowerCase();
      if (key === 'enter') {
        event.preventDefault();
        saveCapture();
        return;
      }

      if (key === 'k') {
        event.preventDefault();
        setTab('tab-capture');
        captureInput.focus();
        return;
      }

      if (key === '1' || key === '2' || key === '3' || key === '4') {
        event.preventDefault();
        const targetId = key === '1'
          ? 'tab-capture'
          : key === '2'
            ? 'tab-entries'
            : key === '3'
              ? 'tab-assistant'
              : 'tab-timeline';
        setTab(targetId, true);
        return;
      }

      if (event.shiftKey && key === 'b') {
        event.preventDefault();
        db.settings.brainDumpMode = !db.settings.brainDumpMode;
        saveDB(db);
        updateBrainDumpUI();
        showToast(`Brain Dump ${db.settings.brainDumpMode ? 'enabled' : 'disabled'}.`);
      }
    });
  }

  function setupTabs() {
    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        setTab(tab.id);
      });

      tab.addEventListener('keydown', function (event) {
        if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          moveTabFocus(index, event.key);
          return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setTab(tab.id, true);
        }
      });
    });
  }

  function init() {
    storageAvailable = safeStorageCheck();
    db = loadDB();

    if (!storageAvailable) {
      showToast('Storage is blocked in this browser. Your entries will not persist.', { sticky: true });
    }

    updateBrainDumpUI();
    renderEntries();
    renderTimeline();
    setTab('tab-capture');

    captureButton.addEventListener('click', saveCapture);
    askButton.addEventListener('click', askAssistant);

    brainDumpToggle.addEventListener('change', function () {
      db.settings.brainDumpMode = brainDumpToggle.checked;
      saveDB(db);
      updateBrainDumpUI();
      showToast(`Brain Dump ${db.settings.brainDumpMode ? 'enabled' : 'disabled'}.`);
    });

    searchInput.addEventListener('input', function () {
      activeSearch = searchInput.value.trim().toLowerCase();
      renderEntries();
      renderTimeline();
    });

    assistantInput.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        askAssistant();
      }
    });

    setupTabs();
    setupKeyboardShortcuts();
  }

  init();
})();
