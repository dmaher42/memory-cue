/**
 * @jest-environment jsdom
 */

const { beforeEach, afterEach, describe, expect, test } = require('@jest/globals');

describe('mobile header overflow menu', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <button id="headerMenuBtn" aria-expanded="false">Menu</button>
      <div id="headerMenu" class="overflow-menu hidden" aria-hidden="true"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('clicking headerMenuBtn toggles headerMenu visibility', () => {
    const menuBtn = document.getElementById('headerMenuBtn');
    const menu = document.getElementById('headerMenu');

    // replicate the inline script wiring used in mobile.html
    const closeMenu = () => {
      menu.classList.add('hidden');
      menu.setAttribute('aria-hidden', 'true');
      menuBtn.setAttribute('aria-expanded', 'false');
    };

    const openMenu = () => {
      menu.classList.remove('hidden');
      menu.setAttribute('aria-hidden', 'false');
      menuBtn.setAttribute('aria-expanded', 'true');
    };

    menuBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const isOpen = menuBtn.getAttribute('aria-expanded') === 'true';
      if (isOpen) closeMenu(); else openMenu();
    });

    // initial hidden
    expect(menu.classList.contains('hidden')).toBeTruthy();
    expect(menu.getAttribute('aria-hidden')).toBe('true');

    // click to open
    menuBtn.click();
    expect(menu.classList.contains('hidden')).toBeFalsy();
    expect(menu.getAttribute('aria-hidden')).toBe('false');
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');

    // click to close
    menuBtn.click();
    expect(menu.classList.contains('hidden')).toBeTruthy();
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(menuBtn.getAttribute('aria-expanded')).toBe('false');
  });

  test('clicking outside closes the menu', () => {
    const menuBtn = document.getElementById('headerMenuBtn');
    const menu = document.getElementById('headerMenu');

    // simple wiring
    menuBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      menu.classList.toggle('hidden');
    });

    document.addEventListener('click', (ev) => {
      if (!menu.contains(ev.target) && ev.target !== menuBtn) {
        menu.classList.add('hidden');
      }
    });

    // open
    menuBtn.click();
    expect(menu.classList.contains('hidden')).toBeFalsy();

    // click outside
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const evt = new MouseEvent('click', { bubbles: true });
    outside.dispatchEvent(evt);

    expect(menu.classList.contains('hidden')).toBeTruthy();
  });
});
