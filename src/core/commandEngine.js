import { captureInput } from './capturePipeline.js';
import { loadAllNotes, saveAllNotes } from '../../js/modules/notes-storage.js';
import { searchMemoryIndex } from '../../js/modules/memory-index.js';
import { createReminder } from '../services/reminderService.js';
import { handleQuery } from '../brain/queryEngine.js';

const parseAssistantReply = (payload) => {
  if (typeof payload?.reply === 'string' && payload.reply.trim()) {
    return payload.reply;
  }
  if (typeof payload?.response === 'string' && payload.response.trim()) {
    return payload.response;
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return 'Assistant response unavailable.';
};

const logCommand = (command, status) => {
  console.debug('[CommandEngine]');
  console.debug(`command: ${command}`);
  console.debug(`timestamp: ${Date.now()}`);
  console.debug(`status: ${status}`);
};

const executeAssistantQuery = async (payload = {}) => {
  if (typeof payload?.handler === 'function') {
    const data = await payload.handler(payload);
    return {
      status: 'success',
      message: parseAssistantReply(data),
      data,
    };
  }

  const question = typeof payload?.question === 'string' ? payload.question : '';
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: question }),
  });

  if (!response.ok) {
    throw new Error(`Assistant request failed (${response.status})`);
  }

  const data = await response.json();

  return {
    status: 'success',
    message: parseAssistantReply(data),
    data,
  };
};

const executeUpdateNote = async (payload = {}) => {
  if (typeof payload?.handler === 'function') {
    const data = await payload.handler(payload);
    return {
      status: 'success',
      message: 'Note updated.',
      data,
    };
  }

  const noteId = typeof payload?.id === 'string' ? payload.id : '';
  const updates = payload && typeof payload.updates === 'object' && payload.updates ? payload.updates : {};

  if (!noteId) {
    return {
      status: 'error',
      message: 'Note id is required.',
      data: null,
    };
  }

  const notes = Array.isArray(loadAllNotes()) ? loadAllNotes() : [];
  const noteIndex = notes.findIndex((note) => String(note?.id || '') === noteId);

  if (noteIndex < 0) {
    return {
      status: 'error',
      message: 'Note not found.',
      data: null,
    };
  }

  const nextNote = {
    ...notes[noteIndex],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  const nextNotes = notes.slice();
  nextNotes[noteIndex] = nextNote;
  saveAllNotes(nextNotes);

  return {
    status: 'success',
    message: 'Note updated.',
    data: nextNote,
  };
};

export const executeCommand = async (type, payload = {}) => {
  try {
    let result;

    switch (type) {
      case 'capture': {
        const commandText = typeof payload?.text === 'string' ? payload.text : '';
        const routed = await captureInput({
          text: commandText,
          source: 'command_engine',
          metadata: {
            entryPoint: 'commandEngine.executeCommand',
            ...(payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
          },
        });
        result = {
          status: 'success',
          message: typeof routed?.message === 'string' && routed.message ? routed.message : 'Capture processed.',
          data: routed?.data ?? routed,
        };
        break;
      }
      case 'reminder': {
        const reminder = await createReminder(payload, { handler: payload?.handler });
        result = {
          status: 'success',
          message: 'Reminder created.',
          data: reminder,
        };
        break;
      }
      case 'assistantQuery': {
        result = await executeAssistantQuery(payload);
        break;
      }
      case 'processInbox': {
        if (typeof payload?.handler !== 'function') {
          throw new Error('Inbox processing logic is unavailable.');
        }
        const data = await payload.handler(payload);
        result = {
          status: 'success',
          message: 'Inbox processed.',
          data,
        };
        break;
      }
      case 'updateNote': {
        result = await executeUpdateNote(payload);
        break;
      }
      case 'search': {
        if (typeof payload?.handler === 'function') {
          const data = await payload.handler(payload);
          result = {
            status: 'success',
            message: 'Search complete.',
            data,
          };
          break;
        }
        const query = typeof payload?.query === 'string' ? payload.query : '';
        const data = query
          ? await handleQuery(query)
          : await searchMemoryIndex(query);
        result = {
          status: 'success',
          message: 'Search complete.',
          data,
        };
        break;
      }
      default:
        throw new Error(`Unsupported command: ${type}`);
    }

    logCommand(type, result.status);
    return result;
  } catch (error) {
    logCommand(type, 'error');
    throw error;
  }
};
