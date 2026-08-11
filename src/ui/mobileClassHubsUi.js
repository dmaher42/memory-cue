const CLASS_FOLLOW_UP_TYPE = 'class-follow-up';
const CLASS_LIST_CUE_TYPE = 'class-list-cue';

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const isClassLinkedReminder = (reminder, hubId) => {
  const metadata = reminder?.metadata;
  return Boolean(
    metadata
      && (metadata.type === CLASS_FOLLOW_UP_TYPE || metadata.type === CLASS_LIST_CUE_TYPE)
      && String(metadata.classHubId || '') === String(hubId || ''),
  );
};

const isCompletedReminder = (reminder) => (
  reminder?.completed === true || reminder?.done === true || reminder?.status === 'done'
);

const getReminderLabel = (reminder) => (
  normalizeText(reminder?.text) || normalizeText(reminder?.title) || 'Untitled follow-up'
);

const formatDueLabel = (reminder) => {
  const timestamp = Number(reminder?.dueAt) || Date.parse(reminder?.due || reminder?.dueDate || '');
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
};

const createLocalDueAt = (dateValue, timeValue) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeText(dateValue));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(normalizeText(timeValue));
  if (!dateMatch || !timeMatch) {
    return null;
  }
  const date = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const getLocalDateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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

const isDialogElement = (value) => (
  value instanceof HTMLElement && value.tagName === 'DIALOG'
);

