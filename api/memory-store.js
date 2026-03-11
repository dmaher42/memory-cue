const memoryCueData = {
  tasks: [],
  lessonIdeas: [],
  coachingIdeas: [],
  notes: [],
  questions: [],
  resources: [],
};

const legacyReminders = [];

function toCollectionKey(type) {
  if (type === 'task') return 'tasks';
  if (type === 'lesson idea') return 'lessonIdeas';
  if (type === 'coaching idea') return 'coachingIdeas';
  if (type === 'question') return 'questions';
  if (type === 'resource') return 'resources';
  return 'notes';
}

function addRecord(type, record) {
  if (type === 'reminder') {
    legacyReminders.push(record);
    return;
  }

  memoryCueData[toCollectionKey(type)].unshift(record);
}

function getAllNotes() {
  return [
    ...memoryCueData.tasks,
    ...memoryCueData.lessonIdeas,
    ...memoryCueData.coachingIdeas,
    ...memoryCueData.notes,
    ...memoryCueData.questions,
    ...memoryCueData.resources,
    ...legacyReminders,
  ];
}

function getCategory(type) {
  return [...memoryCueData[toCollectionKey(type)]];
}

function getStoreSnapshot() {
  return {
    tasks: [...memoryCueData.tasks],
    lessonIdeas: [...memoryCueData.lessonIdeas],
    coachingIdeas: [...memoryCueData.coachingIdeas],
    notes: [...memoryCueData.notes],
    questions: [...memoryCueData.questions],
    resources: [...memoryCueData.resources],
  };
}

module.exports = {
  addRecord,
  getCategory,
  getAllNotes,
  getStoreSnapshot,
  memoryCueData,
};
