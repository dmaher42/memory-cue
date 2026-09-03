const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadReminderFormHandlers() {
  const filePath = path.resolve(__dirname, '../../src/reminders/reminderFormHandlers.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { createReminderFormHandlers };\n';

  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, console, Date, Object, Number });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return module.exports;
}

function createHarness({ items = [], parseQuickWhen } = {}) {
  const { createReminderFormHandlers } = loadReminderFormHandlers();
  const fields = {
    title: { value: '' },
    date: { value: '' },
    time: { value: '' },
    details: { value: '' },
    category: { value: 'General' },
  };
  let mode = null;
  let editingId = null;
  const createReminderFromPayload = jest.fn((payload) => ({ id: 'created', done: false, ...payload }));
  const saveToFirebase = jest.fn();
  const handlers = createReminderFormHandlers({
    title: fields.title,
    date: fields.date,
    time: fields.time,
    details: fields.details,
    categoryInput: fields.category,
    getItems: () => items,
    getCurrentReminderMode: () => mode,
    getEditingId: () => editingId,
    setReminderMode: (nextMode, id = null) => {
      mode = nextMode;
      editingId = id;
    },
    syncEditingIdFromMode: () => {},
    getPriorityInputValue: () => 'Medium',
    normalizeCategory: (value) => value || 'General',
    normalizeRecurrence: (value) => value || null,
    normalizeIsoString: (value) => value || null,
    parseManualDueInput: (dateValue, timeValue) => {
      if (!dateValue && !timeValue) return null;
      return `${dateValue || '2026-09-03'}T${timeValue || '00:00'}:00.000Z`;
    },
    parseQuickWhen: parseQuickWhen || (() => ({ date: '', time: '' })),
    createReminderFromPayload,
    saveToFirebase,
    isoToLocalDate: () => '2026-09-03',
    isoToLocalTime: () => '10:00',
  });

  return {
    handlers,
    fields,
    createReminderFromPayload,
    saveToFirebase,
  };
}

test('manual reminders with a time start as urgent appointments', () => {
  const harness = createHarness();
  harness.fields.title.value = 'Dentist appointment';
  harness.fields.date.value = '2026-09-03';
  harness.fields.time.value = '10:00';

  harness.handlers.handleSaveAction();

  expect(harness.createReminderFromPayload).toHaveBeenCalledWith(
    expect.objectContaining({
      urgentAlert: true,
      hasExplicitTime: true,
      urgentAcknowledgedAt: null,
      urgentStartedAt: null,
    }),
    { closeSheet: false },
  );
});

test('manual reminders with only a date do not start as urgent', () => {
  const harness = createHarness();
  harness.fields.title.value = 'Return permission form';
  harness.fields.date.value = '2026-09-03';
  harness.fields.time.value = '';

  harness.handlers.handleSaveAction();

  expect(harness.createReminderFromPayload).toHaveBeenCalledWith(
    expect.objectContaining({
      urgentAlert: false,
      hasExplicitTime: false,
    }),
    { closeSheet: false },
  );
});

test('a time written in the reminder title also enables urgent appointment alerts', () => {
  const harness = createHarness({
    parseQuickWhen: () => ({ date: '2026-09-04', time: '08:00' }),
  });
  harness.fields.title.value = 'Meet Sam tomorrow 8am';

  harness.handlers.handleSaveAction();

  expect(harness.createReminderFromPayload).toHaveBeenCalledWith(
    expect.objectContaining({
      dueAt: new Date('2026-09-04T08:00:00').toISOString(),
      urgentAlert: true,
      hasExplicitTime: true,
    }),
    { closeSheet: false },
  );
});

test('a parser default time does not make a date-only title urgent', () => {
  const harness = createHarness({
    parseQuickWhen: () => ({ date: '2026-09-05', time: '09:00' }),
  });
  harness.fields.title.value = 'Return permission form 5 September';

  harness.handlers.handleSaveAction();

  expect(harness.createReminderFromPayload).toHaveBeenCalledWith(
    expect.objectContaining({
      urgentAlert: false,
      hasExplicitTime: false,
    }),
    { closeSheet: false },
  );
});

test('editing a date-only reminder keeps the time field empty', () => {
  const item = {
    id: 'date-only',
    title: 'Return permission form',
    due: '2026-09-03T00:00:00.000Z',
    hasExplicitTime: false,
    urgentAlert: false,
  };
  const harness = createHarness({ items: [item] });

  harness.handlers.loadForEdit(item.id);

  expect(harness.fields.date.value).toBe('2026-09-03');
  expect(harness.fields.time.value).toBe('');
});

test('changing an appointment schedule clears acknowledgement and Start or Join state', () => {
  const item = {
    id: 'appointment',
    title: 'Dentist appointment',
    due: '2026-09-03T10:00:00.000Z',
    hasExplicitTime: true,
    urgentAlert: true,
    urgentAcknowledgedAt: 1000,
    urgentStartedAt: 2000,
  };
  const harness = createHarness({ items: [item] });
  harness.handlers.loadForEdit(item.id);
  harness.fields.date.value = '2026-09-03';
  harness.fields.time.value = '11:00';

  harness.handlers.handleSaveAction();

  expect(item.due).toBe('2026-09-03T11:00:00.000Z');
  expect(item.urgentAlert).toBe(true);
  expect(item.hasExplicitTime).toBe(true);
  expect(item.urgentAcknowledgedAt).toBeNull();
  expect(item.urgentStartedAt).toBeNull();
  expect(harness.saveToFirebase).toHaveBeenCalledWith(item);
});
