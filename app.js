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

  const screens = Array.from(document.querySelectorAll('.screen'));
  const bottomTabs = Array.from(document.querySelectorAll('.bottom-tab'));
  const entryFilters = Array.from(document.querySelectorAll('.filter'));

  const captureInput = document.getElementById('captureInput');
  const captureButton = document.getElementById('captureButton');
  const entriesList = document.getElementById('entriesList');

  const assistantInput = document.getElementById('assistantInput');
  const askButton = document.getElementById('askButton');
  const assistantResponses = document.getElementById('assistantResponses');

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
        badge.textContent = (entry.category || 'notes').toUpperCase();

        const content = document.createElement('p');
        content.className = 'entry-content';
        content.textContent = entry.content;

        const meta = document.createElement('p');
        meta.className = 'entry-meta';
        meta.textContent = `${entry.date || ''}`;

        card.appendChild(badge);
        card.appendChild(content);
        card.appendChild(meta);
        entriesList.appendChild(card);
      });
  }

  function captureEntry() {
    const rawText = captureInput.value;
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

    captureInput.value = '';
    renderEntries();
  }

  function showScreen(screenId) {
    screens.forEach((screen) => {
      const isActive = screen.id === screenId;
      screen.classList.toggle('is-active', isActive);
    });

    bottomTabs.forEach((tab) => {
      const isActive = tab.dataset.screen === screenId;
      tab.classList.toggle('active', isActive);
    });
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

    appendAssistantBubble('Thinking...', 'assistant');

    try {
      const answer = await window.MemoryCueAssistant.askMemoryCue(question);
      assistantResponses.firstChild.textContent = answer;
    } catch (error) {
      console.error(error);
      assistantResponses.firstChild.textContent = 'Sorry, I could not retrieve your notes right now.';
    }
  }

  captureButton.addEventListener('click', captureEntry);
  askButton.addEventListener('click', askAssistant);

  captureInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      captureEntry();
    }
  });

  assistantInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      askAssistant();
    }
  });

  bottomTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      showScreen(tab.dataset.screen);
    });
  });

  entryFilters.forEach((filter) => {
    filter.addEventListener('click', () => {
      activeFilter = filter.dataset.filter || 'all';
      entryFilters.forEach((node) => node.classList.remove('active'));
      filter.classList.add('active');
      renderEntries();
    });
  });

  renderEntries();
})();
