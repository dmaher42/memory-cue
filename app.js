import { initReminders } from './js/reminders.js';

const cueModal = document.getElementById('cue-modal');
const openCueButton = document.getElementById('openCueModal');
const closeCueButton = document.getElementById('closeCueModal');
const modalBackdropButton = cueModal?.querySelector('.modal-backdrop button');
const titleInput = document.getElementById('title');

const focusTitleInput = () => {
  if (!titleInput) return;
  window.setTimeout(() => {
    try {
      titleInput.focus({ preventScroll: true });
    } catch {
      titleInput.focus();
    }
  }, 50);
};

const showCueModal = () => {
  if (!cueModal || typeof cueModal.showModal !== 'function') return;
  if (!cueModal.open) {
    cueModal.showModal();
  }
  focusTitleInput();
};

const hideCueModal = () => {
  if (!cueModal) return;
  if (cueModal.open) {
    cueModal.close();
  }
};

openCueButton?.addEventListener('click', () => {
  document.dispatchEvent(new CustomEvent('cue:prepare', { detail: { mode: 'create' } }));
  showCueModal();
});

closeCueButton?.addEventListener('click', () => {
  const detail = { reason: 'user-dismissed' };
  document.dispatchEvent(new CustomEvent('cue:cancelled', { detail }));
  document.dispatchEvent(new CustomEvent('cue:close', { detail }));
});

modalBackdropButton?.addEventListener('click', () => {
  const detail = { reason: 'backdrop' };
  document.dispatchEvent(new CustomEvent('cue:cancelled', { detail }));
  document.dispatchEvent(new CustomEvent('cue:close', { detail }));
});

cueModal?.addEventListener('cancel', (event) => {
  event.preventDefault();
  const detail = { reason: 'keyboard' };
  document.dispatchEvent(new CustomEvent('cue:cancelled', { detail }));
  document.dispatchEvent(new CustomEvent('cue:close', { detail }));
});

document.addEventListener('cue:open', () => {
  showCueModal();
});

document.addEventListener('cue:close', () => {
  hideCueModal();
  openCueButton?.focus();
});

initReminders({
  titleSel: '#title',
  dateSel: '#date',
  timeSel: '#time',
  detailsSel: '#details',
  prioritySel: '#priority',
  categorySel: '#category',
  saveBtnSel: '#saveBtn',
  cancelEditBtnSel: '#cancelEditBtn',
  listSel: '#reminderList',
  statusSel: '#status',
  syncStatusSel: '#syncStatus',
  voiceBtnSel: '#voiceBtn',
  filterBtnsSel: '[data-filter]',
  sortSel: '#sort',
  categoryFilterSel: '#categoryFilter',
  categoryOptionsSel: '#categorySuggestions',
  countTodaySel: '#inlineTodayCount',
  countOverdueSel: '#inlineOverdueCount',
  countTotalSel: '#inlineTotalCount',
  countCompletedSel: '#inlineCompletedCount',
  emptyStateSel: '#emptyState',
  listWrapperSel: '#remindersWrapper',
  dateFeedbackSel: '#dateFeedback',
  variant: 'desktop'
});
