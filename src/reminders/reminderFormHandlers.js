export const createReminderFormHandlers = (options = {}) => {
  const {
    title = null,
    date = null,
    time = null,
    details = null,
    categoryInput = null,
    plannerLessonInput = null,
    saveBtn = null,
    cancelEditBtn = null,
    DEFAULT_CATEGORY = 'General',
    getItems = () => [],
    getCurrentReminderMode = () => null,
    getEditingId = () => null,
    setReminderMode = () => {},
    syncEditingIdFromMode = () => {},
    setPriorityInputValue = () => {},
    getPriorityInputValue = () => 'Medium',
    normalizeCategory = (value) => value,
    normalizeRecurrence = (value) => value,
    normalizeIsoString = (value) => value,
    applyStoredDefaultsToInputs = () => {},
    clearPlannerReminderContext = () => {},
    clearDetailSelection = () => {},
    applyDetailSelection = () => {},
    focusTitleField = () => {},
    dispatchCueEvent = () => {},
    closeCreateSheetIfOpen = () => {},
    emitActivity = () => {},
    toast = () => {},
    parseManualDueInput = () => null,
    parseQuickWhen = () => ({ date: '', time: '' }),
    createReminderFromPayload = () => null,
    saveToFirebase = async () => false,
    tryCalendarSync = () => {},
    render = () => {},
    scheduleReminder = () => {},
    persistItems = () => {},
    emitReminderUpdates = () => {},
    setSuppressRenderMemoryEvent = () => {},
    isoToLocalDate = () => '',
    isoToLocalTime = () => '',
    scrollToTop = () => {},
  } = options;

  const resetForm = ({ preserveDetail = false, resetMode = true } = {}) => {
    if (title) title.value = '';
    if (date) date.value = '';
    if (time) time.value = '';
    if (details) details.value = '';
    setPriorityInputValue('Medium');
    if (categoryInput) categoryInput.value = DEFAULT_CATEGORY;
    applyStoredDefaultsToInputs();
    if (resetMode) {
      setReminderMode(null);
    } else {
      syncEditingIdFromMode();
    }
    if (saveBtn) saveBtn.textContent = 'Add reminder';
    if (cancelEditBtn) cancelEditBtn.textContent = 'Cancel';
    cancelEditBtn?.classList.add('hidden');
    clearPlannerReminderContext();
    if (!preserveDetail) {
      clearDetailSelection();
    }
  };

  const loadForEdit = (id) => {
    const item = getItems().find((entry) => entry?.id === id);
    if (!item) {
      return;
    }
    setReminderMode('edit', id);
    if (title) title.value = item.title || '';
    if (date && time) {
      if (item.due) {
        date.value = isoToLocalDate(item.due);
        time.value = isoToLocalTime(item.due);
      } else {
        date.value = '';
        time.value = '';
      }
    }
    setPriorityInputValue(item?.priority || 'Medium');
    if (categoryInput) categoryInput.value = normalizeCategory(item.category);
    if (details) details.value = typeof item.notes === 'string' ? item.notes : '';
    if (plannerLessonInput) plannerLessonInput.value = typeof item.plannerLessonId === 'string' ? item.plannerLessonId : '';
    clearPlannerReminderContext();
    applyDetailSelection(item);
    if (saveBtn) saveBtn.textContent = 'Save changes';
    if (cancelEditBtn) cancelEditBtn.textContent = 'Discard changes';
    cancelEditBtn?.classList.remove('hidden');
    scrollToTop();
    focusTitleField();
    dispatchCueEvent('cue:open', { mode: 'edit' });
  };

  const openEditReminderSheet = (reminder) => {
    const reminderId = reminder?.id || reminder;
    if (!reminderId) {
      return;
    }
    setReminderMode('edit', reminderId);
    loadForEdit(reminderId);
  };

  const openNewReminderSheet = (trigger = null) => {
    resetForm({ resetMode: false });
    setReminderMode('new');
    const detail = { mode: 'create', trigger };
    dispatchCueEvent('cue:prepare', detail);
    dispatchCueEvent('cue:open', detail);
    focusTitleField();
  };

  const handleSaveAction = () => {
    const rawTitle = typeof title?.value === 'string' ? title.value : '';
    const trimmedTitle = rawTitle.trim();
    const dateValue = typeof date?.value === 'string' ? date.value : '';
    const timeValue = typeof time?.value === 'string' ? time.value : '';
    const plannerLinkId = typeof plannerLessonInput?.value === 'string' ? plannerLessonInput.value.trim() : '';

    if (getCurrentReminderMode() === 'edit' && getEditingId()) {
      const item = getItems().find((entry) => entry?.id === getEditingId());
      if (!item) {
        resetForm();
        return;
      }
      if (!trimmedTitle) {
        toast('Add a reminder title');
        return;
      }
      let due = parseManualDueInput(dateValue, timeValue);
      if (!due) {
        const parsed = parseQuickWhen(trimmedTitle);
        if (parsed.time) {
          due = new Date(`${parsed.date}T${parsed.time}:00`).toISOString();
        }
      }
      item.title = trimmedTitle;
      const nextPriority = getPriorityInputValue();
      item.priority = nextPriority;
      setPriorityInputValue(nextPriority);
      if (categoryInput) {
        item.category = normalizeCategory(categoryInput.value);
      }
      item.due = due;
      item.recurrence = normalizeRecurrence(item.recurrence);
      item.snoozedUntil = normalizeIsoString(item.snoozedUntil);
      item.notifyMinutesBefore = Number.isFinite(Number(item.notifyMinutesBefore))
        ? Number(item.notifyMinutesBefore)
        : 0;
      if (details) {
        item.notes = details.value.trim();
      }
      item.plannerLessonId = plannerLinkId || null;
      item.updatedAt = Date.now();
      saveToFirebase(item);
      tryCalendarSync(item);
      setSuppressRenderMemoryEvent(true);
      render();
      scheduleReminder(item);
      persistItems();
      emitReminderUpdates();
      dispatchCueEvent('memoryCue:remindersUpdated', { items: getItems() });
      closeCreateSheetIfOpen();
      emitActivity({ action: 'updated', label: `Reminder updated · ${item.title}` });
      resetForm();
      toast('Reminder updated');
      dispatchCueEvent('cue:close', { reason: 'updated' });
      return;
    }

    if (!trimmedTitle) {
      toast('Add a reminder title');
      return;
    }
    const noteText = details ? details.value.trim() : '';
    const priorityValue = getPriorityInputValue();
    const normalizedCategory = categoryInput ? normalizeCategory(categoryInput.value) : DEFAULT_CATEGORY;
    let due = parseManualDueInput(dateValue, timeValue);
    if (!due) {
      const parsed = parseQuickWhen(trimmedTitle);
      if (parsed.time) {
        due = new Date(`${parsed.date}T${parsed.time}:00`).toISOString();
      }
    }
    const plannerLessonDetail = plannerLinkId
      ? {
          lessonId: plannerLinkId,
          dayLabel: plannerLessonInput?.dataset?.lessonDayLabel || '',
          lessonTitle: plannerLessonInput?.dataset?.lessonTitle || '',
          summary: plannerLessonInput?.dataset?.lessonSummary || '',
        }
      : null;
    const createdItem = createReminderFromPayload({
      title: trimmedTitle,
      priority: priorityValue,
      category: normalizedCategory,
      dueAt: due,
      notes: noteText,
      plannerLessonId: plannerLinkId || null,
    }, {
      closeSheet: false,
    });

    const createdItemResolved = createdItem && typeof createdItem.then === 'function'
      ? null
      : createdItem;
    const applyCreatedResult = (resolvedItem) => {
      if (!resolvedItem) {
        return;
      }
      const isReminderItem = Object.prototype.hasOwnProperty.call(resolvedItem, 'done');
      if (plannerLessonDetail && isReminderItem) {
        toast('Planner reminder created');
        dispatchCueEvent('planner:reminderCreated', {
          lessonId: plannerLessonDetail.lessonId,
          dayLabel: plannerLessonDetail.dayLabel,
          lessonTitle: plannerLessonDetail.lessonTitle,
          summary: plannerLessonDetail.summary,
          reminderId: resolvedItem.id,
          reminderTitle: resolvedItem.title,
          reminderDue: resolvedItem.due || null,
        });
      } else if (isReminderItem) {
        toast('Reminder created');
      } else {
        toast('Saved');
      }
    };

    if (createdItem && typeof createdItem.then === 'function') {
      createdItem.then(applyCreatedResult).catch((error) => {
        console.warn('Failed to save reminder capture', error);
      });
    } else {
      applyCreatedResult(createdItemResolved);
    }
    if (title) title.value = '';
    if (time) time.value = '';
    if (details) details.value = '';
    clearPlannerReminderContext();
    dispatchCueEvent('cue:close', { reason: 'created' });
  };

  return {
    resetForm,
    loadForEdit,
    openEditReminderSheet,
    openNewReminderSheet,
    handleSaveAction,
  };
};
