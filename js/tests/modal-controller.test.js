/**
 * @jest-environment jsdom
 */

const { describe, it, expect, beforeEach, beforeAll, afterEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let ModalController;
let createModalController;

function loadModalControllerModule() {
  const filePath = path.resolve(__dirname, '../modules/modal-controller.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(/export\s+class\s+ModalController/g, 'class ModalController')
    .replace(/export\s+function\s+createModalController/g, 'function createModalController');
  source += `\nmodule.exports = { ModalController, createModalController };\n`;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    document,
    window,
    CustomEvent,
    HTMLElement
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

function setupModalDom() {
  document.body.innerHTML = `
    <button id="openCueModal">Open</button>
    <div id="cue-modal" role="dialog">
      <div class="modal-backdrop"><button type="button">Backdrop</button></div>
      <h2 id="modal-title">Create Cue</h2>
      <input id="title" />
      <input id="secondary" />
      <button id="closeCueModal" type="button">Close</button>
      <button id="saveBtn" type="button">Save</button>
    </div>
  `;
  const modalElement = document.getElementById('cue-modal');
  modalElement.showModal = jest.fn(() => {
    modalElement.open = true;
    modalElement.setAttribute('open', '');
  });
  modalElement.close = jest.fn(() => {
    modalElement.open = false;
    modalElement.removeAttribute('open');
  });
  return {
    modalElement,
    openButton: document.getElementById('openCueModal'),
    closeButton: document.getElementById('closeCueModal'),
    backdropButton: modalElement.querySelector('.modal-backdrop button'),
    titleInput: document.getElementById('title'),
    modalTitle: document.getElementById('modal-title'),
    secondaryInput: document.getElementById('secondary')
  };
}

beforeAll(() => {
  ({ ModalController, createModalController } = loadModalControllerModule());
});

beforeEach(() => {
  document.body.innerHTML = '';
  ModalController.activeStack = [];
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ModalController', () => {
  it('shows the modal and focuses the title input', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    titleInput.focus = jest.fn();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    jest.useFakeTimers();
    await controller.show();
    jest.runAllTimers();

    expect(modalElement.showModal).toHaveBeenCalledTimes(1);
    expect(titleInput.focus).toHaveBeenCalled();
    expect(controller.isOpen).toBe(true);
    expect(modalElement.getAttribute('aria-hidden')).toBe('false');
    expect(modalElement.getAttribute('aria-modal')).toBe('true');
    expect(modalElement.getAttribute('role')).toBe('dialog');
    expect(modalElement.getAttribute('aria-labelledby')).toBe('modal-title');
  });

  it('hides the modal and restores focus', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    openButton.focus = jest.fn(() => {
      document.activeElement = openButton;
    });
    titleInput.focus = jest.fn();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    jest.useFakeTimers();
    openButton.focus();
    await controller.show();
    jest.runAllTimers();
    await controller.hide();

    expect(modalElement.close).toHaveBeenCalledTimes(1);
    expect(openButton.focus).toHaveBeenCalled();
    expect(controller.isOpen).toBe(false);
    expect(modalElement.getAttribute('aria-hidden')).toBe('true');
  });

  it('dispatches custom events when closing via button', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');

    jest.useFakeTimers();
    await controller.show();
    jest.runAllTimers();
    closeButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    jest.runAllTimers();

    const eventTypes = dispatchSpy.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toContain('cue:cancelled');
    expect(eventTypes).toContain('cue:close');

    const cancelledEvent = dispatchSpy.mock.calls.find(([event]) => event.type === 'cue:cancelled')[0];
    expect(cancelledEvent.detail.reason).toBe('user-dismissed');

    dispatchSpy.mockRestore();
  });

  it('supports backdrop and escape key cancellation', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');

    jest.useFakeTimers();
    await controller.show();
    jest.runAllTimers();

    backdropButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const backdropEvent = dispatchSpy.mock.calls.find(([event]) => event.type === 'cue:cancelled');
    expect(backdropEvent[0].detail.reason).toBe('backdrop');

    dispatchSpy.mockClear();
    controller.handleKeydown({ key: 'Escape', preventDefault: jest.fn() });
    const keyboardEvent = dispatchSpy.mock.calls.find(([event]) => event.type === 'cue:cancelled');
    expect(keyboardEvent[0].detail.reason).toBe('keyboard');

    dispatchSpy.mockRestore();
  });

  it('maintains a focus trap with tab navigation', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      secondaryInput
    } = setupModalDom();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    jest.useFakeTimers();
    await controller.show();
    jest.runAllTimers();

    const focusable = controller.getFocusableElements();
    expect(focusable.length).toBeGreaterThan(1);
    focusable.forEach((el) => {
      el.focus = jest.fn(() => {
      });
    });

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const originalActiveDescriptor = Object.getOwnPropertyDescriptor(document, 'activeElement');
    let activeEl = last;
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => activeEl
    });

    const preventNext = jest.fn();
    controller.handleKeydown({ key: 'Tab', preventDefault: preventNext, shiftKey: false });
    expect(first.focus).toHaveBeenCalled();
    expect(preventNext).toHaveBeenCalled();

    first.focus.mockClear();
    const preventPrev = jest.fn();
    activeEl = first;
    controller.handleKeydown({ key: 'Tab', preventDefault: preventPrev, shiftKey: true });
    expect(last.focus).toHaveBeenCalled();
    expect(preventPrev).toHaveBeenCalled();

    if (originalActiveDescriptor) {
      Object.defineProperty(document, 'activeElement', originalActiveDescriptor);
    }
  });

  it('toggles edit mode and updates titles', () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    controller.setEditMode(true);
    expect(modalTitle.textContent).toBe('Edit Cue');
    expect(modalElement.getAttribute('data-mode')).toBe('edit');

    controller.setEditMode(false);
    expect(modalTitle.textContent).toBe('Create Cue');
    expect(modalElement.getAttribute('data-mode')).toBe('create');
  });

  it('cleans up listeners and supports destroy()', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    const removeOpenSpy = jest.spyOn(openButton, 'removeEventListener');
    const removeDocumentSpy = jest.spyOn(document, 'removeEventListener');

    await controller.destroy();

    expect(removeOpenSpy).toHaveBeenCalledWith('click', controller.boundHandlers.handleOpenClick);
    expect(removeDocumentSpy).toHaveBeenCalledWith('cue:open', controller.boundHandlers.handleDocumentOpenRequest);
    expect(controller.isDestroyed).toBe(true);
    expect(ModalController.activeStack.includes(controller)).toBe(false);

    removeOpenSpy.mockRestore();
    removeDocumentSpy.mockRestore();
  });

  it('handles missing modal elements safely', async () => {
    const controller = createModalController({ modalElement: null });
    await expect(controller.show()).resolves.toBeUndefined();
    await expect(controller.hide()).resolves.toBeUndefined();
    expect(controller.isDisabled).toBe(true);
  });

  it('responds to global open and close requests', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    jest.useFakeTimers();
    document.dispatchEvent(new CustomEvent('cue:open', { detail: { mode: 'edit' } }));
    await Promise.resolve();
    jest.runAllTimers();
    expect(controller.isOpen).toBe(true);
    expect(modalElement.getAttribute('data-mode')).toBe('edit');

    document.dispatchEvent(new CustomEvent('cue:close', { detail: { reason: 'external' } }));
    await Promise.resolve();
    jest.runAllTimers();
    expect(controller.isOpen).toBe(false);
  });

  it('dispatches lifecycle events for show and hide', async () => {
    const {
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle
    } = setupModalDom();
    const controller = createModalController({
      modalElement,
      openButton,
      closeButton,
      backdropButton,
      titleInput,
      modalTitle,
      defaultTitle: 'Create Cue',
      editTitle: 'Edit Cue'
    });

    const shownListener = jest.fn();
    const hiddenListener = jest.fn();
    document.addEventListener('cue:shown', shownListener);
    document.addEventListener('cue:hidden', hiddenListener);

    jest.useFakeTimers();
    await controller.show();
    jest.runAllTimers();
    expect(shownListener).toHaveBeenCalled();

    await controller.hide();
    jest.runAllTimers();
    expect(hiddenListener).toHaveBeenCalled();

    document.removeEventListener('cue:shown', shownListener);
    document.removeEventListener('cue:hidden', hiddenListener);
  });

  it('supports stacking multiple modals', async () => {
    const modalA = document.createElement('div');
    modalA.id = 'modal-a';
    const modalB = document.createElement('div');
    modalB.id = 'modal-b';
    document.body.append(modalA, modalB);

    [modalA, modalB].forEach((modal) => {
      modal.showModal = function () {
        modal.open = true;
      };
      modal.close = function () {
        modal.open = false;
      };
    });

    const controllerA = createModalController({ modalElement: modalA, defaultTitle: 'A', editTitle: 'A Edit' });
    const controllerB = createModalController({ modalElement: modalB, defaultTitle: 'B', editTitle: 'B Edit' });

    await controllerA.show();
    await controllerB.show();

    expect(ModalController.activeStack[ModalController.activeStack.length - 1]).toBe(controllerB);
    expect(modalB.getAttribute('data-stack-index')).toBe(String(ModalController.activeStack.length - 1));

    await controllerB.hide();
    expect(ModalController.activeStack.includes(controllerB)).toBe(false);
  });
});
