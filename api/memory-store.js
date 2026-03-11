const notes = [];
const reminders = [];
const tasks = [];

function addRecord(type, record) {
  if (type === 'reminder') {
    reminders.push(record);
    return;
  }

  if (type === 'task') {
    tasks.push(record);
    return;
  }

  notes.push(record);
}

function getAllNotes() {
  return [...notes, ...reminders, ...tasks];
}

module.exports = {
  addRecord,
  getAllNotes,
  notes,
  reminders,
  tasks
};
