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
  });

  test('shows confirmed reminder metadata and keeps related memories collapsed', () => {
    const messageTimestamp = Date.now();
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
      timestamp: messageTimestamp,
    }];

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
