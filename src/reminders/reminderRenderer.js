export function renderReminderList(renderFn, ...args) {
  const result = typeof renderFn === 'function' ? renderFn(...args) : undefined;
  console.log('[reminder-render] rendered');
  return result;
}

export function renderReminderItem(renderFn, ...args) {
  return typeof renderFn === 'function' ? renderFn(...args) : undefined;
}

export function renderTodayReminders(renderFn, ...args) {
  return typeof renderFn === 'function' ? renderFn(...args) : undefined;
}
