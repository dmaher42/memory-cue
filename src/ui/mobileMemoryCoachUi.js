import {
  addMemoryPracticeEntry,
  addVocabularyPracticeEntry,
  createPracticeSession,
  getMemoryCoachItems,
  getPracticeSummary,
  maskPracticeAnswer,
  recordPracticeResult,
  setPracticeItemEnabled,
  updatePracticeEntry,
} from '../../js/services/recall-service.js';

const RATING_LABELS = Object.freeze({
  forgot: 'Didn’t recall',
  hard: 'Recalled with effort',
  got_it: 'Recalled clearly',
});

const createElement = (tagName, className = '', text = '') => {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text) {
    element.textContent = text;
  }
  return element;
};

const formatNextReview = (value, now = Date.now()) => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const delta = timestamp - now;
  if (delta <= 0) {
    return 'ready now';
  }
  const hours = Math.ceil(delta / (60 * 60 * 1000));
  if (hours < 24) {
    return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
  }
  const days = Math.ceil(delta / (24 * 60 * 60 * 1000));
  if (days === 1) {
    return 'tomorrow';
  }
  return `in ${days} days`;
};

const getPracticeHints = (item) => {
  const hints = Array.isArray(item?.hints) ? [...item.hints] : [];
  if (item?.kind === 'list' && Array.isArray(item.items)) {
    hints.unshift(`There are ${item.items.length} items${item.orderMatters ? ', and their order matters' : ''}.`);
    if (item.items.length) {
      hints.push(`Initials: ${item.items.map((listItem) => listItem.charAt(0).toLocaleUpperCase()).join(', ')}`);
    }
  }
  const maskedExample = maskPracticeAnswer(item?.example, item?.answer);
  if (maskedExample && maskedExample !== item?.example) {
    hints.push(`Complete the example: ${maskedExample}`);
  }
  const answer = typeof item?.answer === 'string' ? item.answer.trim() : '';
  if (answer && ['vocabulary', 'expression'].includes(item?.kind)) {
    hints.push(`It starts with “${answer.charAt(0).toLocaleUpperCase()}” and has ${answer.length} letters.`);
  }
  return hints
    .map((hint) => (typeof hint === 'string' ? hint.trim() : ''))
    .filter((hint, index, list) => hint && list.indexOf(hint) === index)
    .slice(0, 3);
};

