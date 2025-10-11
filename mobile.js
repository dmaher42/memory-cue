import { initReminders } from './js/reminders.js';

const selectors = {
  titleSel: '#reminderText',
  detailsSel: '#reminderDetails',
  dateSel: '#reminderDate',
  timeSel: '#reminderTime',
  prioritySel: '#priority',
  categorySel: '#category',
  saveBtnSel: '#saveReminder',
  cancelEditBtnSel: '#cancelEditBtn',
  listSel: '#reminderList',
  listWrapperSel: '#remindersWrapper',
  emptyStateSel: '#emptyState',
  statusSel: '#statusMessage',
  syncStatusSel: '#syncStatus',
  voiceBtnSel: '#voiceBtn',
  notifBtnSel: '#notifBtn',
  addQuickBtnSel: '#quickAdd',
  qSel: '#searchReminders',
  filterBtnsSel: '[data-filter]',
  categoryFilterSel: '#categoryFilter',
  categoryOptionsSel: '#categorySuggestions',
  countTodaySel: '#todayCount',
  countOverdueSel: '#overdueCount',
  countTotalSel: '#totalCount',
  countCompletedSel: '#completedCount',
  googleSignInBtnSel: '#googleSignInBtn',
  googleSignOutBtnSel: '#googleSignOutBtn',
  googleAvatarSel: '#googleAvatar',
  googleUserNameSel: '#googleUserName',
  syncAllBtnSel: '#syncAll',
  syncUrlInputSel: '#syncUrl',
  saveSettingsSel: '#saveSyncSettings',
  testSyncSel: '#testSync',
  openSettingsSel: '#openSettings',
  settingsSectionSel: '#settingsSection',
  notesSel: '#notes',
  saveNotesBtnSel: '#saveNotes',
  loadNotesBtnSel: '#loadNotes',
  dateFeedbackSel: '#dateFeedback',
  variant: 'mobile',
};

const totalBadge = document.getElementById('totalCountBadge');
document.addEventListener('memoryCue:remindersUpdated', (event) => {
  if (!totalBadge) return;
  const items = Array.isArray(event?.detail?.items) ? event.detail.items : [];
  totalBadge.textContent = String(items.length);
});

initReminders(selectors).then(() => {
  if (totalBadge) {
    const totalCount = document.getElementById('totalCount');
    totalBadge.textContent = totalCount?.textContent?.trim() || '0';
  }
}).catch((error) => {
  console.error('Failed to initialise mobile reminders', error);
});
