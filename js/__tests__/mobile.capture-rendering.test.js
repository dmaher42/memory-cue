/** @jest-environment jsdom */

const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile capture result rendering', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <main id="main">
        <section id="view-capture">
          <h2>Capture</h2>
          <section id="chatConversationContainer"></section>
        </section>
      </main>
      <section id="thinkingBarContainer">
        <form id="thinkingBarForm">
          <textarea id="thinkingBarInput"></textarea>
          <button id="thinkingBarSubmit" type="submit">Send</button>
        </form>
        <div id="thinkingBarStatus" class="hidden"></div>
      </section>
    `;

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
    localStorage.clear();
    document.body.innerHTML = '';
    delete document.body.dataset.memoryCueAssistantInit;
    delete window.__mobileMocks;
  });

  test('keeps a time colon out of the displayed reminder title', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Saved as reminder');
    expect(document.querySelector('.capture-result-detail')?.textContent).toBe('Prepare the complete lesson sequence');
    expect(document.querySelector('.capture-result-meta')?.textContent).toBe('Tomorrow, 8:30 am');
    expect(document.querySelector('.capture-result-time')?.textContent).toBe('Just now');
    expect(document.querySelectorAll('.capture-result-related-link')).toHaveLength(0);
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
        { noteId: 'curriculum-map', label: 'Curriculum map' },
        { noteId: 'prior-lesson-notes', label: 'Prior lesson notes' },
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

    expect(document.querySelector('.capture-result-detail')?.textContent).toBe('Prepare the complete lesson sequence');
    expect(Array.from(document.querySelectorAll('.capture-result-meta-item')).map((item) => item.textContent))
      .toEqual(['Tomorrow, 8:30 am', 'School']);
    expect(document.querySelector('.capture-result-meta')?.getAttribute('aria-label'))
      .toBe('Reminder details: Tomorrow, 8:30 am, School');
    const related = document.querySelector('.capture-result-related');
    expect(related?.open).toBe(false);
    expect(related?.querySelector('summary')?.textContent).toBe('Related memories (2)');
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

    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Saved to notes');
    expect(document.querySelector('.capture-result-detail')?.textContent).toBe('Excursion permission form checklist');
    expect(document.querySelector('.capture-result-meta')?.textContent).toBe('School');
    expect(document.querySelector('.capture-result-meta')?.getAttribute('aria-label')).toBe('Note details: School');

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

    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Note removed');
    expect(document.querySelector('.capture-result-detail')?.textContent).toBe('Excursion permission form checklist');
    expect(document.querySelectorAll('.capture-result-action')).toHaveLength(0);
  });

  test('keeps one Capture heading and renders the empty state without nested card chrome', () => {
    window.__mobileMocks.getMessages = () => [];
    window.__mobileMocks.buildDashboard = () => ({ recent: [], today: [], inbox: [] });

    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const captureLabels = Array.from(document.querySelectorAll('#view-capture h2, #view-capture p'))
      .filter((element) => element.textContent?.trim() === 'Capture');
    const home = document.querySelector('.capture-home-shell');

    expect(captureLabels).toHaveLength(1);
    expect(home).not.toBeNull();
    expect(home.className).toBe('capture-home-shell w-full');
  });
});