export function initMobileClassHubsUi(options = {}) {
  if (typeof document === 'undefined') {
    return { render: () => {}, openHub: () => {}, closeHub: () => {}, destroy: () => {} };
  }

  const {
    rootElement = null,
    getClassHubFolders = () => [],
    createClassHubFolder = () => ({ status: 'error', folder: null }),
    getNotes = () => [],
    getReminders = () => [],
    createReminder = () => null,
    setReminderCompleted = () => null,
    openReminder = () => false,
    openNote = () => false,
    startFullNote = () => false,
    startAiOrganize = () => false,
  } = options;

  if (!(rootElement instanceof HTMLElement)) {
    return { render: () => {}, openHub: () => {}, closeHub: () => {}, destroy: () => {} };
  }


  let activeHubId = null;
  let focusHubIdAfterBack = null;
  let statusMessage = '';
  let createDialog = null;
  let followUpDialog = null;
  let dialogFocusRestore = null;

  const readHubs = () => {
    try {
      return (Array.isArray(getClassHubFolders()) ? getClassHubFolders() : [])
        .filter((folder) => folder && normalizeText(folder.id) && normalizeText(folder.name));
    } catch {
      return [];
    }
  };

  const readNotes = () => {
    try {
      return Array.isArray(getNotes()) ? getNotes() : [];
    } catch {
      return [];
    }
  };

  const readReminders = () => {
    try {
      return Array.isArray(getReminders()) ? getReminders() : [];
    } catch {
      return [];
    }
  };

  const getActiveHub = () => readHubs().find((folder) => String(folder.id) === String(activeHubId)) || null;
  const getHubNotes = (hubId) => readNotes()
    .filter((note) => String(note?.folderId || '') === String(hubId))
    .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || '') - Date.parse(a?.updatedAt || a?.createdAt || ''));
  const getHubReminders = (hubId) => readReminders()
    .filter((reminder) => isClassLinkedReminder(reminder, hubId))
    .sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));

  const updateStatus = (message = '') => {
    statusMessage = message;
    const liveRegion = rootElement.querySelector('[data-class-hub-status]');
    if (liveRegion instanceof HTMLElement) {
      liveRegion.textContent = statusMessage;
    }
  };

  const focusSoon = (selector, { resetMainScroll = false } = {}) => {
    setTimeout(() => {
      if (resetMainScroll) {
        const mainElement = rootElement.closest('main');
        if (mainElement instanceof HTMLElement) {
          mainElement.scrollTop = 0;
        }
      }
      const target = rootElement.querySelector(selector);
      if (target instanceof HTMLElement) {
        try { target.focus({ preventScroll: true }); } catch { target.focus(); }
      }
    }, 0);
  };

  const showDialog = (dialog, focusSelector) => {
    if (!isDialogElement(dialog)) {
      return;
    }
    dialogFocusRestore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    } catch {
      dialog.setAttribute('open', '');
    }
    setTimeout(() => {
      const focusTarget = dialog.querySelector(focusSelector);
      if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
      }
    }, 0);
  };

  const closeDialog = (dialog) => {
    if (!isDialogElement(dialog)) {
      return;
    }
    try {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    } catch {
      dialog.removeAttribute('open');
    }
    const restoreTarget = dialogFocusRestore;
    dialogFocusRestore = null;
    if (restoreTarget?.isConnected) {
      setTimeout(() => restoreTarget.focus(), 0);
    }
  };

  const ensureCreateDialog = () => {
    if (isDialogElement(createDialog)) return createDialog;
    createDialog = document.createElement('dialog');
    createDialog.id = 'createClassHubDialog';
    createDialog.className = 'class-hub-dialog';
    createDialog.innerHTML = `
      <form class="class-hub-dialog-card" data-class-hub-create-form>
        <h2 class="class-hub-dialog-title">Create class hub</h2>
        <label class="class-hub-dialog-label">
          Class name
          <input class="class-hub-dialog-input" name="className" maxlength="80" required autocomplete="off" placeholder="e.g. Year 8 HPE" />
        </label>
        <p class="class-hub-dialog-error" data-class-hub-dialog-error aria-live="polite"></p>
        <div class="class-hub-dialog-actions">
          <button class="class-hub-action" type="button" data-dialog-cancel>Cancel</button>
          <button class="class-hub-action class-hub-action--primary" type="submit">Create hub</button>
        </div>
      </form>
    `;
    document.body.appendChild(createDialog);
    createDialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => closeDialog(createDialog));
    createDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(createDialog);
    });
    createDialog.querySelector('[data-class-hub-create-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = createDialog.querySelector('[name="className"]');
      const error = createDialog.querySelector('[data-class-hub-dialog-error]');
      const name = normalizeText(input?.value);
      if (!name) {
        if (error) error.textContent = 'Enter a class name.';
        input?.focus();
        return;
      }
      let result;
      try {
        result = await Promise.resolve(createClassHubFolder(name));
      } catch {
        result = { status: 'error', folder: null };
      }
      if (result?.folder && (result.status === 'created' || result.status === 'duplicate')) {
        closeDialog(createDialog);
        if (input) input.value = '';
        activeHubId = result.folder.id;
        statusMessage = result.status === 'duplicate' ? 'That class already exists. Opened it for you.' : 'Class hub created.';
        render();
        focusSoon('[data-class-hub-heading]');
        return;
      }
      if (error) {
        error.textContent = result?.status === 'invalid'
          ? 'Enter a class name.'
          : result?.status === 'reserved'
            ? 'That name is already used by a standard Notes folder.'
            : 'The class hub could not be saved. Try again.';
      }
    });
    return createDialog;
  };

  const ensureFollowUpDialog = () => {
    if (isDialogElement(followUpDialog)) return followUpDialog;
    followUpDialog = document.createElement('dialog');
    followUpDialog.id = 'classFollowUpDialog';
    followUpDialog.className = 'class-hub-dialog';
    followUpDialog.innerHTML = `
      <form class="class-hub-dialog-card" data-class-follow-up-form>
        <h2 class="class-hub-dialog-title" data-class-follow-up-title>Add class follow-up</h2>
        <label class="class-hub-dialog-label">
          What needs to happen?
          <input class="class-hub-dialog-input" name="followUpText" maxlength="240" required autocomplete="off" />
        </label>
        <div class="class-hub-dialog-grid" data-class-cue-schedule hidden>
          <label class="class-hub-dialog-label">
            Date
            <input class="class-hub-dialog-input" name="followUpDate" type="date" />
          </label>
          <label class="class-hub-dialog-label">
            Time
            <input class="class-hub-dialog-input" name="followUpTime" type="time" />
          </label>
        </div>
        <p class="class-hub-dialog-error" data-class-follow-up-error aria-live="polite"></p>
        <div class="class-hub-dialog-actions">
          <button class="class-hub-action" type="button" data-dialog-cancel>Cancel</button>
          <button class="class-hub-action class-hub-action--primary" type="submit" data-class-follow-up-submit>Add to list</button>
        </div>
      </form>
    `;
    document.body.appendChild(followUpDialog);
    followUpDialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => closeDialog(followUpDialog));
    followUpDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(followUpDialog);
    });
    followUpDialog.querySelector('[data-class-follow-up-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const hub = getActiveHub();
      const textInput = followUpDialog.querySelector('[name="followUpText"]');
      const dateInput = followUpDialog.querySelector('[name="followUpDate"]');
      const timeInput = followUpDialog.querySelector('[name="followUpTime"]');
      const error = followUpDialog.querySelector('[data-class-follow-up-error]');
      const mode = followUpDialog.dataset.mode === 'cue' ? 'cue' : 'follow-up';
      const text = normalizeText(textInput?.value);
      if (!hub || !text) {
        if (error) error.textContent = 'Enter a follow-up.';
        textInput?.focus();
        return;
      }
      const dueAt = mode === 'cue' ? createLocalDueAt(dateInput?.value, timeInput?.value) : null;
      if (mode === 'cue' && !dueAt) {
        if (error) error.textContent = 'Choose both a date and time for the reminder.';
        (dateInput?.value ? timeInput : dateInput)?.focus();
        return;
      }
      if (mode === 'cue' && dueAt <= Date.now()) {
        if (error) error.textContent = 'Choose a future date and time.';
        dateInput?.focus();
        return;
      }
      let created = null;
      try {
        created = await Promise.resolve(createReminder({
          text,
          title: text,
          dueAt,
          due: dueAt,
          notifyAt: dueAt,
          category: 'School',
          priority: 'Medium',
          source: 'manual',
          metadata: {
            type: mode === 'cue' ? CLASS_LIST_CUE_TYPE : CLASS_FOLLOW_UP_TYPE,
            classHubId: hub.id,
            classHubName: hub.name,
            suppressNotification: mode !== 'cue',
          },
        }, {
          closeSheet: false,
          activityAction: 'created',
          activityLabelPrefix: mode === 'cue' ? 'Class list reminder added' : 'Class follow-up added',
        }));
      } catch {
        created = null;
      }
      if (!created) {
        if (error) error.textContent = 'The follow-up could not be saved. Try again.';
        return;
      }
      closeDialog(followUpDialog);
      if (textInput) textInput.value = '';
      if (dateInput) dateInput.value = '';
      if (timeInput) timeInput.value = '';
      statusMessage = mode === 'cue' ? 'Check-list reminder set.' : 'Follow-up added.';
      render();
      focusSoon('[data-class-hub-add-follow-up]');
    });
    return followUpDialog;
  };

  const openCreateDialog = () => {
    const dialog = ensureCreateDialog();
    const error = dialog.querySelector('[data-class-hub-dialog-error]');
    if (error) error.textContent = '';
    showDialog(dialog, '[name="className"]');
  };

  const openFollowUpDialog = (mode = 'follow-up') => {
    const hub = getActiveHub();
    if (!hub) return;
    const dialog = ensureFollowUpDialog();
    const cueMode = mode === 'cue';
    dialog.dataset.mode = cueMode ? 'cue' : 'follow-up';
    const title = dialog.querySelector('[data-class-follow-up-title]');
    const schedule = dialog.querySelector('[data-class-cue-schedule]');
    const submit = dialog.querySelector('[data-class-follow-up-submit]');
    const textInput = dialog.querySelector('[name="followUpText"]');
    const dateInput = dialog.querySelector('[name="followUpDate"]');
    const timeInput = dialog.querySelector('[name="followUpTime"]');
    const error = dialog.querySelector('[data-class-follow-up-error]');
    if (title) title.textContent = cueMode ? 'Remind me to check this list' : 'Add class follow-up';
    if (schedule instanceof HTMLElement) schedule.hidden = !cueMode;
    if (submit) submit.textContent = cueMode ? 'Set reminder' : 'Add to list';
    if (textInput) textInput.value = cueMode ? `Check ${hub.name} class list` : '';
    if (dateInput) {
      dateInput.required = cueMode;
      dateInput.min = cueMode ? getLocalDateInputValue() : '';
    }
    if (timeInput) timeInput.required = cueMode;
    if (error) error.textContent = '';
    showDialog(dialog, cueMode ? '[name="followUpDate"]' : '[name="followUpText"]');
  };

  const buildStatus = () => {
    const status = createElement('p', 'class-hub-status');
    status.dataset.classHubStatus = 'true';
    status.setAttribute('aria-live', 'polite');
    status.textContent = statusMessage;
    return status;
  };

  const buildHubRow = (hub) => {
    const notes = getHubNotes(hub.id);
    const reminders = getHubReminders(hub.id);
    const openCount = reminders.filter((item) => !isCompletedReminder(item)).length;
    const item = createElement('li', 'class-hub-row');
    const button = createElement('button', 'class-hub-row-button');
    button.type = 'button';
    button.dataset.classHubOpen = hub.id;
    button.setAttribute('aria-label', `Open ${hub.name}. ${openCount} open follow-ups and ${notes.length} notes.`);
    const copy = createElement('span');
    const name = createElement('span', 'class-hub-row-name', hub.name);
    const meta = createElement('span', 'class-hub-row-meta', `${openCount} open follow-up${openCount === 1 ? '' : 's'} - ${notes.length} note${notes.length === 1 ? '' : 's'}`);
    copy.append(name, meta);
    button.append(copy, createElement('span', 'class-hub-row-arrow', '>'));
    item.appendChild(button);
    return item;
  };

  const buildFollowUpRow = (reminder) => {
    const complete = isCompletedReminder(reminder);
    const item = createElement('li', `class-hub-follow-up-row${complete ? ' is-complete' : ''}`);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'class-hub-follow-up-check';
    checkbox.checked = complete;
    checkbox.dataset.classHubReminderToggle = reminder.id;
    checkbox.setAttribute('aria-label', `${complete ? 'Reopen' : 'Complete'} ${getReminderLabel(reminder)}`);
    const checkboxHost = createElement('label', 'class-hub-follow-up-check-wrap');
    checkboxHost.appendChild(checkbox);
    const copy = createElement('span', 'class-hub-follow-up-copy');
    copy.appendChild(createElement('span', 'class-hub-follow-up-text', getReminderLabel(reminder)));
    const dueLabel = formatDueLabel(reminder);
    if (dueLabel) copy.appendChild(createElement('span', 'class-hub-row-meta', `Due ${dueLabel}`));
    const edit = createElement('button', 'class-hub-follow-up-edit', 'Edit');
    edit.type = 'button';
    edit.dataset.classHubReminderOpen = reminder.id;
    edit.setAttribute('aria-label', `Edit ${getReminderLabel(reminder)}`);
    item.append(checkboxHost, copy, edit);
    return item;
  };

  const renderList = () => {
    const hubs = readHubs();
    const heading = createElement('div', 'class-hubs-heading');
    const headingCopy = createElement('div');
    headingCopy.append(
      createElement('h3', 'class-hubs-title', 'Class hubs'),
      createElement('p', 'class-hubs-copy', 'Keep notes and follow-ups for each class together.'),
    );
    const add = createElement('button', 'class-hub-action class-hub-action--primary', '+ Class');
    add.type = 'button';
    add.dataset.classHubCreate = 'true';
    heading.append(headingCopy, add);
    rootElement.append(heading, buildStatus());
    if (!hubs.length) {
      rootElement.appendChild(createElement('p', 'class-hubs-empty', 'Create your first class hub to start a class list.'));
      return;
    }
    const list = createElement('ul', 'class-hubs-list');
    hubs.forEach((hub) => list.appendChild(buildHubRow(hub)));
    rootElement.appendChild(list);
    if (focusHubIdAfterBack) {
      const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(focusHubIdAfterBack)
        : focusHubIdAfterBack.replace(/["\\]/g, '\\$&');
      focusSoon(`[data-class-hub-open="${escapedId}"]`);
      focusHubIdAfterBack = null;
    }
  };

  const renderHub = (hub) => {
    const notes = getHubNotes(hub.id);
    const reminders = getHubReminders(hub.id);
    const active = reminders.filter((item) => !isCompletedReminder(item));
    const completed = reminders.filter(isCompletedReminder);

    const header = createElement('div', 'class-hub-detail-heading');
    const back = createElement('button', 'class-hub-back', 'Class hubs');
    back.type = 'button';
    back.dataset.classHubBack = 'true';
    back.setAttribute('aria-label', 'Back to Class hubs');
    const titleCopy = createElement('div');
    const title = createElement('h3', 'class-hub-detail-title', hub.name);
    title.dataset.classHubHeading = 'true';
    title.tabIndex = -1;
    titleCopy.append(title, createElement('p', 'class-hub-detail-summary', `${active.length} open follow-up${active.length === 1 ? '' : 's'} - ${notes.length} note${notes.length === 1 ? '' : 's'}`));
    header.append(back, titleCopy);
    rootElement.append(header, buildStatus());

    const aiSection = createElement('section', 'class-hub-ai-organize');
    const aiCopy = createElement('div', 'class-hub-ai-organize-copy');
    aiCopy.append(
      createElement('h4', 'class-hub-ai-organize-title', 'Organise a class thought'),
      createElement(
        'p',
        'class-hub-ai-organize-privacy',
        'Your thought is sent to AI to suggest a note and follow-ups. Avoid student names or sensitive details. You review everything before it is added.',
      ),
    );
    const organizeThought = createElement(
      'button',
      'class-hub-action class-hub-action--primary class-hub-ai-organize-button',
      'Organise a thought',
    );
    organizeThought.type = 'button';
    organizeThought.dataset.classHubAiOrganize = 'true';
    organizeThought.setAttribute('aria-label', `Organise a thought for ${hub.name}`);
    aiSection.append(aiCopy, organizeThought);
    rootElement.appendChild(aiSection);

    const followSection = createElement('section', 'class-hub-section');
    const followHeading = createElement('div', 'class-hub-section-heading');
    followHeading.appendChild(createElement('h4', 'class-hub-section-title', 'Follow-ups'));
    const addFollow = createElement('button', 'class-hub-action', '+ Add');
    addFollow.type = 'button';
    addFollow.dataset.classHubAddFollowUp = 'true';
    followHeading.appendChild(addFollow);
    followSection.appendChild(followHeading);
    const cueAction = createElement('button', 'class-hub-action', 'Remind me to check this list');
    cueAction.type = 'button';
    cueAction.dataset.classHubAddCue = 'true';
    followSection.appendChild(cueAction);
    if (!active.length) {
      followSection.appendChild(createElement('p', 'class-hub-section-copy', 'No open follow-ups.'));
    } else {
      const list = createElement('ul', 'class-hub-follow-up-list');
      active.forEach((reminder) => list.appendChild(buildFollowUpRow(reminder)));
      followSection.appendChild(list);
    }
    if (completed.length) {
      const details = createElement('details', 'class-hub-completed');
      const summary = createElement('summary', '', `Completed (${completed.length})`);
      const list = createElement('ul', 'class-hub-follow-up-list');
      completed.forEach((reminder) => list.appendChild(buildFollowUpRow(reminder)));
      details.append(summary, list);
      followSection.appendChild(details);
    }
    rootElement.appendChild(followSection);

    const notesSection = createElement('section', 'class-hub-section');
    const notesHeading = createElement('div', 'class-hub-section-heading');
    notesHeading.appendChild(createElement('h4', 'class-hub-section-title', 'Notes'));
    const addNote = createElement('button', 'class-hub-action', '+ Add note');
    addNote.type = 'button';
    addNote.dataset.classHubFullNote = 'true';
    notesHeading.appendChild(addNote);
    notesSection.append(
      notesHeading,
      createElement('p', 'class-hub-section-copy', 'New notes open in the regular Notes editor and are filed in this class.'),
    );
    if (!notes.length) {
      notesSection.appendChild(createElement('p', 'class-hub-section-copy', 'No class notes yet.'));
    } else {
      const list = createElement('ul', 'class-hub-notes-list');
      notes.slice(0, 8).forEach((note) => {
        const item = createElement('li', 'class-hub-note-row');
        const button = createElement('button', 'class-hub-note-button');
        button.type = 'button';
        button.dataset.classHubNoteOpen = note.id;
        button.append(
          createElement('span', 'class-hub-note-title', normalizeText(note?.title) || 'Untitled note'),
          createElement('span', 'class-hub-row-arrow', '>'),
        );
        item.appendChild(button);
        list.appendChild(item);
      });
      notesSection.appendChild(list);
    }
    rootElement.appendChild(notesSection);
  };

  function render() {
    rootElement.innerHTML = '';
    const activeHub = getActiveHub();
    if (activeHubId && !activeHub) {
      activeHubId = null;
      statusMessage = 'That class hub is no longer available.';
    }
    rootElement.closest('#notesOverviewPanel')?.classList.toggle('class-hub-is-open', Boolean(activeHub));
    if (activeHub) renderHub(activeHub);
    else renderList();
  }

  const handleRootClick = (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest('button') : null;
    if (!(button instanceof HTMLButtonElement) || !rootElement.contains(button)) return;
    if (button.dataset.classHubCreate) {
      openCreateDialog();
      return;
    }
    if (button.dataset.classHubOpen) {
      activeHubId = button.dataset.classHubOpen;
      statusMessage = '';
      render();
      focusSoon('[data-class-hub-heading]');
      return;
    }
    if (button.dataset.classHubBack) {
      focusHubIdAfterBack = activeHubId;
      activeHubId = null;
      statusMessage = '';
      render();
      return;
    }
    if (button.dataset.classHubAddFollowUp) {
      openFollowUpDialog('follow-up');
      return;
    }
    if (button.dataset.classHubAddCue) {
      openFollowUpDialog('cue');
      return;
    }
    if (button.dataset.classHubAiOrganize) {
      const hub = getActiveHub();
      if (!hub) return;
      try {
        const started = startAiOrganize({ ...hub });
        if (started === false) {
          updateStatus('Finish the current Capture first, then try again.');
        }
      } catch {
        updateStatus('Class thought could not start. Try again.');
      }
      return;
    }
    if (button.dataset.classHubReminderOpen) {
      openReminder(button.dataset.classHubReminderOpen);
      return;
    }
    if (button.dataset.classHubNoteOpen) {
      openNote(button.dataset.classHubNoteOpen);
      return;
    }
    if (button.dataset.classHubFullNote) {
      const hub = getActiveHub();
      if (hub) startFullNote(hub.id);
    }
  };

  const handleRootChange = async (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || !checkbox.matches('[data-class-hub-reminder-toggle]')) return;
    const id = checkbox.dataset.classHubReminderToggle;
    const completed = checkbox.checked;
    checkbox.disabled = true;
    let updated = null;
    try {
      updated = await Promise.resolve(setReminderCompleted(id, completed));
    } catch {
      updated = null;
    }
    if (!updated) {
      checkbox.checked = !completed;
      checkbox.disabled = false;
      updateStatus('The follow-up could not be updated. Try again.');
      return;
    }
    statusMessage = completed ? 'Follow-up completed.' : 'Follow-up reopened.';
    render();
    focusSoon('[data-class-hub-add-follow-up]');
  };

  const handleDataUpdate = () => render();
  const handleNotesModeChanged = (event) => {
    if (event?.detail?.mode === 'overview') {
      render();
    }
  };
  const handleClassHubOpen = (event) => {
    const hubId = normalizeText(event?.detail?.hubId);
    if (!hubId) return;
    activeHubId = hubId;
    statusMessage = normalizeText(event?.detail?.status);
    render();
    if (getActiveHub()) {
      focusSoon('[data-class-hub-heading]', { resetMainScroll: true });
    }
  };

  rootElement.addEventListener('click', handleRootClick);
  rootElement.addEventListener('change', handleRootChange);
  document.addEventListener('memoryCue:notesUpdated', handleDataUpdate);
  document.addEventListener('memoryCue:remindersUpdated', handleDataUpdate);
  document.addEventListener('memoryCue:remindersReady', handleDataUpdate);
  document.addEventListener('memoryCue:foldersUpdated', handleDataUpdate);
  document.addEventListener('memoryCue:notesModeChanged', handleNotesModeChanged);
  document.addEventListener('memoryCue:classHubOpen', handleClassHubOpen);

  render();

  return {
    render,
    openHub: (hubId) => {
      activeHubId = hubId;
      statusMessage = '';
      render();
    },
    closeHub: () => {
      activeHubId = null;
      statusMessage = '';
      render();
    },
    destroy: () => {
      rootElement.removeEventListener('click', handleRootClick);
      rootElement.removeEventListener('change', handleRootChange);
      document.removeEventListener('memoryCue:notesUpdated', handleDataUpdate);
      document.removeEventListener('memoryCue:remindersUpdated', handleDataUpdate);
      document.removeEventListener('memoryCue:remindersReady', handleDataUpdate);
      document.removeEventListener('memoryCue:foldersUpdated', handleDataUpdate);
      document.removeEventListener('memoryCue:notesModeChanged', handleNotesModeChanged);
      document.removeEventListener('memoryCue:classHubOpen', handleClassHubOpen);
      createDialog?.remove();
      followUpDialog?.remove();
      rootElement.closest('#notesOverviewPanel')?.classList.remove('class-hub-is-open');
    },
  };
}

export const CLASS_HUB_REMINDER_TYPES = Object.freeze({
  followUp: CLASS_FOLLOW_UP_TYPE,
  cue: CLASS_LIST_CUE_TYPE,
});