export const createMemoryCoachUi = (options = {}) => {
  const {
    container = null,
    launcher = null,
    controlsRegion = null,
    modeBar = null,
    modeLabel = null,
    exitButton = null,
    loadEntries = () => [],
    createEntry = () => null,
    updateEntry = () => null,
    setStatus = () => {},
    requestRender = () => {},
    beforeActivate = () => {},
    onFindWord = () => {},
    navigationView = '',
    dueBadge = null,
    duePrompt = null,
    navigationButton = null,
    now = () => Date.now(),
  } = options;

  if (!(container instanceof HTMLElement)) {
    return {
      activate() {},
      deactivate() {},
      render() {},
      isActive: () => false,
      saveVocabulary: () => ({ status: 'unavailable', entry: null }),
      hasSavedWord: () => false,
      getVocabularyState: () => 'new',
    };
  }

  let active = false;
  let session = null;
  let currentIndex = 0;
  let phase = 'prompt';
  let hintIndex = -1;
  let hintUsed = false;
  let reviewedCount = 0;
  let secureCount = 0;
  let preferredFocusAction = '';
  let lastPausedItem = null;
  let creationError = '';
  let sourceNoteText = '';
  let editingItemId = '';
  let editingUpdatedAt = '';
  let libraryFilter = 'all';
  let libraryQuery = '';
  let retryQueue = [];
  let retryMode = false;
  let retryCount = 0;
  let missedItems = new Set();
  let orderMissed = false;
  let creationDraft = { prompt: '', answer: '', itemsText: '', orderMatters: false };
  const defaultControlsLabel = controlsRegion instanceof HTMLElement
    ? controlsRegion.getAttribute('aria-label') || ''
    : '';

  const getEntries = () => {
    const entries = loadEntries();
    return Array.isArray(entries) ? entries : [];
  };

  const refreshDueStatus = () => {
    const { due } = getPracticeSummary(getEntries(), { now: now() });
    if (dueBadge) {
      dueBadge.hidden = due === 0;
      dueBadge.textContent = due > 99 ? '99+' : String(due);
    }
    navigationButton?.setAttribute('aria-label', due
      ? `Go to Memory Coach, ${due} ${due === 1 ? 'memory' : 'memories'} ready for practice`
      : 'Go to Memory Coach');
    if (duePrompt) {
      duePrompt.hidden = due === 0;
      duePrompt.textContent = `Two-minute practice · ${due} ${due === 1 ? 'memory' : 'memories'} ready`;
    }
  };

  const syncModeUi = () => {
    modeBar?.classList.toggle('hidden', !active);
    if (launcher instanceof HTMLButtonElement) {
      launcher.setAttribute('aria-expanded', String(active));
      launcher.setAttribute('aria-pressed', String(active));
    }
    document.body?.classList.toggle('memory-coach-mode-active', active);
    if (controlsRegion instanceof HTMLElement) {
      controlsRegion.setAttribute(
        'aria-label',
        active ? 'Memory Coach controls' : defaultControlsLabel,
      );
    }
    if (modeLabel instanceof HTMLElement) {
      if (session?.total) {
        const displayedIndex = Math.min(currentIndex + 1, session.total);
        modeLabel.textContent = phase === 'complete'
          ? 'Complete'
          : `${displayedIndex} of ${session.total}`;
      } else {
        modeLabel.textContent = 'Practice';
      }
    }
  };

  const focusPreferredAction = () => {
    const selector = preferredFocusAction
      ? `[data-memory-coach-action="${preferredFocusAction}"]`
      : '[data-memory-coach-focus]';
    preferredFocusAction = '';
    const focusTarget = container.querySelector(selector) || container.querySelector('[data-memory-coach-focus]');
    if (!(focusTarget instanceof HTMLElement)) {
      return;
    }
    const focus = () => focusTarget.focus();
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focus);
    } else {
      window.setTimeout(focus, 0);
    }
  };

  const resetCardState = () => {
    phase = 'prompt';
    hintIndex = -1;
    hintUsed = false;
    missedItems = new Set();
    orderMissed = false;
  };

  const startSession = () => {
    session = createPracticeSession(getEntries(), {
      now: now(),
      limit: 5,
      maxNew: 2,
    });
    currentIndex = 0;
    reviewedCount = 0;
    secureCount = 0;
    retryQueue = [];
    retryMode = false;
    retryCount = 0;
    editingItemId = '';
    resetCardState();
  };

  const requestCoachRender = (focusAction = '') => {
    preferredFocusAction = focusAction;
    syncModeUi();
    requestRender();
  };

  const deactivate = ({ restoreFocus = true } = {}) => {
    if (!active) {
      return;
    }
    active = false;
    session = null;
    lastPausedItem = null;
    resetCardState();
    syncModeUi();
    requestRender();
    setStatus('');
    if (restoreFocus && launcher instanceof HTMLElement) {
      launcher.focus();
    }
  };

  const activate = () => {
    if (active) {
      return;
    }
    if (beforeActivate() === false) {
      return;
    }
    active = true;
    setStatus('');
    startSession();
    requestCoachRender('start');
  };

  const announceUpdatedItems = (successMessage) => {
    refreshDueStatus();
    const entries = getEntries();
    document.dispatchEvent(new CustomEvent('memoryCue:memoryCoachUpdated', {
      detail: { items: getMemoryCoachItems(entries, { includePaused: true, now: now() }) },
    }));
    if (successMessage) {
      setStatus(successMessage);
    }
  };

  const persistEntry = (entry, successMessage) => {
    const saved = updateEntry(entry);
    if (!saved) {
      setStatus('Memory Coach could not save that change.');
      return false;
    }
    announceUpdatedItems(successMessage);
    return true;
  };

  const hasSavedWord = (word) => {
    return getVocabularyState(word) !== 'new';
  };

  const getVocabularyState = (word) => {
    const normalizedWord = typeof word === 'string' ? word.trim().toLocaleLowerCase() : '';
    if (!normalizedWord) {
      return 'new';
    }
    const item = getMemoryCoachItems(getEntries(), { includePaused: true, now: now() })
      .find((candidate) => candidate.answer.toLocaleLowerCase() === normalizedWord);
    if (!item) {
      return 'new';
    }
    return item.enabled ? 'saved' : 'paused';
  };

  const saveVocabulary = (payload = {}) => {
    const result = addVocabularyPracticeEntry(getEntries(), payload, {
      createEntry,
      now: now(),
    });
    if (!['created', 'resumed'].includes(result.status)) {
      if (result.status === 'existing') {
        setStatus(`${result.entry?.metadata?.memoryCoach?.answer || 'That word'} is already saved for practice.`);
      }
      return result;
    }
    const label = result.entry?.metadata?.memoryCoach?.answer || payload.word || 'Word';
    if (result.status === 'resumed' && !persistEntry(result.entry, `${label} returned to practice.`)) {
      return { ...result, status: 'save_failed' };
    }
    if (result.status === 'created') {
      announceUpdatedItems(`${label} saved for practice.`);
    }
    if (active) {
      startSession();
      requestCoachRender('reveal');
    }
    return result;
  };

  const saveMemory = (payload = {}) => {
    const isList = payload.kind === 'list';
    creationDraft = {
      prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
      answer: typeof payload.answer === 'string' ? payload.answer : '',
      itemsText: typeof payload.itemsText === 'string' ? payload.itemsText : '',
      orderMatters: payload.orderMatters === true,
    };
    if (editingItemId) {
      const result = updatePracticeEntry(getEntries(), editingItemId, payload, {
        now: now(), expectedUpdatedAt: editingUpdatedAt,
      });
      if (!['updated', 'unchanged'].includes(result.status)) {
        creationError = result.status === 'conflict'
          ? 'This memory changed elsewhere. Cancel and reopen it to edit the latest version.'
          : result.status === 'missing'
            ? 'This memory is no longer available. Cancel to return to your library.'
            : 'Use a question and a short answer, or 2–20 list items of up to 120 characters each.';
        requestCoachRender();
        return result;
      }
      if (result.status === 'updated' && !persistEntry(result.entry, 'Memory updated.')) {
        creationError = 'Could not save these changes. Your draft is still here; try again.';
        requestCoachRender();
        return { ...result, status: 'save_failed' };
      }
      editingItemId = '';
      phase = 'library';
      requestCoachRender('back-to-practice');
      return result;
    }
    const result = addMemoryPracticeEntry(getEntries(), payload, {
      createEntry,
      now: now(),
    });
    if (result.status === 'existing') {
      creationError = 'That memory cue is already saved.';
      requestCoachRender('memory-answer');
      return result;
    }
    if (result.status === 'resumed') {
      if (!persistEntry(result.entry, 'Returned to recall practice.')) {
        return { ...result, status: 'save_failed' };
      }
      creationError = '';
      creationDraft = { prompt: '', answer: '', itemsText: '', orderMatters: false };
      startSession();
      requestCoachRender('start');
      return result;
    }
    if (result.status !== 'created') {
      creationError = isList
        ? 'Add a prompt and 2–20 list items, up to 120 characters each.'
        : 'Add both a memory prompt and what you want to remember.';
      requestCoachRender('memory-prompt');
      return result;
    }
    creationError = '';
    creationDraft = { prompt: '', answer: '', itemsText: '', orderMatters: false };
    announceUpdatedItems(isList ? 'List saved for recall practice.' : 'Saved for recall practice.');
    startSession();
    requestCoachRender('start');
    return result;
  };

  const appendButton = (actions, label, action, { primary = false, focus = false } = {}) => {
    const button = createElement('button', `memory-coach-button${primary ? ' memory-coach-button--primary' : ''}`, label);
    button.type = 'button';
    button.dataset.memoryCoachAction = action;
    if (focus) {
      button.dataset.memoryCoachFocus = 'true';
    }
    actions.appendChild(button);
    return button;
  };

  const appendCardHeader = (card, eyebrowText, titleText) => {
    const eyebrow = createElement('span', 'memory-coach-eyebrow', eyebrowText);
    const title = createElement('h3', 'memory-coach-title', titleText);
    title.id = 'memoryCoachCardTitle';
    card.setAttribute('aria-labelledby', title.id);
    card.append(eyebrow, title);
    return title;
  };

  const appendStats = (card, summary) => {
    const stats = createElement('div', 'memory-coach-stats');
    [
      ['Due', summary.due],
      ['Learning', summary.learning],
      ['Established', summary.established],
    ].forEach(([label, value]) => {
      const stat = createElement('span', 'memory-coach-stat');
      stat.append(
        createElement('strong', 'memory-coach-stat-value', String(value)),
        createElement('span', 'memory-coach-stat-label', label),
      );
      stats.appendChild(stat);
    });
    card.appendChild(stats);
  };

  const renderEmptyState = (card) => {
    appendCardHeader(card, 'Build your recall', 'Choose something meaningful to remember');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      'Practise names, facts, useful wording, steps, or personal details. Memory Cue brings them back at spaced intervals so you retrieve them instead of simply rereading them.',
    ));
    const actions = createElement('div', 'memory-coach-actions');
    appendButton(actions, 'Add memory', 'add-memory', { primary: true, focus: true });
    appendButton(actions, 'Remember a list', 'add-list');
    appendButton(actions, 'Use Word Help', 'find-word');
    card.appendChild(actions);
  };

  const renderCaughtUpState = (card, summary) => {
    appendCardHeader(card, 'Daily practice', 'You’re caught up');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      summary.nextDueAt
        ? `Your next memory returns ${formatNextReview(summary.nextDueAt, now())}.`
        : 'There is nothing waiting for review.',
    ));
    appendStats(card, summary);
    const actions = createElement('div', 'memory-coach-actions');
    appendButton(actions, 'Add memory', 'add-memory', { primary: true, focus: true });
    appendButton(actions, 'Remember a list', 'add-list');
    appendButton(actions, 'Use Word Help', 'find-word');
    card.appendChild(actions);
  };

  const appendCreationField = (form, { id, label, help, placeholder, maxLength, multiline = false }) => {
    const field = createElement('label', 'memory-coach-create-field');
    field.setAttribute('for', id);
    field.appendChild(createElement('span', 'memory-coach-create-label', label));
    if (help) {
      field.appendChild(createElement('span', 'memory-coach-create-help', help));
    }
    const input = createElement(multiline ? 'textarea' : 'input', 'memory-coach-create-input');
    input.id = id;
    input.name = id;
    if (multiline) {
      input.rows = 3;
      input.classList.add('memory-coach-create-textarea');
    } else {
      input.type = 'text';
    }
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    field.appendChild(input);
    form.appendChild(field);
    return input;
  };

  const renderCreateMemory = (card) => {
    appendCardHeader(card, editingItemId ? 'Edit memory' : 'New memory', 'What would you like to recall?');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      editingItemId
        ? 'Changing the question or answer restarts its review schedule and clears old clues. Paused memories stay paused.'
        : sourceNoteText
        ? 'Check this draft question and short excerpt. Edit them to practise one clear point.'
        : 'Use a specific prompt. The answer stays hidden while you practise retrieving it.',
    ));
    if (sourceNoteText) {
      const source = createElement('details', 'memory-coach-note-source');
      source.append(createElement('summary', '', 'Read source note'),
        createElement('p', 'memory-coach-source-text', sourceNoteText));
      card.appendChild(source);
    }
    const form = createElement('form', 'memory-coach-create-form');
    form.dataset.memoryCoachForm = 'create';
    const promptInput = appendCreationField(form, {
      id: 'memoryCoachNewPrompt',
      label: 'Memory prompt',
      help: 'What question or situation should trigger the memory?',
      placeholder: 'e.g. What is my new colleague’s name?',
      maxLength: 600,
      multiline: Boolean(sourceNoteText || editingItemId),
    });
    const answerInput = appendCreationField(form, {
      id: 'memoryCoachNewAnswer',
      label: 'What you want to remember',
      help: sourceNoteText ? 'One short answer, up to 120 characters.' : 'This remains hidden until you reveal it.',
      placeholder: 'e.g. Priya Shah',
      maxLength: 120,
      multiline: Boolean(sourceNoteText || editingItemId),
    });
    promptInput.enterKeyHint = 'next';
    answerInput.enterKeyHint = 'done';
    promptInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      event.preventDefault();
      answerInput.focus();
    });
    promptInput.value = creationDraft.prompt;
    answerInput.value = creationDraft.answer;
    if (creationError) {
      const error = createElement('p', 'memory-coach-create-error', creationError);
      error.setAttribute('role', 'alert');
      form.appendChild(error);
    }
    const actions = createElement('div', 'memory-coach-actions');
    const save = appendButton(actions, editingItemId ? 'Save changes' : 'Save for practice', 'save-memory', { primary: true });
    save.type = 'submit';
    appendButton(actions, 'Cancel', 'cancel-add-memory');
    form.appendChild(actions);
    card.appendChild(form);
    window.requestAnimationFrame?.(() => promptInput.focus());
  };

  const parseListItems = (value) => (
    typeof value === 'string'
      ? value
        .split(/\r?\n/)
        .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter((item, index, list) => item && list.indexOf(item) === index)
      : []
  );

  const renderCreateList = (card) => {
    appendCardHeader(card, editingItemId ? 'Edit list' : 'New list', 'What list would you like to remember?');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      editingItemId
        ? 'Changing this list restarts its review schedule and clears old clues. Paused lists stay paused.'
        : 'Add one item per line. The whole list stays hidden until you reveal it.',
    ));
    const form = createElement('form', 'memory-coach-create-form');
    form.dataset.memoryCoachForm = 'list';
    const promptInput = appendCreationField(form, {
      id: 'memoryCoachListPrompt',
      label: 'List prompt',
      help: 'What should make you recall this list?',
      placeholder: 'e.g. What do I need for football training?',
      maxLength: 600,
    });
    const itemsField = createElement('label', 'memory-coach-create-field');
    itemsField.setAttribute('for', 'memoryCoachListItems');
    itemsField.append(
      createElement('span', 'memory-coach-create-label', 'List items'),
      createElement('span', 'memory-coach-create-help', '2–20 items, up to 120 characters each.'),
    );
    const itemsInput = createElement('textarea', 'memory-coach-create-input memory-coach-create-textarea');
    itemsInput.id = 'memoryCoachListItems';
    itemsInput.name = 'memoryCoachListItems';
    itemsInput.placeholder = 'Boots\nWater bottle\nTowel';
    itemsInput.maxLength = 2400;
    itemsInput.rows = 5;
    itemsField.appendChild(itemsInput);
    form.appendChild(itemsField);

    const orderField = createElement('label', 'memory-coach-order-field');
    const orderInput = createElement('input');
    orderInput.type = 'checkbox';
    orderInput.id = 'memoryCoachListOrder';
    orderInput.checked = creationDraft.orderMatters;
    orderField.append(orderInput, createElement('span', '', 'Remember these in order'));
    form.appendChild(orderField);

    promptInput.value = creationDraft.prompt;
    itemsInput.value = creationDraft.itemsText;
    promptInput.enterKeyHint = 'next';
    promptInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      event.preventDefault();
      itemsInput.focus();
    });
    if (creationError) {
      const error = createElement('p', 'memory-coach-create-error', creationError);
      error.setAttribute('role', 'alert');
      form.appendChild(error);
    }
    const actions = createElement('div', 'memory-coach-actions');
    const save = appendButton(actions, editingItemId ? 'Save changes' : 'Save list for practice', 'save-list', { primary: true });
    save.type = 'submit';
    appendButton(actions, 'Cancel', 'cancel-add-memory');
    form.appendChild(actions);
    card.appendChild(form);
    window.requestAnimationFrame?.(() => promptInput.focus());
  };

  const renderPrompt = (card, item) => {
    appendCardHeader(card, `${retryMode ? 'Another try' : 'Memory'} ${currentIndex + 1} of ${session.total}`, 'Retrieve it before revealing');
    card.appendChild(createElement('p', 'memory-coach-prompt', item.prompt));
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      retryMode && item.kind === 'list'
        ? `Recall these ${item.items.length} ${item.items.length === 1 ? 'item' : 'items'} again${item.orderMatters ? `, at positions ${item.originalPositions.join(', ')} in the original list` : ''}.`
        : item.kind === 'list'
        ? `Recall all ${item.items.length} items${item.orderMatters ? ' in order' : ''} before revealing them.`
        : 'Say the answer aloud or bring it clearly to mind before revealing it.',
    ));
    if (retryMode) card.appendChild(createElement('p', 'memory-coach-copy', 'This extra attempt keeps your next scheduled review unchanged.'));
    const actions = createElement('div', 'memory-coach-actions');
    const hints = getPracticeHints(item);
    if (hints.length) {
      appendButton(actions, 'Need a clue', 'hint', { focus: true });
    }
    appendButton(actions, 'Show answer', 'reveal', { primary: true, focus: !hints.length });
    appendButton(actions, 'Pause this memory', 'pause');
    card.appendChild(actions);
  };

  const renderHint = (card, item) => {
    const hints = getPracticeHints(item);
    appendCardHeader(card, `Memory ${currentIndex + 1} of ${session.total}`, 'Use a clue, then retrieve');
    card.appendChild(createElement('p', 'memory-coach-prompt', item.prompt));
    const hint = createElement('div', 'memory-coach-hint');
    hint.append(
      createElement('span', 'memory-coach-hint-label', `Clue ${hintIndex + 1}`),
      createElement('p', 'memory-coach-hint-text', hints[hintIndex] || hints[0]),
    );
    card.appendChild(hint);
    const actions = createElement('div', 'memory-coach-actions');
    if (hintIndex < hints.length - 1) {
      appendButton(actions, 'Another clue', 'hint', { focus: true });
    }
    appendButton(actions, 'Show answer', 'reveal', { primary: true, focus: hintIndex >= hints.length - 1 });
    appendButton(actions, 'Pause this memory', 'pause');
    card.appendChild(actions);
  };

  const renderAnswer = (card, item) => {
    appendCardHeader(card, `Memory ${currentIndex + 1} of ${session.total}`, 'How did recall feel?');
    const answer = createElement('div', 'memory-coach-answer');
    if (item.kind === 'list' && item.items.length) {
      const list = createElement(item.orderMatters ? 'ol' : 'ul', 'memory-coach-answer-list');
      item.items.forEach((listItem, index) => {
        const row = createElement('li');
        if (item.orderMatters && item.originalPositions) row.value = item.originalPositions[index];
        const label = createElement('label', 'memory-coach-list-check');
        const checkbox = createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = missedItems.has(listItem);
        checkbox.setAttribute('aria-label', `I missed ${listItem}`);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) missedItems.add(listItem);
          else missedItems.delete(listItem);
          renderRatings();
        });
        label.append(checkbox, createElement('span', '', listItem));
        row.appendChild(label);
        list.appendChild(row);
      });
      answer.appendChild(createElement('p', 'memory-coach-copy', 'Tick the items you couldn’t recall.'));
      answer.appendChild(list);
      if (item.orderMatters) {
        const label = createElement('label', 'memory-coach-list-check');
        const checkbox = createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = orderMissed;
        checkbox.addEventListener('change', () => { orderMissed = checkbox.checked; renderRatings(); });
        label.append(checkbox, createElement('span', '', 'I mixed up the order'));
        answer.appendChild(label);
      }
    } else {
      answer.appendChild(createElement('strong', 'memory-coach-answer-word', item.answer));
    }
    if (item.explanation) {
      answer.appendChild(createElement('span', 'memory-coach-answer-detail', item.explanation));
    }
    if (item.example) {
      answer.appendChild(createElement('span', 'memory-coach-answer-detail', `Example: ${item.example}`));
    }
    card.appendChild(answer);
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      retryMode
        ? 'Another attempt helps you practise. Your scheduled review stays unchanged.'
        : hintUsed
        ? 'Using a clue means this memory will return sooner.'
        : 'Choose the honest answer. This adjusts when the memory returns.',
    ));
    const actions = createElement('div', 'memory-coach-actions memory-coach-rating-actions');
    const renderRatings = () => {
      actions.replaceChildren();
      if (missedItems.size || orderMissed) {
        appendButton(actions, retryMode ? 'Finish this attempt' : 'Practise missed items again', 'rate-forgot', { primary: true, focus: true });
        return;
      }
      Object.entries(RATING_LABELS).forEach(([rating, label], index) => {
        appendButton(actions, label, `rate-${rating}`, {
          primary: rating === 'got_it',
          focus: index === 0,
        });
      });
    };
    renderRatings();
    card.appendChild(actions);
  };

  const renderComplete = (card) => {
    const summary = getPracticeSummary(getEntries(), { now: now() });
    appendCardHeader(card, 'Practice complete', 'Good retrieval work');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      `You reviewed ${reviewedCount} ${reviewedCount === 1 ? 'memory' : 'memories'}. ${secureCount} felt secure without needing another pass.`,
    ));
    if (retryCount) card.appendChild(createElement('p', 'memory-coach-copy', `You also made ${retryCount} extra ${retryCount === 1 ? 'attempt' : 'attempts'}. Your spaced reviews remain scheduled.`));
    appendStats(card, summary);
    const actions = createElement('div', 'memory-coach-actions');
    if (summary.due > 0) {
      appendButton(actions, 'Continue practice', 'continue', { primary: true, focus: true });
    }
    appendButton(actions, 'Add memory', 'add-memory', {
      primary: summary.due === 0,
      focus: summary.due === 0,
    });
    appendButton(actions, 'Remember a list', 'add-list');
    appendButton(actions, 'Use Word Help', 'find-word');
    card.appendChild(actions);
  };

  const appendPauseUndo = (card) => {
    if (!lastPausedItem?.id) {
      return;
    }
    const actions = createElement('div', 'memory-coach-actions memory-coach-undo-actions');
    appendButton(
      actions,
      `Undo pause for “${lastPausedItem.answer}”`,
      'resume-paused',
    );
    card.appendChild(actions);
  };

  const renderRetryOffer = (card) => {
    appendCardHeader(card, 'One more chance', 'Practise what slipped away');
    card.appendChild(createElement('p', 'memory-coach-copy',
      `Try ${retryQueue.length === 1 ? 'this memory' : `these ${retryQueue.length} memories`} once more with the answers hidden. For lists, focus on the missed items. You can also finish for now.`));
    const actions = createElement('div', 'memory-coach-actions');
    appendButton(actions, 'Try again', 'start-retry', { primary: true, focus: true });
    appendButton(actions, 'Finish for now', 'skip-retry');
    card.appendChild(actions);
  };

  const renderLibrary = (card) => {
    appendCardHeader(card, 'Your practice collection', 'My memories');
    const actions = createElement('div', 'memory-coach-actions');
    appendButton(actions, 'Back to practice', 'back-to-practice', { focus: true });
    card.appendChild(actions);
    const search = appendCreationField(card, {
      id: 'memoryCoachLibrarySearch', label: 'Find a memory', help: '', placeholder: 'Search questions or answers', maxLength: 200,
    });
    search.type = 'search';
    search.value = libraryQuery;
    const filters = createElement('div', 'memory-coach-actions memory-coach-library-filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter memories');
    ['all', 'active', 'paused'].forEach((filter) => {
      const button = appendButton(filters, filter.charAt(0).toUpperCase() + filter.slice(1), `filter-${filter}`);
      button.setAttribute('aria-pressed', String(libraryFilter === filter));
    });
    card.appendChild(filters);
    const list = createElement('div', 'memory-coach-library');
    const drawList = () => {
      list.replaceChildren();
      const query = libraryQuery.trim().toLocaleLowerCase();
      const items = getMemoryCoachItems(getEntries(), { includePaused: true, now: now() }).filter((item) => (
        (libraryFilter === 'all' || item.enabled === (libraryFilter === 'active'))
        && (!query || [item.prompt, item.answer, ...item.items].join(' ').toLocaleLowerCase().includes(query))
      ));
      if (!items.length) list.appendChild(createElement('p', 'memory-coach-copy', 'No memories match this view.'));
      items.forEach((item) => {
        const row = createElement('article', 'memory-coach-library-item');
        row.appendChild(createElement('h4', 'memory-coach-library-question', item.prompt));
        row.appendChild(createElement('p', 'memory-coach-library-status', item.enabled
          ? `Active · ${formatNextReview(item.dueAt, now())}` : 'Paused'));
        const answer = createElement('details');
        answer.appendChild(createElement('summary', '', 'View answer'));
        answer.appendChild(createElement('p', 'memory-coach-source-text', item.kind === 'list'
          ? item.items.map((text, index) => `${item.orderMatters ? `${index + 1}.` : '•'} ${text}`).join('\n')
          : item.answer));
        if (item.lastMissedItems.length) answer.appendChild(createElement('p', 'memory-coach-copy', `Last review: missed ${item.lastMissedItems.join(', ')}.`));
        if (item.lastOrderMissed) answer.appendChild(createElement('p', 'memory-coach-copy', 'Last review: order needs practice.'));
        row.appendChild(answer);
        const rowActions = createElement('div', 'memory-coach-actions');
        appendButton(rowActions, 'Edit', 'edit-memory').dataset.memoryCoachId = item.id;
        appendButton(rowActions, item.enabled ? 'Pause' : 'Resume', 'toggle-memory').dataset.memoryCoachId = item.id;
        row.appendChild(rowActions);
        list.appendChild(row);
      });
    };
    search.addEventListener('input', () => { libraryQuery = search.value; drawList(); });
    drawList();
    card.appendChild(list);
  };

  const openEditMemory = (id) => {
    const item = getMemoryCoachItems(getEntries(), { includePaused: true, now: now() }).find((entry) => entry.id === id);
    if (!item) return;
    editingItemId = item.id;
    editingUpdatedAt = item.updatedAt;
    sourceNoteText = '';
    creationError = '';
    creationDraft = { prompt: item.prompt, answer: item.answer, itemsText: item.items.join('\n'), orderMatters: item.orderMatters };
    phase = item.kind === 'list' ? 'create-list' : 'create';
    requestCoachRender();
  };

  const currentItem = () => {
    const itemId = session?.itemIds?.[currentIndex];
    if (!itemId) {
      return null;
    }
    const item = getMemoryCoachItems(getEntries(), { now: now() }).find((entry) => entry.id === itemId);
    if (!item) return null;
    const retry = retryMode ? retryQueue.find((entry) => entry.id === itemId) : null;
    if (retry && item.kind === 'list') {
      const positions = item.items.map((text, index) => ({ text, position: index + 1 }))
        .filter((entry) => retry.orderMissed || !retry.missedItems.length || retry.missedItems.includes(entry.text));
      if (!positions.length) return null;
      return { ...item, items: positions.map((entry) => entry.text), originalPositions: positions.map((entry) => entry.position) };
    }
    return item;
  };

  const advanceSession = () => {
    if (retryMode) retryCount += 1;
    else reviewedCount += 1;
    currentIndex += 1;
    resetCardState();
    if (!session || currentIndex >= session.total) {
      phase = !retryMode && retryQueue.length ? 'retry-offer' : 'complete';
      requestCoachRender('continue');
      return;
    }
    requestCoachRender('hint');
  };

  const rateCurrentItem = (rating) => {
    if (phase !== 'answer') return;
    const item = currentItem();
    if (!item) {
      advanceSession();
      return;
    }
    const failed = rating === 'forgot' || missedItems.size > 0 || orderMissed;
    const missed = item.kind === 'list'
      ? (missedItems.size ? [...missedItems] : failed && !orderMissed ? [...item.items] : [])
      : [];
    const result = recordPracticeResult(getEntries(), item.id, failed ? 'forgot' : rating, {
      now: now(),
      hintUsed,
      missedItems: missed,
      orderMissed,
      isRetry: retryMode,
    });
    if (!result.updated || !persistEntry(result.item?.entry)) {
      return;
    }
    if (failed && !retryMode) retryQueue.push({ id: item.id, missedItems: missed, orderMissed });
    if (rating === 'got_it' && !hintUsed && !failed && !retryMode) {
      secureCount += 1;
    }
    advanceSession();
  };

  const pauseCurrentItem = () => {
    const item = currentItem();
    if (!item) {
      return;
    }
    const result = setPracticeItemEnabled(getEntries(), item.id, false, { now: now() });
    if (!result.updated || !persistEntry(result.item?.entry)) {
      return;
    }
    lastPausedItem = { id: item.id, answer: item.kind === 'list' ? item.prompt : item.answer };
    session.itemIds.splice(currentIndex, 1);
    session.total = session.itemIds.length;
    resetCardState();
    if (!session.total || currentIndex >= session.total) {
      phase = !retryMode && retryQueue.length ? 'retry-offer' : 'complete';
    }
    requestCoachRender('done');
  };

  const resumeLastPausedItem = () => {
    if (!lastPausedItem?.id) {
      return;
    }
    const result = setPracticeItemEnabled(getEntries(), lastPausedItem.id, true, { now: now() });
    if (!result.updated || !persistEntry(result.item?.entry)) {
      return;
    }
    lastPausedItem = null;
    startSession();
    requestCoachRender('hint');
  };

  const handleCardClick = (event) => {
    if (!active) {
      return;
    }
    const button = event.target instanceof Element
      ? event.target.closest('[data-memory-coach-action]')
      : null;
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const action = button.dataset.memoryCoachAction || '';
    if (action === 'library') {
      phase = 'library';
      editingItemId = '';
      requestCoachRender('back-to-practice');
    } else if (action === 'back-to-practice') {
      startSession();
      requestCoachRender();
    } else if (action.startsWith('filter-')) {
      libraryFilter = action.slice(7);
      requestCoachRender(action);
    } else if (action === 'edit-memory') {
      openEditMemory(button.dataset.memoryCoachId);
    } else if (action === 'toggle-memory') {
      const item = getMemoryCoachItems(getEntries(), { includePaused: true, now: now() }).find((entry) => entry.id === button.dataset.memoryCoachId);
      if (!item) return;
      const result = setPracticeItemEnabled(getEntries(), item.id, !item.enabled, { now: now() });
      if (result.updated && persistEntry(result.item.entry, item.enabled ? 'Memory paused.' : 'Memory resumed.')) requestCoachRender('back-to-practice');
    } else if (action === 'start-retry') {
      retryMode = true;
      session = { itemIds: retryQueue.map((item) => item.id), total: retryQueue.length };
      currentIndex = 0;
      resetCardState();
      requestCoachRender();
    } else if (action === 'skip-retry') {
      phase = 'complete';
      requestCoachRender();
    } else if (action === 'hint') {
      const item = currentItem();
      const hints = getPracticeHints(item);
      hintUsed = true;
      phase = 'hint';
      hintIndex = Math.min(hints.length - 1, hintIndex + 1);
      requestCoachRender(hintIndex < hints.length - 1 ? 'hint' : 'reveal');
    } else if (action === 'reveal') {
      phase = 'answer';
      requestCoachRender('rate-forgot');
    } else if (action.startsWith('rate-')) {
      rateCurrentItem(action.replace('rate-', ''));
    } else if (action === 'pause') {
      pauseCurrentItem();
    } else if (action === 'resume-paused') {
      resumeLastPausedItem();
    } else if (action === 'continue') {
      startSession();
      requestCoachRender('hint');
    } else if (action === 'add-memory') {
      editingItemId = '';
      sourceNoteText = '';
      creationError = '';
      creationDraft = { prompt: '', answer: '', itemsText: '', orderMatters: false };
      phase = 'create';
      requestCoachRender('memory-prompt');
    } else if (action === 'add-list') {
      editingItemId = '';
      sourceNoteText = '';
      creationError = '';
      creationDraft = { prompt: '', answer: '', itemsText: '', orderMatters: false };
      phase = 'create-list';
      requestCoachRender('list-prompt');
    } else if (action === 'cancel-add-memory') {
      creationError = '';
      creationDraft = { prompt: '', answer: '', itemsText: '', orderMatters: false };
      if (editingItemId) {
        editingItemId = '';
        phase = 'library';
      } else startSession();
      requestCoachRender('start');
    } else if (action === 'find-word') {
      deactivate({ restoreFocus: false });
      onFindWord();
    } else if (action === 'done') {
      deactivate();
    }
  };

  const render = () => {
    if (!active) {
      return false;
    }
    syncModeUi();
    container.innerHTML = '';
    const card = createElement('section', 'memory-coach-card');
    card.setAttribute('role', 'region');

    const entries = getEntries();
    const summary = getPracticeSummary(entries, { now: now() });
    if (phase === 'library') {
      renderLibrary(card);
    } else if (phase === 'retry-offer') {
      renderRetryOffer(card);
    } else if (phase === 'create') {
      renderCreateMemory(card);
    } else if (phase === 'create-list') {
      renderCreateList(card);
    } else if (!summary.total) {
      renderEmptyState(card);
    } else if (!session?.total && phase !== 'complete') {
      renderCaughtUpState(card, summary);
    } else if (phase === 'complete') {
      renderComplete(card);
    } else {
      let item = currentItem();
      while (!item && currentIndex < session.total - 1) {
        currentIndex += 1;
        resetCardState();
        item = currentItem();
      }
      if (!item) {
        phase = 'complete';
        renderComplete(card);
      } else if (phase === 'answer') {
        renderAnswer(card, item);
      } else if (phase === 'hint') {
        renderHint(card, item);
      } else {
        renderPrompt(card, item);
      }
    }

    appendPauseUndo(card);

    if (phase !== 'library' && !editingItemId && !['create', 'create-list'].includes(phase)
      && getMemoryCoachItems(entries, { includePaused: true, now: now() }).length) {
      const toolbar = createElement('div', 'memory-coach-toolbar');
      appendButton(toolbar, 'My memories', 'library');
      container.appendChild(toolbar);
    }

    container.appendChild(card);
    focusPreferredAction();
    return true;
  };

  container.addEventListener('click', handleCardClick);
  container.addEventListener('input', (event) => {
    const field = event.target;
    if (field.id === 'memoryCoachNewPrompt' || field.id === 'memoryCoachListPrompt') creationDraft.prompt = field.value;
    if (field.id === 'memoryCoachNewAnswer') creationDraft.answer = field.value;
    if (field.id === 'memoryCoachListItems') creationDraft.itemsText = field.value;
    if (field.id === 'memoryCoachListOrder') creationDraft.orderMatters = field.checked;
  });
  container.addEventListener('submit', (event) => {
    const form = event.target instanceof Element
      ? event.target.closest('[data-memory-coach-form]')
      : null;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    event.preventDefault();
    if (form.dataset.memoryCoachForm === 'list') {
      const itemsText = form.querySelector('#memoryCoachListItems')?.value || '';
      saveMemory({
        prompt: form.querySelector('#memoryCoachListPrompt')?.value,
        itemsText,
        items: parseListItems(itemsText),
        orderMatters: form.querySelector('#memoryCoachListOrder')?.checked === true,
        kind: 'list',
      });
    } else {
      saveMemory({
        prompt: form.querySelector('#memoryCoachNewPrompt')?.value,
        answer: form.querySelector('#memoryCoachNewAnswer')?.value,
        kind: 'memory',
      });
    }
  });
  launcher?.addEventListener('click', () => {
    if (active) {
      deactivate();
    } else {
      activate();
    }
  });
  exitButton?.addEventListener('click', () => deactivate());

  const handleEscape = (event) => {
    if (event.key !== 'Escape' || !active) {
      return;
    }
    event.preventDefault();
    if (navigationView) {
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'capture' } }));
    } else {
      deactivate();
    }
  };
  document.addEventListener('keydown', handleEscape);

  const handleNavigation = (event) => {
    const targetView = event?.detail?.view || '';
    if (navigationView && targetView === navigationView) {
      activate();
    } else if (active && targetView !== (navigationView || 'capture')) {
      deactivate({ restoreFocus: false });
    }
  };
  window.addEventListener('memorycue:navigation:changed', handleNavigation);
  const openNoteDraft = ({ title = '', text = '' } = {}) => {
    const source = typeof text === 'string' ? text.trim() : '';
    if (!source) return false;
    activate();
    if (!active) return false;
    editingItemId = '';
    sourceNoteText = source;
    const firstLine = source.split(/\r?\n/).find((line) => line.trim()) || source;
    // Offer a source-grounded excerpt, never an invented answer. The source remains available.
    const firstSentence = firstLine.trim().match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
    const excerpt = firstSentence && firstSentence.length <= 120 ? firstSentence : firstLine.trim().slice(0, 120);
    const noteTitle = typeof title === 'string' ? title.trim().slice(0, 160) : '';
    const titleRepeatsSource = noteTitle && source.startsWith(noteTitle.replace(/(?:\.{3}|…)$/, '').trim());
    creationDraft = {
      prompt: noteTitle && !titleRepeatsSource ? `What should I remember about “${noteTitle}”?` : 'What is the key point of this note?',
      answer: excerpt,
      itemsText: '',
      orderMatters: false,
    };
    creationError = '';
    phase = 'create';
    requestCoachRender('memory-prompt');
    return true;
  };
  if (dueBadge || duePrompt) {
    document.addEventListener('memoryCue:entriesUpdated', refreshDueStatus);
    window.addEventListener('storage', refreshDueStatus);
    window.addEventListener('focus', refreshDueStatus);
    document.addEventListener('visibilitychange', refreshDueStatus);
    window.setInterval(() => {
      if (!document.hidden) refreshDueStatus();
    }, 60000);
    duePrompt?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'coach' } }));
    });
    refreshDueStatus();
  }
  syncModeUi();

  return {
    activate,
    deactivate,
    render,
    isActive: () => active,
    saveVocabulary,
    saveMemory,
    openNoteDraft,
    refreshDueStatus,
    hasSavedWord,
    getVocabularyState,
  };
};
