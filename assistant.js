(function () {
  const STORAGE_KEY = 'memoryCueEntries';
  const MAX_CONTEXT_ENTRIES = 50;

  function loadStoredEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Unable to load Memory Cue entries.', error);
      return [];
    }
  }

  function buildSearchContext(entries) {
    return entries
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((entry) => {
        return `Entry:\nCategory: ${entry.category || 'notes'}\nContent: ${entry.content || ''}\nDate: ${entry.date || ''}`;
      })
      .join('\n\n');
  }

  async function askMemoryCue(question) {
    const entries = loadStoredEntries();
    if (entries.length === 0) {
      return 'You have no saved notes yet. Save a few entries, then ask again.';
    }

    const apiKey = window.MEMORY_CUE_OPENAI_API_KEY || localStorage.getItem('memoryCueOpenAIKey');
    if (!apiKey) {
      return 'Missing OpenAI API key. Set window.MEMORY_CUE_OPENAI_API_KEY or localStorage key memoryCueOpenAIKey.';
    }

    const context = buildSearchContext(entries);
    const prompt = `You are an assistant that helps a teacher and sports coach retrieve notes.\n\nHere are stored notes:\n\n${context}\n\nAnswer the user's question using only these notes.\n\nUser question:\n${question}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status}).`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || 'No answer returned.';
  }

  window.MemoryCueAssistant = {
    loadStoredEntries,
    buildSearchContext,
    askMemoryCue
  };
})();
