/**
 * @jest-environment jsdom
 */

const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadIntentParser() {
  const filePath = path.resolve(__dirname, 'src/chat/intentParser.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/export const parseIntent\s*=\s*/g, 'const parseIntent = ');
  source += '\nmodule.exports = { parseIntent };\n';

  const context = vm.createContext({ module: { exports: {} }, exports: {}, console });
  new vm.Script(source, { filename: filePath }).runInContext(context);
  return context.module.exports;
}

function loadActionRouter({ captureInput, fetch }) {
  const filePath = path.resolve(__dirname, 'src/chat/actionRouter.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import[\s\S]*?;\s*$/mg, '');
  source = source.replace(/export const routeAction\s*=\s*/g, 'const routeAction = ');
  source += '\nmodule.exports = { routeAction };\n';

  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    console,
    processInbox: jest.fn(async () => ({ summary: 'Processed 0 notes.' })),
    executeCommand: async (command, payload = {}) => {
      if (command === 'capture') {
        return { message: 'Saved to Inbox.', data: captureInput(payload.text, payload.source) };
      }
      if (command === 'reminder') {
        const created = await payload.handler?.({ title: payload.text });
        return { message: 'Reminder created.', data: created };
      }
      if (command === 'assistantQuery') {
        const response = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: payload.question }),
        });
        const data = await response.json();
        return { message: data.reply, data };
      }
      if (command === 'search') {
        return { message: 'No matching memories found.', data: [] };
      }
      return { message: '', data: null };
    },
    getInboxEntries: () => [],
    removeInboxEntry: jest.fn(),
    searchNotesMemory: jest.fn(async () => []),
    formatMemorySearchResponse: jest.fn(() => 'No matching memories found.'),
    fetch,
    window: {},
  });

  new vm.Script(source, { filename: filePath }).runInContext(context);
  return context.module.exports;
}

describe('Prompt 12 chat system behavior', () => {
  const captureInput = jest.fn();
  const fetchMock = jest.fn();
  let parseIntent;
  let routeAction;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ parseIntent } = loadIntentParser());
    ({ routeAction } = loadActionRouter({ captureInput, fetch: fetchMock }));
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('Capture: "idea for lesson" -> "Saved to Inbox" and inbox navigation', async () => {
    const input = 'idea for lesson';
    const intent = parseIntent(input);

    const result = await routeAction(intent, input);

    expect(intent).toBe('capture');
    expect(captureInput).toHaveBeenCalledWith(input, 'capture');
    expect(result).toEqual({
      message: 'Saved to Inbox.',
      quickActions: [{ label: 'View Capture', targetView: 'capture' }],
      status: { message: 'Saved to Inbox.', data: undefined },
    });
  });

  test('Reminder: "remind me to call parents tomorrow" -> "Reminder created" and reminders navigation', async () => {
    const input = 'remind me to call parents tomorrow';
    const intent = parseIntent(input);
    const createReminder = jest.fn().mockResolvedValue({ id: 'r-1' });

    const result = await routeAction(intent, input, { createReminder });

    expect(intent).toBe('reminder');
    expect(createReminder).toHaveBeenCalledWith({ title: input });
    expect(result).toEqual({
      message: 'Reminder created.',
      quickActions: [{ label: 'Edit Reminder', targetView: 'reminders' }],
      status: { message: 'Reminder created.', data: { id: 'r-1' } },
    });
  });

  test('Assistant: "what reminders do I have?" -> assistant response and notes navigation', async () => {
    const input = 'what reminders do I have?';
    const intent = 'assistant';

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'assistant response.' }),
    });

    const result = await routeAction(intent, input);

    expect(intent).toBe('assistant');
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    });
    expect(result).toEqual({
      message: 'assistant response.',
      quickActions: [{ label: 'View Notes', targetView: 'notebooks' }],
      status: {
        message: 'assistant response.',
        data: { reply: 'assistant response.' },
      },
    });
  });
});
