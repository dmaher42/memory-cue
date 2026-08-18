/** @jest-environment jsdom */

const { afterEach, beforeEach, describe, expect, test } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const { loadMobileModule } = require('./helpers/load-mobile-module');

describe('mobile notes formatting toolbar', () => {
  beforeEach(() => {
    delete window.__memoryCueMobileNotesInit;
    document.body.innerHTML = `
      <textarea id="noteTitleMobile"></textarea>
      <button id="noteSaveMobile" type="button">Save</button>
      <div id="scratchNotesToolbar" role="toolbar">
        <div class="rte-menu rte-text-style-menu">
          <button id="rteTextStyleTrigger" class="rte-menu-trigger" type="button" aria-expanded="false">
            <span data-rte-text-style-label>Body</span>
          </button>
          <div class="rte-menu-panel" hidden>
            <button class="rte-menu-option rte-text-style-option" type="button" data-text-style="heading">Heading</button>
          </div>
        </div>
        <div class="rte-menu rte-align-menu">
          <button id="rteAlignmentTrigger" class="rte-menu-trigger" type="button" data-alignment="left" aria-expanded="false"></button>
        <div class="rte-menu-panel" hidden>
          <button class="rte-menu-option rte-align-option" type="button" data-cmd="justifyCenter" data-alignment="center" aria-checked="false"></button>
        </div>
        <button type="button" data-action="use-selection-as-title">Use as title</button>
        </div>
      </div>
      <div id="notebook-editor-body" contenteditable="true"><p>Sample text</p></div>
    `;

    window.__mobileMocks = {
      initViewportHeight: jest.fn(),
      initReminders: jest.fn().mockResolvedValue({}),
      initAuth: jest.fn().mockResolvedValue({ auth: null, unsubscribe: () => {} }),
      loadAllNotes: () => [],
      saveAllNotes: () => true,
      initNotesSync: () => ({ handleSessionChange() {}, setFirebaseClient() {} }),
      initMobileNotesShellUi: () => ({
        applyNotesMode: () => {},
        isSavedNotesSheetOpen: () => false,
        showSavedNotesSheet: () => {},
        hideSavedNotesSheet: () => {},
        openNoteOptionsMenu: () => {},
        openFolderSelectorForNote: () => {},
        closeMoveFolderSheet: () => {},
        closeNoteFolderSheet: () => {},
      }),
      initMobileNotesFolderManager: () => ({
        setAfterFolderCreated: () => {},
        openNewFolderDialog: () => {},
        syncNoteFolderButtonLabel: () => {},
        closeOverflowMenu: () => {},
        handleMoveNoteToFolder: () => {},
        openFolderOverflowMenu: () => {},
      }),
      initMobileNotesBrowserUi: () => ({}),
      initMobileNotesEditorUi: () => ({}),
    };

    let activeAlignment = 'justifyleft';
    document.queryCommandState = jest.fn((command) => command === activeAlignment);
    document.queryCommandValue = jest.fn(() => 'p');
    document.execCommand = jest.fn((command) => {
      if (String(command).toLowerCase().startsWith('justify')) {
        activeAlignment = String(command).toLowerCase();
      }
      return true;
    });
  });

  afterEach(() => {
    if (window.__memoryCueNotesWatcher) {
      clearInterval(window.__memoryCueNotesWatcher);
      delete window.__memoryCueNotesWatcher;
    }
    delete window.__memoryCueMobileNotesInit;
    document.body.innerHTML = '';
    delete window.__mobileMocks;
    delete document.execCommand;
    delete document.queryCommandState;
    delete document.queryCommandValue;
  });

  test('production shell uses custom text type and icon alignment menus', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../mobile.html'), 'utf8');

    expect(html).toContain('id="rteTextStyleTrigger"');
    expect(html).toContain('data-text-style="heading"');
    expect(html).toContain('data-text-style="subheading"');
    expect(html).toContain('data-text-style="small"');
    expect(html).toContain('id="rteAlignmentTrigger"');
    expect(html).toContain('data-cmd="justifyCenter"');
    expect(html).toContain('data-action="use-selection-as-title"');
    expect(html).not.toContain('id="rteFontSizeSelect"');
  });

  test('opens the custom menus and applies text type and alignment commands', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const editor = document.getElementById('notebook-editor-body');
    editor.innerHTML = '<p>Sample text</p>';
    const editorText = editor.querySelector('p').firstChild;
    const range = document.createRange();
    range.selectNodeContents(editorText);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const textTrigger = document.getElementById('rteTextStyleTrigger');
    const textPanel = textTrigger.parentElement.querySelector('.rte-menu-panel');
    textTrigger.click();
    expect(textPanel.hidden).toBe(false);

    textPanel.querySelector('[data-text-style="heading"]').click();
    expect(document.execCommand).toHaveBeenCalledWith('formatBlock', false, 'h2');
    expect(textPanel.hidden).toBe(true);

    const alignmentTrigger = document.getElementById('rteAlignmentTrigger');
    const alignmentPanel = alignmentTrigger.parentElement.querySelector('.rte-menu-panel');
    alignmentTrigger.click();
    alignmentPanel.querySelector('[data-cmd="justifyCenter"]').click();

    expect(document.execCommand).toHaveBeenCalledWith('justifyCenter', false, null);
    expect(alignmentTrigger.dataset.alignment).toBe('center');
    expect(alignmentPanel.hidden).toBe(true);
  });

  test('uses highlighted note text as the saved title without removing it from the note', () => {
    loadMobileModule();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));

    const editor = document.getElementById('notebook-editor-body');
    editor.innerHTML = '<p>Sample text</p>';
    const editorText = editor.querySelector('p').firstChild;
    const range = document.createRange();
    range.setStart(editorText, 0);
    range.setEnd(editorText, 6);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const titleButton = document.querySelector('[data-action="use-selection-as-title"]');
    titleButton.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    titleButton.click();

    expect(document.getElementById('noteTitleMobile').value).toBe('Sample');
    expect(editor.textContent).toBe('Sample text');
  });
});
