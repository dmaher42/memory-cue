import { captureInput } from '../core/capturePipeline.js';


const formatQueryResult = (data) => {
  if (!data || typeof data !== 'object') {
    return '';
  }

  if (data.type === 'memory_results') {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      return 'No matching memories found.';
    }
    return `Memories:
${items.slice(0, 8).map((item) => `• ${item?.text || 'Untitled memory'}`).join('\n')}`;
  }

  if (data.type === 'reminder_results') {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      return 'No matching reminders found.';
    }
    return `Reminders:
${items.slice(0, 8).map((item) => `• ${item?.title || item?.text || 'Untitled reminder'}`).join('\n')}`;
  }

  if (data.type === 'mixed_results') {
    const memories = Array.isArray(data.memories) ? data.memories : [];
    const reminders = Array.isArray(data.reminders) ? data.reminders : [];
    const memoryLines = memories.slice(0, 5).map((item) => `• ${item?.text || 'Untitled memory'}`);
    const reminderLines = reminders.slice(0, 5).map((item) => `• ${item?.title || item?.text || 'Untitled reminder'}`);

    if (!memoryLines.length && !reminderLines.length) {
      return 'No matching results found.';
    }

    return [
      'Memories:',
      memoryLines.length ? memoryLines.join('\n') : '• None',
      '',
      'Reminders:',
      reminderLines.length ? reminderLines.join('\n') : '• None',
    ].join('\n');
  }

  return '';
};

export function initChatUI() {
  const assistantFormEl = document.getElementById('assistantForm');
  const assistantInputEl = document.getElementById('assistantInput');
  const isAssistantInput = assistantInputEl instanceof HTMLInputElement || assistantInputEl instanceof HTMLTextAreaElement;
  if (!(assistantFormEl instanceof HTMLFormElement) || !isAssistantInput) return;

  assistantFormEl.addEventListener('submit', async (event) => {
    const text = (assistantInputEl.value || '').trim();
    if (!text) return;

    console.log('[ui]', 'chat message submitted');
    event.preventDefault();

    try {
      const result = await captureInput({ text, source: 'chat' });
      const output = document.getElementById('assistantOutput');
      if (output instanceof HTMLElement) {
        const displayText = (typeof result?.message === 'string' && result.message.trim())
          ? result.message
          : formatQueryResult(result?.data);
        if (displayText) {
          output.textContent = displayText;
        }
      }
      assistantInputEl.value = '';
    } catch (error) {
      console.error('Chat submit failed', error);
    }
  });
}
