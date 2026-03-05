// Memory Cue AI Capture Inbox
// Stores and renders quick capture entries using localStorage.

(function () {
  const STORAGE_KEY = 'memoryCueEntries';
  const CATEGORY_MAP = {
    task: 'tasks',
    idea: 'ideas',
    drill: 'drills',
    lesson: 'lessons',
    reflection: 'reflections',
    note: 'notes'
  };

  const input = document.getElementById('captureInput');
  const captureButton = document.getElementById('captureButton');
  const brainDumpCheckbox = document.getElementById('brainDumpMode');
  const entriesList = document.getElementById('entriesList');
  const tabs = Array.from(document.querySelectorAll('.tab'));

  let activeFilter = 'all';

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Could not load entries from localStorage.', error);
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function createId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Reads a line like "task: do marking" and returns { category, content }.
  function parseCapture(text) {
    const value = text.trim();
    const match = value.match(/^([^:\n]+):\s*(.*)$/s);

    if (!match) {
      return { category: 'notes', content: value };
    }

    const prefix = match[1].trim().toLowerCase();
    const mappedCategory = CATEGORY_MAP[prefix] || 'notes';
    const content = match[2].trim();

    return {
      category: mappedCategory,
      content: content || value
    };
  }

  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString();
  }

  function renderEntries() {
    const entries = loadEntries();
    const filtered =
      activeFilter === 'all'
        ? entries
        : entries.filter((entry) => entry.category === activeFilter);

    entriesList.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No entries yet.';
      entriesList.appendChild(empty);
      return;
    }

    filtered
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .forEach((entry) => {
        const card = document.createElement('article');
        card.className = 'entry-card';
        card.setAttribute('role', 'listitem');

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = entry.category.toUpperCase();

        const content = document.createElement('p');
        content.className = 'entry-content';
        content.textContent = entry.content;

        const meta = document.createElement('p');
        meta.className = 'entry-meta';
        meta.textContent = `${entry.date} · ${formatDateTime(entry.timestamp)}`;

        card.appendChild(badge);
        card.appendChild(content);
        card.appendChild(meta);
        entriesList.appendChild(card);
      });
  }

  function captureEntry() {
    const rawText = input.value;
    if (!rawText.trim()) {
      return;
    }

    const parsed = parseCapture(rawText);
    const now = Date.now();

    const record = {
      id: createId(),
      category: parsed.category,
      content: parsed.content,
      timestamp: now,
      date: new Date(now).toISOString().slice(0, 10)
    };

    const entries = loadEntries();
    entries.push(record);
    saveEntries(entries);
    renderEntries();

    input.value = '';

    if (brainDumpCheckbox.checked) {
      input.focus();
    }
  }

  function clearInput() {
    input.value = '';
    input.focus();
  }

  captureButton.addEventListener('click', captureEntry);

  input.addEventListener('keydown', (event) => {
    // Enter saves quickly; Shift+Enter allows a newline when needed.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      captureEntry();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      clearInput();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input.focus();
    }
  });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activeFilter = tab.dataset.filter || 'all';
      tabs.forEach((node) => node.classList.remove('active'));
      tab.classList.add('active');
      renderEntries();
    });
  });

  renderEntries();
})();
