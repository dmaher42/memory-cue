/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile capture result rendering', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <header id="reminders-slim-header">
        <button id="overflowMenuBtn" type="button">Menu</button>
        <h1 class="header-title">Capture</h1>
        <div class="capture-header-actions" role="group" aria-label="Capture tools">
          <button id="memoryCoachLauncher" type="button" aria-expanded="false">Memory coach</button>
          <button id="wordRescueLauncher" type="button" aria-expanded="false">Word help</button>
        </div>
      </header>
      <main id="main">
        <section id="view-capture">
          <section id="chatConversationContainer"></section>
        </section>
        <section id="view-notebook">
          <section id="classHubsPanel">
            <div class="class-thought-inline-review-host" data-class-thought-review-host="hub-hpe"></div>
          </section>
        </section>
      </main>
      <section id="thinkingBarContainer">
        <div id="wordRescueModeBar" class="hidden">
          <span>Word help: <strong id="wordRescueModeLabel">Find it now</strong></span>
          <button id="wordRescueExitButton" type="button">Back to Capture</button>
        </div>
        <div id="memoryCoachModeBar" class="hidden">
          <span>Memory coach: <strong id="memoryCoachModeLabel">Practice</strong></span>
          <button id="memoryCoachExitButton" type="button">Back to Capture</button>
        </div>
        <div id="classThoughtModeBar" class="hidden">
          <span>New note: <strong id="classThoughtModeLabel">Class</strong></span>
          <button id="classThoughtExitButton" type="button">Close</button>
        </div>
        <form id="thinkingBarForm">
          <label for="thinkingBarInput">Add a reminder, note, or ask anything</label>
          <textarea id="thinkingBarInput" placeholder="Add a reminder, note, or askâ€¦"></textarea>
          <button id="thinkingBarVoiceButton" type="button" aria-label="Add with voice" aria-pressed="false">Voice</button>
          <button id="thinkingBarSubmit" type="submit">Send</button>
        </form>
        <div id="thinkingBarStatus" class="hidden"></div>
      </section>
    `;
    document.body.dataset.activeView = 'capture';

    const messageTimestamp = Date.now();
    window.__mobileMocks = {
      getMessages: () => [{
        role: 'assistant',
        content: [
          'Reminder created for tomorrow at 8:30 am: Prepare the complete lesson sequence.',
          '',
          'Related from your memory:',
          '- Curriculum map',
          '- Prior lesson notes',
        ].join('\n'),
        timestamp: messageTimestamp,
      }],
      createChatComposer: () => ({ autoResize: jest.fn() }),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
    };
  });

  afterEach(() => {
    window.dispatchEvent(new window.Event('pagehide'));
    localStorage.clear();
    document.body.innerHTML = '';
    delete document.body.dataset.memoryCueAssistantInit;
    document.body.classList.remove('class-hub-open', 'class-thought-mode-active', 'class-thought-review-active');
    delete window.__mobileMocks;
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  test('captures speech into the universal input before using the canonical submit path', async () => {
    let recognition;
    class FakeSpeechRecognition {
      constructor() {
        recognition = this;
        this.start = jest.fn(() => this.onstart?.());
        this.stop = jest.fn(() => this.onend?.());
        this.abort = jest.fn(() => this.onend?.());
      }
    }

    const handleChatMessage = jest.fn(async () => ({
      message: 'Reminder created for tomorrow at 8:30 am: Print the lesson plan.',
    }));
    window.SpeechRecognition = FakeSpeechRecognition;
    window.__mobileMocks.handleChatMessage = handleChatMessage;
    window.__mobileMocks.getMessages = () => [];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const voiceButton = document.getElementById('thinkingBarVoiceButton');
    const input = document.getElementById('thinkingBarInput');
    voiceButton.click();

    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(recognition.lang).toBe('en-AU');
    expect(voiceButton.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('thinkingBarStatus')?.textContent).toContain('Listening');

    recognition.onresult({
      results: [[{ transcript: 'Remind me to print the lesson plan tomorrow at 8:30 am' }]],
    });

    expect(input.value).toBe('Remind me to print the lesson plan tomorrow at 8:30 am');
    expect(voiceButton.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('thinkingBarStatus')?.textContent)
      .toBe('Voice captured. Review it, then tap Send.');
    expect(handleChatMessage).not.toHaveBeenCalled();

    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleChatMessage).toHaveBeenCalledWith(
      'Remind me to print the lesson plan tomorrow at 8:30 am',
      {},
    );
    expect(input.value).toBe('');
  });

  test('keeps the microphone visible with a clear message when speech input is unavailable', () => {
    window.__mobileMocks.getMessages = () => [];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const voiceButton = document.getElementById('thinkingBarVoiceButton');
    voiceButton.click();

    expect(voiceButton.getAttribute('aria-disabled')).toBe('true');
    expect(voiceButton.getAttribute('title')).toBe('Voice input is not available in this browser.');
    expect(document.getElementById('thinkingBarStatus')?.textContent)
      .toBe('Voice input is not available in this browser.');
  });

  test('stops listening when Notes hides the universal capture bar', () => {
    let recognition;
    class FakeSpeechRecognition {
      constructor() {
        recognition = this;
        this.start = jest.fn(() => this.onstart?.());
        this.stop = jest.fn(() => this.onend?.());
        this.abort = jest.fn(() => this.onend?.());
      }
    }

    window.SpeechRecognition = FakeSpeechRecognition;
    window.__mobileMocks.getMessages = () => [];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const voiceButton = document.getElementById('thinkingBarVoiceButton');
    voiceButton.click();
    expect(voiceButton.getAttribute('aria-pressed')).toBe('true');

    document.body.dataset.activeView = 'notebooks';
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'notebooks' },
    }));

    recognition.onresult({
      results: [[{ transcript: 'late transcript after leaving' }]],
    });

    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(recognition.stop).not.toHaveBeenCalled();
    expect(voiceButton.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('thinkingBarInput')?.value).toBe('');
    expect(document.getElementById('thinkingBarStatus')?.textContent).toBe('');
    expect(document.getElementById('thinkingBarStatus')?.classList.contains('hidden')).toBe(true);
  });

  test('keeps a time colon out of the displayed reminder title', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.capture-result-status')?.textContent).toBe('Reminder set ✓');
    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Prepare the complete lesson sequence');
    expect(document.querySelector('.capture-result-detail')).toBeNull();
    expect(document.querySelector('.capture-result-meta')?.textContent).toBe('Due Tomorrow, 8:30 am');
    expect(document.querySelector('.capture-result-time')).toBeNull();
    expect(document.querySelectorAll('.capture-result-related-link')).toHaveLength(0);
  });

  test('keeps a user capture and its confirmation as separate conversation rows', () => {
    const messageTimestamp = Date.now();
    localStorage.setItem('memoryCue:offlineReminders', JSON.stringify([{
      id: 'paired-reminder',
      title: 'Buy milk',
      due: 'tomorrow at 6:15 am',
      category: 'General',
      source: 'capture',
      createdAt: messageTimestamp - 100,
    }]));
    window.__mobileMocks.getMessages = () => [
      {
        id: 'paired-user-message',
        role: 'user',
        content: 'remind me to buy milk tomorrow at 6:15 am',
        timestamp: messageTimestamp - 200,
      },
      {
        id: 'paired-assistant-message',
        role: 'assistant',
        content: 'Reminder created for tomorrow at 6:15 am: Buy milk.',
        timestamp: messageTimestamp,
      },
    ];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const rows = document.querySelectorAll('.chat-message');
    const confirmed = document.querySelector('.chat-message--capture-confirmed');
    expect(rows).toHaveLength(2);
    expect(document.querySelector('.chat-message--user .chat-message-text')?.textContent)
      .toBe('remind me to buy milk tomorrow at 6:15 am');
    expect(confirmed?.classList.contains('chat-message--assistant')).toBe(true);
    expect(confirmed?.classList.contains('chat-message--user')).toBe(false);
    expect(confirmed?.querySelector('.capture-result-status')?.textContent).toBe('Reminder set ✓');
    expect(confirmed?.querySelector('.capture-result-category')?.textContent).toBe('General');
    expect(confirmed?.querySelector('.capture-result-title')?.textContent).toBe('Buy milk');
    expect(confirmed?.querySelector('.capture-result-meta')?.textContent)
      .toBe('Due Tomorrow, 6:15 am');
    expect(confirmed?.querySelectorAll('time')).toHaveLength(0);
    expect(confirmed?.querySelector('.chat-message-text')).toBeNull();
    expect(confirmed?.textContent).not.toContain('Open reminder');
    expect(confirmed?.querySelector('[data-capture-action="open-reminder"]')?.tagName).toBe('BUTTON');
    expect(confirmed?.querySelector('[data-capture-action="open-reminder"]')?.getAttribute('aria-label'))
      .toBe('Open reminder: Buy milk');
  });

  test('renders a user capture as a timestamped chat message', () => {
    window.__mobileMocks.getMessages = () => [{
      role: 'user',
      content: 'Add a reminder to print the lesson scaffold',
      timestamp: Date.now(),
    }];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const message = document.querySelector('.chat-message--user');
    expect(message?.querySelector('.chat-message-text')?.textContent)
      .toBe('Add a reminder to print the lesson scaffold');
    expect(message?.querySelector('.chat-message-time')?.textContent).toBe('Just now');
  });

  test('keeps a missing-time question separate from the user capture', () => {
    const messageTimestamp = Date.now();
    window.__mobileMocks.getMessages = () => [
      {
        role: 'user',
        content: 'remind me to buy milk',
        timestamp: messageTimestamp - 100,
      },
      {
        role: 'assistant',
        content: 'When should I remind you?',
        timestamp: messageTimestamp,
      },
    ];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelectorAll('.chat-message')).toHaveLength(2);
    expect(document.querySelector('.chat-message--user .chat-message-text')?.textContent)
      .toBe('remind me to buy milk');
    expect(document.querySelector('.chat-message--capture-clarify .capture-result-title')?.textContent)
      .toBe('Needs a time');
    expect(document.querySelector('.chat-message--capture-confirmed')).toBeNull();
  });

  test('shows the newest messages in chronological order when cloud history arrives newest first', () => {
    const now = Date.now();
    window.__mobileMocks.getMessages = () => Array.from({ length: 14 }, (_, index) => ({
      role: 'user',
      content: `Message ${14 - index}`,
      timestamp: now - (index * 1000),
    }));

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const visibleMessages = Array.from(document.querySelectorAll('.chat-message-text'))
      .map((element) => element.textContent);
    expect(visibleMessages).toHaveLength(12);
    expect(visibleMessages[0]).toBe('Message 3');
    expect(visibleMessages.at(-1)).toBe('Message 14');
    expect(visibleMessages).not.toContain('Message 1');
    expect(visibleMessages).not.toContain('Message 2');
    expect(document.querySelector('.chat-history-trimmed')?.textContent)
      .toBe('Showing the latest captures. 2 older items are hidden here.');
  });

  test('shows confirmed reminder metadata and opens a linked related memory', () => {
    const messageTimestamp = Date.now() - 11000;
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(8, 30, 0, 0);
    localStorage.setItem('memoryCue:offlineReminders', JSON.stringify([{
      id: 'capture-reminder',
      title: 'Prepare the complete lesson sequence',
      due: due.toISOString(),
      category: 'School',
      source: 'capture',
      createdAt: messageTimestamp - 100,
    }]));
    window.__mobileMocks.getMessages = () => [{
      role: 'assistant',
      content: [
        'Reminder created.',
        '',
        'Related from your memory:',
        '- Curriculum map',
        '- Prior lesson notes',
      ].join('\n'),
      relatedMemories: [
        { noteId: 'curriculum-map', label: 'Curriculum map', score: 3 },
        { noteId: 'prior-lesson-notes', label: 'Prior lesson notes', score: 2 },
      ],
      timestamp: messageTimestamp,
    }];
    window.__mobileMocks.loadAllNotes = () => [
      { id: 'curriculum-map', title: 'Curriculum map' },
      { id: 'prior-lesson-notes', title: 'Prior lesson notes' },
    ];
    const openedNote = jest.fn();
    document.addEventListener('thinkingBar:openNote', openedNote, { once: true });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Prepare the complete lesson sequence');
    expect(document.querySelector('.capture-result-category')?.textContent).toBe('School');
    expect(Array.from(document.querySelectorAll('.capture-result-meta-item')).map((item) => item.textContent))
      .toEqual(['Due Tomorrow, 8:30 am']);
    expect(document.querySelector('.capture-result-meta')?.getAttribute('aria-label'))
      .toBe('Reminder details: Due Tomorrow, 8:30 am');
    const related = document.querySelector('.capture-result-related');
    expect(related?.open).toBe(false);
    expect(related?.querySelector('summary')?.textContent).toBe('');
    expect(related?.querySelector('summary')?.getAttribute('aria-label'))
      .toBe('2 high-confidence related memories');
    expect(Array.from(related?.querySelectorAll('li') || []).map((item) => item.textContent))
      .toEqual(['Curriculum map', 'Prior lesson notes']);
    const relatedLinks = Array.from(related?.querySelectorAll('.capture-result-related-link') || []);
    expect(relatedLinks.map((item) => item.textContent)).toEqual(['Curriculum map', 'Prior lesson notes']);
    expect(relatedLinks[0]?.getAttribute('aria-label')).toBe('Open related note: Curriculum map');
    relatedLinks[0]?.click();
    expect(openedNote).toHaveBeenCalledWith(expect.objectContaining({
      detail: { noteId: 'curriculum-map' },
    }));
    expect(document.querySelector('[data-capture-action="open-reminder"]')).not.toBeNull();
    expect(document.querySelector('[data-capture-action="undo-reminder"]')).toBeNull();
  });

  test('opens or undoes the newly captured reminder through the canonical controller', async () => {
    const messageTimestamp = Date.now();
    const openReminderById = jest.fn(() => true);
    const undoCapturedReminder = jest.fn().mockResolvedValue(true);
    const updateMessage = jest.fn(() => ({}));
    localStorage.setItem('memoryCue:offlineReminders', JSON.stringify([{
      id: 'capture-action-reminder',
      title: 'Send the excursion forms',
      category: 'School',
      source: 'capture',
      createdAt: messageTimestamp - 100,
    }]));
    window.__mobileMocks.getMessages = () => [{
      id: 'capture-action-message',
      role: 'assistant',
      content: 'Reminder created.',
      timestamp: messageTimestamp,
    }];
    window.__mobileMocks.initReminders = jest.fn().mockResolvedValue({
      openReminderById,
      undoCapturedReminder,
    });
    window.__mobileMocks.updateMessage = updateMessage;

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await Promise.resolve();
    await Promise.resolve();

    document.querySelector('[data-capture-action="open-reminder"]')?.click();
    expect(openReminderById).toHaveBeenCalledWith('capture-action-reminder');

    document.querySelector('[data-capture-action="undo-reminder"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(undoCapturedReminder).toHaveBeenCalledWith('capture-action-reminder');
    expect(updateMessage).toHaveBeenCalledWith('capture-action-message', {
      content: 'Reminder creation undone: Send the excursion forms.',
      quickActions: [],
    });
  });

  test('opens or undoes a newly captured note through the canonical notes flow', async () => {
    const messageTimestamp = Date.now();
    const capturedNote = {
      id: 'capture-action-note',
      title: 'Excursion permission form checklist',
      bodyText: 'Confirm forms, medical details, and emergency contacts.',
      folderId: 'school',
      metadata: { source: 'chat' },
      createdAt: new Date(messageTimestamp - 100).toISOString(),
      updatedAt: new Date(messageTimestamp - 100).toISOString(),
    };
    const saveAllNotes = jest.fn(() => true);
    const deleteNote = jest.fn().mockResolvedValue(true);
    const updateMessage = jest.fn(() => ({}));
    const openedNote = jest.fn();
    document.addEventListener('thinkingBar:openNote', openedNote, { once: true });
    window.__mobileMocks.loadAllNotes = () => [capturedNote];
    window.__mobileMocks.saveAllNotes = saveAllNotes;
    window.__mobileMocks.deleteNote = deleteNote;
    window.__mobileMocks.getFolderNameById = () => 'School';
    window.__mobileMocks.getMessages = () => [{
      id: 'capture-note-message',
      role: 'assistant',
      content: 'Saved note.',
      timestamp: messageTimestamp,
    }];
    window.__mobileMocks.updateMessage = updateMessage;

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.capture-result-status')?.textContent).toBe('Note captured ✎');
    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Excursion permission form checklist');
    expect(document.querySelector('.capture-result-detail')).toBeNull();
    expect(document.querySelector('.capture-result-category')?.textContent).toBe('School');
    expect(document.querySelector('.capture-result-meta')).toBeNull();

    document.querySelector('[data-capture-action="open-note"]')?.click();
    expect(openedNote).toHaveBeenCalledWith(expect.objectContaining({
      detail: { noteId: 'capture-action-note' },
    }));

    document.querySelector('[data-capture-action="undo-note"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveAllNotes).toHaveBeenCalledWith([]);
    expect(deleteNote).toHaveBeenCalledWith('capture-action-note');
    expect(updateMessage).toHaveBeenCalledWith('capture-note-message', {
      content: 'Note creation undone: Excursion permission form checklist.',
      quickActions: [],
    });
  });

  test('renders a durable removed state after a captured note is undone', () => {
    window.__mobileMocks.getMessages = () => [{
      id: 'removed-note-message',
      role: 'assistant',
      content: 'Note creation undone: Excursion permission form checklist.',
      timestamp: Date.now(),
    }];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.capture-result-eyebrow')?.textContent).toBe('Note removed');
    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Excursion permission form checklist');
    expect(document.querySelector('.capture-result-detail')?.textContent).toBe('removed');
    expect(document.querySelectorAll('.capture-result-action')).toHaveLength(0);
  });

  test('renders readable tappable note and reminder answers', () => {
    const openedNote = jest.fn();
    document.addEventListener('thinkingBar:openNote', openedNote, { once: true });
    window.__mobileMocks.loadAllNotes = () => [{ id: 'note-1', title: 'Excursion checklist' }];
    window.__mobileMocks.getMessages = () => [
      {
        role: 'user',
        content: 'What notes and reminders do I have about the excursion?',
        timestamp: Date.now() - 100,
      },
      {
        role: 'assistant',
        content: 'I found 1 note and 1 reminder.',
        timestamp: Date.now(),
        resultItems: [
          { id: 'note-1', type: 'note', title: 'Excursion checklist' },
          { id: 'reminder-1', type: 'reminder', title: 'Return excursion forms', due: '2026-08-04T09:00:00.000Z' },
        ],
      },
    ];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.chat-message--query-answer .chat-message-text')?.textContent)
      .toBe('I found 1 note and 1 reminder.');
    const results = Array.from(document.querySelectorAll('.capture-query-result'));
    expect(results).toHaveLength(2);
    expect(results.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Open note: Excursion checklist',
      'Open reminder: Return excursion forms',
    ]);

    results[0].click();
    expect(openedNote).toHaveBeenCalledWith(expect.objectContaining({ detail: { noteId: 'note-1' } }));
  });

  test('cleans markup-only and oversized labels from previously saved query results', () => {
    window.__mobileMocks.getMessages = () => [{
      role: 'assistant',
      content: 'I found matching notes.',
      timestamp: Date.now(),
      resultItems: [
        { id: 'blank-note', type: 'note', title: '<br>' },
        {
          id: 'long-note',
          type: 'note',
          title: 'This is a long pre-game note about supporting teammates, showing bravery, staying connected, and playing your role for the whole match.',
        },
      ],
    }];

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const results = Array.from(document.querySelectorAll('.capture-query-result'));
    expect(results).toHaveLength(1);
    expect(results[0].textContent).not.toContain('<br>');
    expect(results[0].querySelector('.capture-query-result-title')?.textContent.length).toBeLessThanOrEqual(80);
    expect(results[0].querySelector('.capture-query-result-title')?.textContent.endsWith('…')).toBe(true);
  });

  test('keeps the sole Capture heading in the fixed app header', () => {
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const captureLabels = Array.from(document.querySelectorAll('#reminders-slim-header h1, #view-capture h2, #view-capture p'))
      .filter((element) => element.textContent?.trim() === 'Capture');
    const home = document.querySelector('.capture-home-shell');

    expect(captureLabels).toHaveLength(1);
    expect(captureLabels[0].closest('#reminders-slim-header')).not.toBeNull();
    expect(document.querySelector('.capture-page-header')).toBeNull();
    expect(home).not.toBeNull();
    expect(home.className).toBe('capture-home-shell w-full');
  });

  test('places one Word help launcher in the fixed app header markup', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile.html'), 'utf8');
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const launchers = parsed.querySelectorAll('#wordRescueLauncher');

    expect(launchers).toHaveLength(1);
    expect(launchers[0].closest('#reminders-slim-header')).not.toBeNull();
    expect(launchers[0].closest('#view-capture')).toBeNull();
    expect(launchers[0].getAttribute('aria-controls')).toBe('chatConversationContainer');
  });

  test('opens Word help as an in-conversation choice while keeping one textbox', () => {
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    document.getElementById('wordRescueLauncher').click();

    expect(document.querySelectorAll('textarea')).toHaveLength(1);
    expect(document.querySelector('.word-rescue-choice-title')?.textContent)
      .toBe('How would you like help?');
    expect(Array.from(document.querySelectorAll('.word-rescue-choice-button')).map((button) => button.textContent))
      .toEqual(['Help me say it now', 'Help me work it out']);
    expect(document.getElementById('wordRescueLauncher')?.getAttribute('aria-expanded')).toBe('true');
  });

  test('runs Coach me through the existing capture path and reveals hints locally', async () => {
    const messages = [];
    const saveVocabulary = jest.fn(() => ({ status: 'created', note: { title: 'equivocate' } }));
    const handleChatMessage = jest.fn(async (text) => {
      messages.push(
        { role: 'user', content: text, timestamp: Date.now() - 1 },
        { role: 'assistant', content: 'Hint 1 of 3: It means avoiding a direct commitment.', timestamp: Date.now() },
      );
      return {
        message: 'Meaning first: You want to describe someone avoiding a clear commitment.',
        wordRescue: {
          mode: 'coach',
          interpretation: 'You want to describe someone avoiding a clear commitment.',
          prompts: [
            'What effect does the unclear answer have?',
            'Is the broader idea avoidance, uncertainty, or dishonesty?',
            'Complete this: The witness continued to _____ instead of saying yes or no.',
          ],
          answer: {
            expression: 'equivocate',
            explanation: 'To speak ambiguously so you do not commit clearly.',
            example: 'The spokesperson continued to equivocate.',
          },
          alternatives: ['prevaricate'],
        },
      };
    });
    window.__mobileMocks.getMessages = () => messages;
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.handleChatMessage = handleChatMessage;
    window.__mobileMocks.createMemoryCoachUi = () => ({
      activate() {},
      deactivate() {},
      render() {},
      isActive: () => false,
      saveVocabulary,
      hasSavedWord: () => false,
    });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    document.getElementById('wordRescueLauncher').click();
    document.querySelector('[data-word-rescue-action="coach"]').click();

    const input = document.getElementById('thinkingBarInput');
    input.value = 'someone who avoids giving a direct answer';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleChatMessage).toHaveBeenCalledWith(
      'someone who avoids giving a direct answer',
      { assistantTask: 'word_rescue', assistantMode: 'coach' },
    );
    expect(document.getElementById('wordRescueModeLabel')?.textContent).toBe('Help me work it out');
    expect(document.querySelector('[data-word-rescue-action="hint"]')?.textContent).toBe('Give me a thinking prompt');
    expect(document.querySelector('[data-word-rescue-action="reveal"]')?.textContent).toBe('Show a possible phrasing');
    expect(document.body.textContent).not.toContain('equivocate');

    document.querySelector('[data-word-rescue-action="hint"]').focus();
    document.querySelector('[data-word-rescue-action="hint"]').click();
    expect(document.body.textContent).toContain('What effect does the unclear answer have?');
    expect(handleChatMessage).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.getAttribute('data-word-rescue-action')).toBe('hint');

    document.querySelector('[data-word-rescue-action="reveal"]').focus();
    document.querySelector('[data-word-rescue-action="reveal"]').click();
    expect(document.querySelector('.word-rescue-reveal-word')?.textContent).toBe('equivocate');
    expect(document.body.textContent).toContain('prevaricate');
    expect(handleChatMessage).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.getAttribute('data-word-rescue-action')).toBe('restart');

    document.querySelector('[data-word-rescue-learn="coach-answer"]').click();
    expect(saveVocabulary).toHaveBeenCalledWith({
      expression: 'equivocate',
      word: 'equivocate',
      kind: 'expression',
      cue: 'someone who avoids giving a direct answer',
      explanation: 'To speak ambiguously so you do not commit clearly.',
      example: 'The spokesperson continued to equivocate.',
      hints: [
        'What effect does the unclear answer have?',
        'Is the broader idea avoidance, uncertainty, or dishonesty?',
        'Complete this: The witness continued to _____ instead of saying yes or no.',
      ],
      alternatives: ['prevaricate'],
    });
  });

  test('offers each fast Word Rescue candidate as an explicit practice choice', async () => {
    const messages = [];
    const saveVocabulary = jest.fn(() => ({ status: 'created', note: { title: 'precise' } }));
    window.__mobileMocks.getMessages = () => messages;
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.createMemoryCoachUi = () => ({
      activate() {},
      deactivate() {},
      render() {},
      isActive: () => false,
      saveVocabulary,
      hasSavedWord: () => false,
    });
    window.__mobileMocks.handleChatMessage = jest.fn(async (text) => {
      messages.push(
        { role: 'user', content: text, timestamp: Date.now() - 1 },
        { role: 'assistant', content: '1. precise\n2. meticulous', timestamp: Date.now() },
      );
      return {
        message: '1. precise\n2. meticulous',
        wordRescue: {
          mode: 'fast',
          candidates: [
            { expression: 'precise', meaning: 'Exact and accurate.', example: 'Use precise language.' },
            { expression: 'meticulous', meaning: 'Very careful about details.', example: 'She kept meticulous notes.' },
          ],
        },
      };
    });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    document.getElementById('wordRescueLauncher').click();
    document.querySelector('[data-word-rescue-action="find"]').click();
    const input = document.getElementById('thinkingBarInput');
    input.value = 'a word for careful and exact';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('[data-word-rescue-learn]')).toHaveLength(2);
    document.querySelector('[data-word-rescue-learn="fast-0"]').click();
    expect(saveVocabulary).toHaveBeenCalledWith({
      expression: 'precise',
      word: 'precise',
      kind: 'expression',
      cue: 'a word for careful and exact',
      explanation: 'Exact and accurate.',
      example: 'Use precise language.',
      alternatives: ['meticulous'],
    });
  });

  test('leaving Capture cancels Word help before the universal composer is used elsewhere', () => {
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    document.getElementById('wordRescueLauncher').click();
    document.querySelector('[data-word-rescue-action="find"]').click();

    document.body.dataset.activeView = 'reminders';
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'reminders' },
    }));

    expect(document.getElementById('wordRescueModeBar')?.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('thinkingBarInput')?.placeholder).toBe('Add a reminder, note, or askâ€¦');
    expect(document.body.classList.contains('word-rescue-mode-active')).toBe(false);
  });

  test('a late coach response cannot reactivate Word help after navigation', async () => {
    let resolveAssistant;
    const handleChatMessage = jest.fn(() => new Promise((resolve) => {
      resolveAssistant = resolve;
    }));
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.handleChatMessage = handleChatMessage;

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    document.getElementById('wordRescueLauncher').click();
    document.querySelector('[data-word-rescue-action="coach"]').click();
    const input = document.getElementById('thinkingBarInput');
    input.value = 'someone who avoids giving a direct answer';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();

    document.body.dataset.activeView = 'reminders';
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'reminders' },
    }));
    resolveAssistant({
      message: 'Hint 1 of 3: meaning clue',
      wordRescue: {
        mode: 'coach',
        hints: ['meaning clue', 'context clue', 'letter clue'],
        answer: { word: 'equivocate', explanation: 'Avoid a direct answer.', example: '' },
        alternatives: [],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.body.dataset.activeView = 'capture';
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'capture' },
    }));

    expect(document.getElementById('wordRescueModeBar')?.classList.contains('hidden')).toBe(true);
    expect(document.body.classList.contains('word-rescue-mode-active')).toBe(false);
    expect(document.querySelector('.word-rescue-coach-controls')).toBeNull();
  });

  test('starts a Class Hub note in the one universal input without leaving Notes and restores an existing Capture draft', () => {
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const input = document.getElementById('thinkingBarInput');
    input.value = 'Unsent ordinary Capture draft';
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    const detail = { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false };
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', { detail }));

    expect(detail.accepted).toBe(true);
    expect(input.value).toBe('');
    expect(document.querySelectorAll('textarea')).toHaveLength(1);

    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('classThoughtModeLabel')?.textContent).toBe('Year 8 HPE');
    expect(input.placeholder).toBe('Add anything about Year 8 HPE…');
    expect(input.maxLength).toBe(2400);
    expect(input.value).toBe('');
    expect(document.body.dataset.activeView).toBe('notebooks');

    document.getElementById('classThoughtExitButton').click();
    expect(input.value).toBe('Unsent ordinary Capture draft');
    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(true);
    expect(document.body.classList.contains('class-thought-mode-active')).toBe(false);
  });

  test('reviews a class thought before saving one linked Note and only selected untimed follow-ups', async () => {
    const createAndSaveNote = jest.fn((payload) => ({ id: 'note-ai', ...payload }));
    const createReminderFromPayload = jest.fn((payload) => ({ id: `reminder-${payload.text}`, ...payload }));
    const handleChatMessage = jest.fn(async () => ({
      message: 'Draft ready. Review it before saving.',
      classThoughtDraft: {
        note: {
          title: 'Students leaving an outdoor HPE lesson',
          body: 'Two students left the outdoor lesson without permission. <script>unsafe</script>',
          tags: ['behaviour', 'follow-up'],
        },
        followUps: [
          { text: 'Speak to the two students next lesson' },
          { text: 'Call the parent tomorrow' },
        ],
      },
    }));
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.handleChatMessage = handleChatMessage;
    window.__mobileMocks.createAndSaveNote = createAndSaveNote;
    window.__mobileMocks.initReminders = jest.fn().mockResolvedValue({
      createReminderFromPayload,
      getReminders: () => [],
    });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    const detail = { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false };
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', { detail }));
    const input = document.getElementById('thinkingBarInput');
    input.value = 'Two students disappeared during my outdoor HPE lesson. I need to speak to them next lesson.';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleChatMessage).toHaveBeenCalledWith(
      'Two students disappeared during my outdoor HPE lesson. I need to speak to them next lesson.',
      {
        assistantTask: 'organise_class_thought',
        classHubId: 'hub-hpe',
        classHubName: 'Year 8 HPE',
      },
    );
    expect(createAndSaveNote).not.toHaveBeenCalled();
    expect(createReminderFromPayload).not.toHaveBeenCalled();
    expect(document.querySelector('.class-thought-review-card')).not.toBeNull();
    expect(document.querySelector('[data-class-thought-review-host] .class-thought-review-card')).not.toBeNull();
    expect(document.body.dataset.activeView).toBe('notebooks');
    expect(document.body.classList.contains('class-thought-review-active')).toBe(true);
    const reviewHeading = document.querySelector('[data-class-thought-review-heading]');
    expect(document.activeElement).toBe(reviewHeading);
    expect(reviewHeading?.tabIndex).toBe(-1);
    expect(document.querySelector('.class-thought-review-note-body')?.textContent).toContain('<script>unsafe</script>');
    expect(input.readOnly).toBe(true);

    const followUpChecks = document.querySelectorAll('[data-class-thought-follow-up]');
    expect(followUpChecks).toHaveLength(2);
    followUpChecks[1].click();
    document.querySelector('[data-class-thought-save]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createAndSaveNote).toHaveBeenCalledTimes(1);
    expect(createAndSaveNote).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'hub-hpe',
      title: 'Students leaving an outdoor HPE lesson',
      source: 'assistant',
      entryPoint: 'class-hub-ai-organiser',
      bodyHtml: expect.stringContaining('&lt;script&gt;unsafe&lt;/script&gt;'),
    }));
    expect(createReminderFromPayload).toHaveBeenCalledTimes(1);
    expect(createReminderFromPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Speak to the two students next lesson',
        dueAt: null,
        notifyAt: null,
        metadata: expect.objectContaining({
          type: 'class-follow-up',
          classHubId: 'hub-hpe',
          suppressNotification: true,
        }),
      }),
      expect.objectContaining({ parseSchedule: false }),
    );
    expect(document.querySelector('.class-thought-review-card')).toBeNull();
  });

  test('Close pauses an unsent class note and Add note resumes it without losing the ordinary Capture draft', () => {
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const input = document.getElementById('thinkingBarInput');
    input.value = 'Ordinary Capture draft';
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', {
      detail: { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false },
    }));
    input.value = 'Unsent class thought that must survive';

    document.getElementById('classThoughtExitButton').click();
    expect(input.value).toBe('Ordinary Capture draft');
    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(true);

    const resumeDetail = { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false };
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', { detail: resumeDetail }));
    expect(resumeDetail.accepted).toBe(true);

    expect(input.value).toBe('Unsent class thought that must survive');
    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(false);
  });

  test('a paused class review does not block ordinary Capture and resumes unchanged', async () => {
    const classDraft = {
      message: 'Draft ready. Review it before saving.',
      classThoughtDraft: {
        note: { title: 'Class note', body: 'Organised class note', tags: [] },
        followUps: [{ text: 'Speak to the students next lesson' }],
      },
    };
    const handleChatMessage = jest.fn(async (_message, dependencies = {}) => (
      dependencies.assistantTask === 'organise_class_thought'
        ? classDraft
        : { message: 'Captured normally' }
    ));
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.handleChatMessage = handleChatMessage;

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const input = document.getElementById('thinkingBarInput');
    input.value = 'Ordinary Capture draft';
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', {
      detail: { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false },
    }));
    input.value = 'Class thought to review';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.class-thought-review-card')).not.toBeNull();

    document.body.dataset.activeView = 'capture';
    document.body.classList.remove('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'capture' },
    }));
    expect(input.value).toBe('Ordinary Capture draft');
    input.value = 'Save this ordinary Capture note';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handleChatMessage).toHaveBeenCalledTimes(2);
    expect(handleChatMessage.mock.calls[1][0]).toBe('Save this ordinary Capture note');
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'notebooks' },
    }));
    expect(document.querySelector('.class-thought-review-card')).not.toBeNull();
    expect(document.querySelector('.class-thought-review-note-title')?.textContent).toBe('Class note');
  });

  test('Escape outside the active Class Hub leaves a paused class note untouched', () => {
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const input = document.getElementById('thinkingBarInput');
    input.value = 'Ordinary Capture draft';
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', {
      detail: { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false },
    }));
    input.value = 'Paused class note';
    document.getElementById('classThoughtExitButton').click();

    document.body.dataset.activeView = 'capture';
    document.body.classList.remove('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'capture' },
    }));
    const escapeEvent = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escapeEvent);
    expect(escapeEvent.defaultPrevented).toBe(false);
    expect(document.body.dataset.activeView).toBe('capture');
    expect(input.value).toBe('Ordinary Capture draft');

    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'notebooks' },
    }));
    expect(input.value).toBe('Paused class note');
  });

  test('returning to a paused class note cannot let a pending Capture response clear it', async () => {
    let resolveCapture;
    const handleChatMessage = jest.fn(() => new Promise((resolve) => {
      resolveCapture = resolve;
    }));
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.handleChatMessage = handleChatMessage;

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const input = document.getElementById('thinkingBarInput');
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', {
      detail: { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false },
    }));
    input.value = 'Class note that must survive';
    document.getElementById('classThoughtExitButton').click();

    document.body.dataset.activeView = 'capture';
    document.body.classList.remove('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'capture' },
    }));
    input.value = 'Ordinary Capture request still running';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();

    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'notebooks' },
    }));
    expect(input.value).toBe('Ordinary Capture request still running');
    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(true);

    resolveCapture({ message: 'Captured normally' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.value).toBe('Class note that must survive');
    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(false);

    document.getElementById('classThoughtExitButton').click();
    expect(input.value).toBe('');
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', {
      detail: { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false },
    }));
    expect(input.value).toBe('Class note that must survive');
  });

  test('a pending Capture response cannot mount one class review inside another Class Hub', async () => {
    let resolveCapture;
    const handleChatMessage = jest.fn()
      .mockResolvedValueOnce({
        message: 'Draft ready. Review it before saving.',
        classThoughtDraft: {
          note: { title: 'Year 8 HPE note', body: 'HPE class detail', tags: [] },
          followUps: [{ text: 'Speak to the HPE students' }],
        },
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveCapture = resolve;
      }));
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [
      { id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' },
      { id: 'hub-maths', name: 'Year 8 Maths', kind: 'class-hub' },
    ];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.handleChatMessage = handleChatMessage;

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const input = document.getElementById('thinkingBarInput');
    const reviewHost = document.querySelector('[data-class-thought-review-host]');
    reviewHost.dataset.classThoughtReviewHost = 'hub-hpe';
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', {
      detail: { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false },
    }));
    input.value = 'HPE thought';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.class-thought-review-note-title')?.textContent).toBe('Year 8 HPE note');
    document.getElementById('classThoughtExitButton').click();

    document.body.dataset.activeView = 'capture';
    document.body.classList.remove('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'capture' },
    }));
    input.value = 'Ordinary Capture request';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();

    reviewHost.replaceChildren();
    reviewHost.dataset.classThoughtReviewHost = 'hub-maths';
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'notebooks' },
    }));
    resolveCapture({ message: 'Captured normally' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reviewHost.querySelector('.class-thought-review-card')).toBeNull();
    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(true);

    reviewHost.dataset.classThoughtReviewHost = 'hub-hpe';
    const resumeDetail = { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false };
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', { detail: resumeDetail }));
    expect(resumeDetail.accepted).toBe(true);
    expect(reviewHost.querySelector('.class-thought-review-note-title')?.textContent).toBe('Year 8 HPE note');
  });

  test('keeps the original class thought available when AI fails and writes nothing', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const createAndSaveNote = jest.fn();
    const createReminderFromPayload = jest.fn();
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.handleChatMessage = jest.fn().mockRejectedValue(new Error('provider failed'));
    window.__mobileMocks.createAndSaveNote = createAndSaveNote;
    window.__mobileMocks.initReminders = jest.fn().mockResolvedValue({ createReminderFromPayload, getReminders: () => [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    const detail = { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false };
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', { detail }));
    const input = document.getElementById('thinkingBarInput');
    input.value = 'I need to remember to speak to the students next lesson.';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(input.value).toBe('I need to remember to speak to the students next lesson.');
    expect(input.readOnly).toBe(false);
    expect(document.getElementById('thinkingBarStatus')?.textContent).toContain('Nothing was added');
    expect(document.querySelector('.class-thought-review-card')).toBeNull();
    expect(createAndSaveNote).not.toHaveBeenCalled();
    expect(createReminderFromPayload).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('retries only failed class follow-ups without duplicating the saved Note or successful rows', async () => {
    const createAndSaveNote = jest.fn((payload) => ({ id: 'note-ai', ...payload }));
    const createReminderFromPayload = jest.fn()
      .mockResolvedValueOnce({ id: 'reminder-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'reminder-2' });
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    window.__mobileMocks.createAndSaveNote = createAndSaveNote;
    window.__mobileMocks.initReminders = jest.fn().mockResolvedValue({
      createReminderFromPayload,
      getReminders: () => [],
    });
    window.__mobileMocks.handleChatMessage = jest.fn().mockResolvedValue({
      message: 'Draft ready. Review it before saving.',
      classThoughtDraft: {
        note: { title: 'Class note', body: 'Organised note body', tags: [] },
        followUps: [{ text: 'First follow-up' }, { text: 'Second follow-up' }],
      },
    });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', {
      detail: { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false },
    }));
    document.getElementById('thinkingBarInput').value = 'Thought to organise';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.querySelector('[data-class-thought-save]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createAndSaveNote).toHaveBeenCalledTimes(1);
    expect(createReminderFromPayload).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.class-thought-review-card')?.textContent).toContain('1 follow-up could not be saved');

    document.querySelector('[data-class-thought-save]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createAndSaveNote).toHaveBeenCalledTimes(1);
    expect(createReminderFromPayload).toHaveBeenCalledTimes(3);
    expect(createReminderFromPayload.mock.calls[2][0].text).toBe('Second follow-up');
    expect(document.querySelector('.class-thought-review-card')).toBeNull();
  });

  test('does not apply a late class note response or block Capture after the user leaves the Class Hub', async () => {
    let resolveAssistant;
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.getClassHubFolders = () => [{ id: 'hub-hpe', name: 'Year 8 HPE', kind: 'class-hub' }];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });
    const handleChatMessage = jest.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAssistant = resolve;
      }))
      .mockResolvedValueOnce({ message: 'Captured normally' });
    window.__mobileMocks.handleChatMessage = handleChatMessage;

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    const input = document.getElementById('thinkingBarInput');
    input.value = 'Original Capture draft';
    document.body.dataset.activeView = 'notebooks';
    document.body.classList.add('class-hub-open');
    const detail = { hubId: 'hub-hpe', hubName: 'Year 8 HPE', accepted: false };
    window.dispatchEvent(new window.CustomEvent('memoryCue:classThoughtStart', { detail }));
    input.value = 'Class thought waiting for AI';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();

    document.body.dataset.activeView = 'reminders';
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'reminders' },
    }));
    expect(input.value).toBe('Original Capture draft');

    document.body.dataset.activeView = 'capture';
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'capture' },
    }));
    input.value = 'Capture while the old class request finishes';
    document.getElementById('thinkingBarForm').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handleChatMessage).toHaveBeenCalledTimes(2);
    expect(handleChatMessage.mock.calls[1][0]).toBe('Capture while the old class request finishes');

    resolveAssistant({
      message: 'Draft ready. Review it before saving.',
      classThoughtDraft: {
        note: { title: 'Late draft', body: 'Should not appear', tags: [] },
        followUps: [{ text: 'Should not save' }],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.body.dataset.activeView = 'notebooks';
    window.dispatchEvent(new window.CustomEvent('memorycue:navigation:changed', {
      detail: { view: 'notebooks' },
    }));
    expect(document.querySelector('.class-thought-review-card')).toBeNull();
    expect(document.getElementById('classThoughtModeBar')?.classList.contains('hidden')).toBe(false);
    expect(input.value).toBe('Class thought waiting for AI');
  });
});
