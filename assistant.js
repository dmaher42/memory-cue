/*
LEGACY APP SHELL
This code belongs to the older Memory Cue UI.
It is not the primary runtime and should not be extended.
*/
(function () {
  const SCHEMA_VERSION = 2;
  const DEFAULT_MAX_ENTRIES = 50;
  const DEFAULT_MAX_CHARS = 12000;
  const TYPE_LABELS = ['all', 'task', 'idea', 'note', 'reflection', 'lesson', 'drill'];

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const body = typeof entry.body === 'string' ? entry.body.trim() : '';
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    const type = typeof entry.type === 'string' ? entry.type : 'note';
    const createdAt = entry.createdAt || entry.updatedAt || null;

    if (!body && !title) {
      return null;
    }

    return {
      id: String(entry.id || ''),
      type,
      title,
      body,
      createdAt,
      relatedIds: Array.isArray(entry.relatedIds)
        ? entry.relatedIds.map(function (id) {
            return String(id);
          }).filter(Boolean)
        : []
    };
  }

  function inferTypeFilter(question) {
    const lowered = String(question || '').toLowerCase();
    if (lowered.includes('drill')) return 'drill';
    if (lowered.includes('remind')) return 'reminder';
    if (lowered.includes('task') || lowered.includes('todo')) return 'task';
    if (lowered.includes('idea')) return 'idea';
    if (lowered.includes('note')) return 'note';
    return null;
  }

  function filterRelevantEntries(question, entries) {
    const typeFilter = inferTypeFilter(question);
    if (!typeFilter) {
      return entries;
    }

    const typedEntries = entries.filter(function (entry) {
      return entry.type === typeFilter;
    });

    return typedEntries.length ? typedEntries : entries;
  }

  function sortNewestFirst(entries) {
    return entries.slice().sort(function (a, b) {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  function loadEntriesFromState() {
    if (!window.MemoryCueState || typeof MemoryCueState.getEntries !== 'function') {
      return { settings: {}, entries: [] };
    }

    const stateSettings =
      MemoryCueState.state && MemoryCueState.state.settings && typeof MemoryCueState.state.settings === 'object'
        ? MemoryCueState.state.settings
        : {};

    const stateEntries = MemoryCueState.getEntries();

    return {
      settings: stateSettings,
      entries: stateEntries.map(normalizeEntry).filter(Boolean)
    };
  }

  function selectEntries(entries, maxEntries, maxChars) {
    const sorted = sortNewestFirst(entries);
    const selected = [];
    let usedChars = 0;

    for (let i = 0; i < sorted.length; i += 1) {
      if (selected.length >= maxEntries || usedChars >= maxChars) {
        break;
      }

      const entry = sorted[i];
      const line = `[${entry.id || 'no-id'}] (${entry.type}) ${entry.title || ''} ${entry.body || ''}`.trim();
      if (!line) {
        continue;
      }

      const lineSize = line.length + 1;
      if (selected.length > 0 && usedChars + lineSize > maxChars) {
        break;
      }

      selected.push(entry);
      usedChars += lineSize;
    }

    return selected;
  }

  function buildContext(entries, maxEntries, maxChars) {
    const safeMaxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : DEFAULT_MAX_ENTRIES;
    const safeMaxChars = Number.isFinite(maxChars) ? Math.max(200, Math.floor(maxChars)) : DEFAULT_MAX_CHARS;
    const selected = selectEntries(entries, safeMaxEntries, safeMaxChars);

    return selected
      .map(function (entry) {
        const createdLabel = entry.createdAt ? ` | ${entry.createdAt}` : '';
        return `[${entry.id || 'no-id'}] ${entry.type}${createdLabel}\nTitle: ${entry.title || '(untitled)'}\nBody: ${entry.body || ''}`;
      })
      .join('\n\n');
  }

  function keywordFallback(question, entries, reason) {
    const tokens = String(question || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(function (token) {
        return token.length >= 3;
      });

    const scored = entries
      .map(function (entry) {
        const haystack = `${entry.title} ${entry.body} ${entry.type}`.toLowerCase();
        let score = 0;
        tokens.forEach(function (token) {
          if (haystack.includes(token)) {
            score += 1;
          }
        });
        return { entry, score };
      })
      .filter(function (item) {
        return item.score > 0;
      })
      .sort(function (a, b) {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        const aTime = a.entry.createdAt ? new Date(a.entry.createdAt).getTime() : 0;
        const bTime = b.entry.createdAt ? new Date(b.entry.createdAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 5);

    if (!scored.length) {
      return {
        answer: `Offline fallback: I couldn't find matching entries for "${question}".`,
        cited_entry_ids: [],
        followups: ['Try a different keyword from your note text.'],
        offline_fallback: true,
        reason
      };
    }

    const lines = scored.map(function (item) {
      const text = item.entry.body || item.entry.title;
      const preview = text.length > 160 ? `${text.slice(0, 157)}...` : text;
      return `• ${preview}`;
    });

    return {
      answer: `Offline fallback results:\n${lines.join('\n')}`,
      cited_entry_ids: scored.map(function (item) {
        return item.entry.id;
      }),
      followups: ['Ask again when online for a fuller AI answer.'],
      offline_fallback: true,
      reason
    };
  }

  async function askMemoryCue(question, options) {
    const safeQuestion = typeof question === 'string' ? question.trim() : '';
    if (!safeQuestion) {
      throw new Error('Question is required.');
    }

    const opts = options && typeof options === 'object' ? options : {};
    const maxEntries = Number.isFinite(opts.maxEntries) ? opts.maxEntries : DEFAULT_MAX_ENTRIES;
    const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : DEFAULT_MAX_CHARS;
    const loaded = loadEntriesFromState();
    const relevantEntries = filterRelevantEntries(safeQuestion, loaded.entries);
    const selectedEntries = selectEntries(relevantEntries, maxEntries, maxChars);
    const contextText = buildContext(selectedEntries, maxEntries, maxChars);

    if (!navigator.onLine) {
      return keywordFallback(safeQuestion, selectedEntries, 'offline');
    }

    const endpointUrl =
      (loaded.settings && loaded.settings.assistant && loaded.settings.assistant.endpointUrl) ||
      '/api/assistant';

    let response;
    try {
      response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          question: safeQuestion,
          entries: selectedEntries,
          contextText,
          schemaVersion: SCHEMA_VERSION
        })
      });
    } catch (error) {
      console.error('Assistant request failed. Using offline fallback.', error);
      return keywordFallback(safeQuestion, selectedEntries, 'network_error');
    }

    if (response.status === 429) {
      return keywordFallback(safeQuestion, selectedEntries, 'rate_limited');
    }

    if (!response.ok) {
      return keywordFallback(safeQuestion, selectedEntries, `http_${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data.answer !== 'string') {
      return keywordFallback(safeQuestion, selectedEntries, 'invalid_response');
    }

    return {
      answer: data.answer,
      cited_entry_ids: Array.isArray(data.cited_entry_ids) ? data.cited_entry_ids : [],
      followups: Array.isArray(data.followups) ? data.followups : [],
      best_entry_id: typeof data.best_entry_id === 'string' ? data.best_entry_id : '',
      best_entry: data.best_entry && typeof data.best_entry === 'object' ? data.best_entry : null
    };
  }

  window.MemoryCueAssistant = {
    buildContext,
    askMemoryCue
  };

  function parseCaptureInput(rawText) {
    const trimmedText = typeof rawText === 'string' ? rawText.trim() : '';
    const typeMatch = trimmedText.match(/^(task|idea|note|reflection|lesson|drill)\s*:\s*/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : 'note';
    const body = typeMatch ? trimmedText.replace(typeMatch[0], '').trim() : trimmedText;
    const title = body.split('\n')[0].trim().slice(0, 80);

    return {
      type,
      title,
      body
    };
  }

  function parseTags(rawTags) {
    if (typeof rawTags !== 'string') {
      return [];
    }

    return rawTags
      .split(',')
      .map(function (tag) {
        return tag.trim();
      })
      .filter(Boolean);
  }

  function showToast(message) {
    const toastLive = document.getElementById('toastLive');
    if (!toastLive) {
      return;
    }

    toastLive.textContent = message;
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(function () {
      toastLive.textContent = '';
    }, 1800);
  }

  function initCaptureSave() {
    const captureButton = document.getElementById('captureButton');
    const captureInput = document.getElementById('captureInput');
    const tagsInput = document.getElementById('tagsInput');

    if (!captureButton || !captureInput || !tagsInput || !window.MemoryCueState) {
      return;
    }

    captureButton.addEventListener('click', function () {
      const parsedInput = parseCaptureInput(captureInput.value);
      if (!parsedInput.body) {
        return;
      }

      MemoryCueState.addEntry({
        type: parsedInput.type,
        title: parsedInput.title,
        body: parsedInput.body,
        tags: parseTags(tagsInput.value)
      });

      document.dispatchEvent(new CustomEvent('memorycue:entries-changed'));
      captureInput.value = '';
      showToast('Entry saved');
    });
  }

  function initEntriesList() {
    const entriesList = document.getElementById('entriesList');
    const searchInput = document.getElementById('searchInput');
    const typeFilters = document.getElementById('typeFilters');

    if (!entriesList || !searchInput || !typeFilters || !window.MemoryCueState) {
      return;
    }

    let activeTypeFilter = 'all';

    function getStoreEntries() {
      return MemoryCueState.getEntries().map(function (entry) {
        return {
          ...entry,
          timestamp: entry.timestamp || entry.createdAt || entry.updatedAt || null
        };
      });
    }

    function filteredEntries() {
      const searchTerm = searchInput.value.trim().toLowerCase();
      return getStoreEntries().filter(function (entry) {
        const matchesType = activeTypeFilter === 'all' || entry.type === activeTypeFilter;
        if (!matchesType) {
          return false;
        }

        if (!searchTerm) {
          return true;
        }

        const haystack = `${entry.title || ''} ${entry.body || ''} ${(entry.tags || []).join(' ')}`.toLowerCase();
        return haystack.includes(searchTerm);
      });
    }

    function renderTypeFilters() {
      typeFilters.innerHTML = '';
      TYPE_LABELS.forEach(function (label) {
        const count = label === 'all'
          ? getStoreEntries().length
          : getStoreEntries().filter(function (entry) {
              return entry.type === label;
            }).length;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `filter-pill${activeTypeFilter === label ? ' is-active' : ''}`;
        button.textContent = `${label} (${count})`;
        button.setAttribute('aria-pressed', activeTypeFilter === label ? 'true' : 'false');
        button.addEventListener('click', function () {
          activeTypeFilter = label;
          renderEntries();
        });
        typeFilters.appendChild(button);
      });
    }

    function renderEntries() {
      const list = filteredEntries();
      renderTypeFilters();
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

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = entry.type || 'note';

        const title = document.createElement('h3');
        title.className = 'entry-title';
        title.textContent = entry.title || '(Untitled)';

        const body = document.createElement('p');
        body.className = 'entry-body';
        body.textContent = entry.body || '';

        const bottomRow = document.createElement('div');
        bottomRow.className = 'entry-row-bottom';

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn-small danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', function () {
          MemoryCueState.deleteEntry(entry.id);
          renderEntries();
        });

        bottomRow.appendChild(meta);
        bottomRow.appendChild(deleteBtn);

        card.appendChild(badge);
        card.appendChild(title);
        card.appendChild(body);
        card.appendChild(bottomRow);
        entriesList.appendChild(card);
      });
    }

    searchInput.addEventListener('input', renderEntries);
    document.addEventListener('memorycue:entries-changed', renderEntries);
    renderEntries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initCaptureSave();
      initEntriesList();
    });
  } else {
    initCaptureSave();
    initEntriesList();
  }
})();
