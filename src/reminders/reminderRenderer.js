let renderHandlers = {
  renderReminderList: null,
  renderReminderItem: null,
  renderTodayReminders: null,
};

export function setupReminderRenderer(handlers = {}) {
  renderHandlers = { ...renderHandlers, ...handlers };
}

export function renderReminderList(renderFn, ...args) {
  const handler = typeof renderFn === 'function' ? renderFn : renderHandlers.renderReminderList;
  return typeof handler === 'function' ? handler(...args) : undefined;
}

export function renderReminderItem(renderFn, ...args) {
  const handler = typeof renderFn === 'function' ? renderFn : renderHandlers.renderReminderItem;
  return typeof handler === 'function' ? handler(...args) : undefined;
}

export function renderTodayReminders(renderFn, ...args) {
  const handler = typeof renderFn === 'function' ? renderFn : renderHandlers.renderTodayReminders;
  return typeof handler === 'function' ? handler(...args) : undefined;
}
