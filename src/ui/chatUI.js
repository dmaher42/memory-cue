import { captureInput } from '../core/capturePipeline.js';

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
      if (typeof result?.message === 'string' && result.message.trim()) {
        const output = document.getElementById('assistantOutput');
        if (output instanceof HTMLElement) {
          output.textContent = result.message;
        }
      }
      assistantInputEl.value = '';
    } catch (error) {
      console.error('Chat submit failed', error);
    }
  });
}
