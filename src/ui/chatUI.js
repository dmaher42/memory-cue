import { captureInput } from '../core/capturePipeline.js';

export function initChatUI() {
  const assistantFormEl = document.getElementById('assistantForm');
  const assistantInputEl = document.getElementById('assistantInput');
  const mobileThinkingBarForm = document.getElementById('thinkingBarForm');
  const isAssistantInput = assistantInputEl instanceof HTMLInputElement || assistantInputEl instanceof HTMLTextAreaElement;
  if (!(assistantFormEl instanceof HTMLFormElement) || !isAssistantInput) return;

  // The mobile shell owns the thinking-bar assistant flow in mobile.js.
  // This module should only bind a dedicated assistant form.
  if (
    mobileThinkingBarForm instanceof HTMLFormElement
    && assistantFormEl === mobileThinkingBarForm
  ) {
    return;
  }

  if (assistantFormEl.dataset.chatUiBound === 'true') {
    return;
  }
  assistantFormEl.dataset.chatUiBound = 'true';

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
