/**
 * @jest-environment jsdom
 */
const { test, expect, beforeEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function runMainModule() {
  const filePath = path.resolve(__dirname, './js/main.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(
    "import { initViewportHeight } from './modules/viewport-height.js';",
    'const initViewportHeight = () => () => {};',
  );
  const script = new vm.Script(source, { filename: filePath });
  const context = vm.createContext({
    window,
    document,
    console,
    localStorage,
    CustomEvent: window.CustomEvent,
    setTimeout,
    clearTimeout,
  });
  script.runInContext(context);
}

beforeEach(() => {
  // Minimal DOM with theme toggle button
  document.body.innerHTML = '<button id="theme-toggle"></button>';
  // Stub matchMedia to avoid errors and default to light mode
  window.matchMedia = window.matchMedia || function(){
    return { matches: false, addListener: () => {}, removeListener: () => {} };
  };
  // Clear localStorage and provide firebase stub used in main.js
  localStorage.clear();
  global.firebase = {
    auth: Object.assign(
      () => ({
        signInWithPopup: jest.fn(),
        signOut: jest.fn(),
        onAuthStateChanged: jest.fn(),
      }),
      { GoogleAuthProvider: function(){} }
    ),
  };
  jest.resetModules();
  runMainModule();
});

test('toggle persists theme', () => {
  const btn = document.getElementById('theme-toggle');
  // Default should be light
  expect(localStorage.getItem('theme')).toBe('light');
  btn.click();
  expect(localStorage.getItem('theme')).toBe('dark');
  btn.click();
  expect(localStorage.getItem('theme')).toBe('light');
});
