import {
  addVocabularyPracticeEntry,
  createPracticeSession,
  getMemoryCoachItems,
  getPracticeSummary,
  maskPracticeAnswer,
  recordPracticeResult,
  setPracticeItemEnabled,
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
  const maskedExample = maskPracticeAnswer(item?.example, item?.answer);
  if (maskedExample && maskedExample !== item?.example) {
    hints.push(`Complete the example: ${maskedExample}`);
  }
  const answer = typeof item?.answer === 'string' ? item.answer.trim() : '';
  if (answer) {
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
  const defaultControlsLabel = controlsRegion instanceof HTMLElement
    ? controlsRegion.getAttribute('aria-label') || ''
    : '';

  const getEntries = () => {
    const entries = loadEntries();
    return Array.isArray(entries) ? entries : [];
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
    appendCardHeader(card, 'Personal recall', 'Save your first word to practise');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      'Find a useful word, then choose “Learn”. Memory Cue will bring it back when it is time to practise.',
    ));
    const actions = createElement('div', 'memory-coach-actions');
    appendButton(actions, 'Find a word', 'find-word', { primary: true, focus: true });
    card.appendChild(actions);
  };

  const renderCaughtUpState = (card, summary) => {
    appendCardHeader(card, 'Daily practice', 'You’re caught up');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      summary.nextDueAt
        ? `Your next word returns ${formatNextReview(summary.nextDueAt, now())}.`
        : 'There are no words waiting for review.',
    ));
    appendStats(card, summary);
    const actions = createElement('div', 'memory-coach-actions');
    appendButton(actions, 'Find another word', 'find-word', { primary: true, focus: true });
    card.appendChild(actions);
  };

  const renderPrompt = (card, item) => {
    appendCardHeader(card, `Card ${currentIndex + 1} of ${session.total}`, 'Recall the word');
    card.appendChild(createElement('p', 'memory-coach-prompt', item.prompt));
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      'Say the word aloud or bring it clearly to mind before revealing it.',
    ));
    const actions = createElement('div', 'memory-coach-actions');
    const hints = getPracticeHints(item);
    if (hints.length) {
      appendButton(actions, 'Need a clue', 'hint', { focus: true });
    }
    appendButton(actions, 'Show answer', 'reveal', { primary: true, focus: !hints.length });
    appendButton(actions, 'Pause this word', 'pause');
    card.appendChild(actions);
  };

  const renderHint = (card, item) => {
    const hints = getPracticeHints(item);
    appendCardHeader(card, `Card ${currentIndex + 1} of ${session.total}`, 'Use a clue, then retrieve');
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
    appendButton(actions, 'Pause this word', 'pause');
    card.appendChild(actions);
  };

  const renderAnswer = (card, item) => {
    appendCardHeader(card, `Card ${currentIndex + 1} of ${session.total}`, 'How did recall feel?');
    const answer = createElement('div', 'memory-coach-answer');
    answer.appendChild(createElement('strong', 'memory-coach-answer-word', item.answer));
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
      hintUsed
        ? 'Using a clue means this word will return sooner.'
        : 'Choose the honest answer. This adjusts when the word returns.',
    ));
    const actions = createElement('div', 'memory-coach-actions memory-coach-rating-actions');
    Object.entries(RATING_LABELS).forEach(([rating, label], index) => {
      appendButton(actions, label, `rate-${rating}`, {
        primary: rating === 'got_it',
        focus: index === 0,
      });
    });
    card.appendChild(actions);
  };

  const renderComplete = (card) => {
    const summary = getPracticeSummary(getEntries(), { now: now() });
    appendCardHeader(card, 'Practice complete', 'Good retrieval work');
    card.appendChild(createElement(
      'p',
      'memory-coach-copy',
      `You reviewed ${reviewedCount} ${reviewedCount === 1 ? 'word' : 'words'}. ${secureCount} felt secure without needing another pass.`,
    ));
    appendStats(card, summary);
    const actions = createElement('div', 'memory-coach-actions');
    if (summary.due > 0) {
      appendButton(actions, 'Continue practice', 'continue', { primary: true, focus: true });
    }
    appendButton(actions, 'Find another word', 'find-word', {
      primary: summary.due === 0,
      focus: summary.due === 0,
    });
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

  const currentItem = () => {
    const itemId = session?.itemIds?.[currentIndex];
    if (!itemId) {
      return null;
    }
    return getMemoryCoachItems(getEntries(), { includePaused: true, now: now() })
      .find((item) => item.id === itemId) || null;
  };

  const advanceSession = () => {
    reviewedCount += 1;
    currentIndex += 1;
    resetCardState();
    if (!session || currentIndex >= session.total) {
      phase = 'complete';
      requestCoachRender('continue');
      return;
    }
    requestCoachRender('hint');
  };

  const rateCurrentItem = (rating) => {
    const item = currentItem();
    if (!item) {
      advanceSession();
      return;
    }
    const result = recordPracticeResult(getEntries(), item.id, rating, {
      now: now(),
      hintUsed,
    });
    if (!result.updated || !persistEntry(result.item?.entry)) {
      return;
    }
    if (rating === 'got_it' && !hintUsed) {
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
    lastPausedItem = { id: item.id, answer: item.answer };
    session.itemIds.splice(currentIndex, 1);
    session.total = session.itemIds.length;
    resetCardState();
    if (!session.total || currentIndex >= session.total) {
      phase = 'complete';
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
    if (action === 'hint') {
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
    if (!summary.total) {
      renderEmptyState(card);
    } else if (!session?.total && phase !== 'complete') {
      renderCaughtUpState(card, summary);
    } else if (phase === 'complete') {
      renderComplete(card);
    } else {
      const item = currentItem();
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

    container.appendChild(card);
    focusPreferredAction();
    return true;
  };

  container.addEventListener('click', handleCardClick);
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
    deactivate();
  };
  document.addEventListener('keydown', handleEscape);

  const handleNavigation = (event) => {
    if (active && event?.detail?.view !== 'capture') {
      deactivate({ restoreFocus: false });
    }
  };
  window.addEventListener('memorycue:navigation:changed', handleNavigation);
  syncModeUi();

  return {
    activate,
    deactivate,
    render,
    isActive: () => active,
    saveVocabulary,
    hasSavedWord,
    getVocabularyState,
  };
};
