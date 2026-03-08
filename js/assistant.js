(function () {
  const assistantForm = document.getElementById('assistantForm');
  const assistantInput = document.getElementById('assistantInput');
  const assistantThread = document.getElementById('assistantThread');
  const assistantLoading = document.getElementById('assistantLoading');

  if (!assistantForm || !assistantInput || !assistantThread) {
    return;
  }

  assistantForm.classList.remove('hidden');

  function appendMessage(text) {
    const messageEl = document.createElement('div');
    messageEl.className = 'assistant-message';
    messageEl.textContent = text;
    assistantThread.appendChild(messageEl);
    assistantThread.scrollTop = assistantThread.scrollHeight;
    return messageEl;
  }

  async function sendAssistantMessage(message) {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      throw new Error('Assistant request failed');
    }

    const data = await response.json();
    if (!data || typeof data.reply !== 'string') {
      throw new Error('Assistant response invalid');
    }

    return data.reply;
  }

  assistantForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const message = assistantInput.value.trim();
    if (!message) {
      return;
    }

    appendMessage(message);
    assistantInput.value = '';

    const thinkingMessage = appendMessage('Thinking…');
    if (assistantLoading) {
      assistantLoading.classList.remove('hidden');
    }

    try {
      const reply = await sendAssistantMessage(message);
      thinkingMessage.textContent = reply;
    } catch (error) {
      console.error('Assistant unavailable', error);
      thinkingMessage.textContent = 'Assistant is unavailable.';
    } finally {
      if (assistantLoading) {
        assistantLoading.classList.add('hidden');
      }
    }
  });
})();
