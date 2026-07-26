/** @jest-environment jsdom */

const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile capture result rendering', () => {
  beforeEach(() => {
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

    window.__mobileMocks = {
      getMessages: () => [{
        role: 'assistant',
        content: 'Reminder created for tomorrow at 8:30 am: Prepare the complete lesson sequence.',
      }],
      createChatComposer: () => ({ autoResize: jest.fn() }),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete document.body.dataset.memoryCueAssistantInit;
    delete window.__mobileMocks;
  });

  test('keeps a time colon out of the displayed reminder title', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    expect(document.querySelector('.capture-result-title')?.textContent).toBe('Saved as reminder');
    expect(document.querySelector('.capture-result-detail')?.textContent).toBe('Prepare the complete lesson sequence');
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
