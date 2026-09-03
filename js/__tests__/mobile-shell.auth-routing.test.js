/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODULE_PATH = path.join(__dirname, '..', '..', 'src', 'ui', 'mobileShellUi.js');

function loadMobileShellUi({ startSignInFlow, startSignOutFlow }) {
  let source = fs.readFileSync(MODULE_PATH, 'utf8');
  source = source
    .replace(/^import[\s\S]*?;\s*$/mg, '')
    .replace(/export\s+const\s+/g, 'const ');
  source += '\nmodule.exports = { initHeaderOverflowMenu };\n';

  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    startSignInFlow,
    startSignOutFlow,
    console,
    document,
    window,
    localStorage,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    CustomEvent: window.CustomEvent,
    MutationObserver: window.MutationObserver,
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
    clearTimeout,
  });
  new vm.Script(source, { filename: MODULE_PATH }).runInContext(context);
  return module.exports;
}

describe('mobile shell auth routing', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="overflowMenuBtn" type="button">Menu</button>
      <div id="overflowMenu">
        <section data-menu-section="account">
          <button id="googleSignInBtnMenu" type="button" data-menu-action="sign-in">Sign in</button>
          <button id="googleSignOutBtnMenu" type="button" data-menu-action="sign-out">Sign out</button>
        </section>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('does not start a second sign-out when the reminder controller handled the menu click', () => {
    const startSignOutFlow = jest.fn().mockResolvedValue(undefined);
    const cleanupAndSignOut = jest.fn((event) => {
      event.__memoryCueAuthHandled = true;
    });
    const { initHeaderOverflowMenu } = loadMobileShellUi({
      startSignInFlow: jest.fn().mockResolvedValue(undefined),
      startSignOutFlow,
    });
    initHeaderOverflowMenu();

    const button = document.getElementById('googleSignOutBtnMenu');
    button.addEventListener('click', cleanupAndSignOut);
    button.click();

    expect(cleanupAndSignOut).toHaveBeenCalledTimes(1);
    expect(startSignOutFlow).not.toHaveBeenCalled();
  });

  test('keeps the direct auth fallback before the reminder controller is ready', () => {
    const startSignOutFlow = jest.fn().mockResolvedValue(undefined);
    const { initHeaderOverflowMenu } = loadMobileShellUi({
      startSignInFlow: jest.fn().mockResolvedValue(undefined),
      startSignOutFlow,
    });
    initHeaderOverflowMenu();

    document.getElementById('googleSignOutBtnMenu').click();

    expect(startSignOutFlow).toHaveBeenCalledTimes(1);
  });
});
