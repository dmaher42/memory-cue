self.addEventListener('message', (event) => {
  if (!event?.data || event.data.type !== 'scheduleReminder') {
    return;
  }

  const { title, body, time } = event.data;
  const delay = time - Date.now();

  if (delay <= 0) {
    return;
  }

  setTimeout(() => {
    self.registration.showNotification(title, { body });
  }, delay);
});
