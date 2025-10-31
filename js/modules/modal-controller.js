/**
 * @fileoverview Provides a reusable, accessible modal controller with focus management,
 * keyboard support, and event lifecycle hooks.
 */

/**
 * @typedef {Object} ModalControllerEvents
 * @property {string} [prepare]
 * @property {string} [openRequest]
 * @property {string} [closeRequest]
 * @property {string} [cancelled]
 * @property {string} [shown]
 * @property {string} [hidden]
 */

/**
 * @typedef {Object} ModalControllerAnimationHooks
 * @property {(controller: ModalController) => void | Promise<void>} [onBeforeShow]
 * @property {(controller: ModalController) => void | Promise<void>} [onAfterShow]
 * @property {(controller: ModalController) => void | Promise<void>} [onBeforeHide]
 * @property {(controller: ModalController) => void | Promise<void>} [onAfterHide]
 */

/**
 * @typedef {Object} ModalControllerOptions
 * @property {HTMLDialogElement | HTMLElement | null} [modalElement]
 * @property {HTMLElement | null} [openButton]
 * @property {HTMLElement | null} [closeButton]
 * @property {HTMLElement | null} [backdropButton]
 * @property {HTMLElement | null} [titleInput]
 * @property {HTMLElement | null} [modalTitle]
 * @property {string} [defaultTitle]
 * @property {string} [editTitle]
 * @property {boolean} [manageAria]
 * @property {boolean} [focusTrap]
 * @property {boolean} [autoFocus]
 * @property {EventTarget} [eventTarget]
 * @property {ModalControllerEvents} [events]
 * @property {ModalControllerAnimationHooks} [animationHooks]
 * @property {boolean} [enableStacking]
 */

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const DEFAULT_EVENTS = {
  prepare: 'cue:prepare',
  openRequest: 'cue:open',
  closeRequest: 'cue:close',
  cancelled: 'cue:cancelled',
  shown: 'cue:shown',
  hidden: 'cue:hidden'
};

/**
 * Controls modal behaviour including focus management, keyboard handling, and custom events.
 */
export class ModalController {
  /** @type {ModalController[]} */
  static activeStack = [];

  /**
   * @param {ModalControllerOptions} [options]
   */
  constructor(options = {}) {
    this.modal = options.modalElement ?? null;
    this.openButton = options.openButton ?? null;
    this.closeButton = options.closeButton ?? null;
    this.backdropButton = options.backdropButton ?? null;
    this.titleInput = options.titleInput ?? null;
    this.modalTitle = options.modalTitle ?? null;
    this.defaultTitle = options.defaultTitle ?? '';
    this.editTitle = options.editTitle ?? options.defaultTitle ?? '';
    this.isOpen = false;
    this.isDestroyed = false;
    this.manageAria = options.manageAria !== false;
    this.enableFocusTrap = options.focusTrap !== false;
    this.shouldAutoFocus = options.autoFocus !== false;
    this.eventTarget = options.eventTarget ?? document;
    this.events = { ...DEFAULT_EVENTS, ...(options.events || {}) };
    this.animationHooks = options.animationHooks ?? {};
    this.enableStacking = options.enableStacking !== false;
    this.isDisabled = false;

    this.previouslyFocusedElement = null;
    this.boundHandlers = {
      handleOpenClick: this.handleOpenClick.bind(this),
      handleCloseClick: this.handleCloseClick.bind(this),
      handleBackdropClick: this.handleBackdropClick.bind(this),
      handleCancel: this.handleCancel.bind(this),
      handleKeydown: this.handleKeydown.bind(this),
      handleDocumentOpenRequest: this.handleDocumentOpenRequest.bind(this),
      handleDocumentCloseRequest: this.handleDocumentCloseRequest.bind(this)
    };

    this.init();
  }

  /** Initialise the controller and wire listeners. */
  init() {
    if (!this.validateModal()) {
      this.isDisabled = true;
      return;
    }
    if (this.manageAria) {
      this.applyAriaAttributes();
    }
    this.setupEventListeners();
  }

  /** Validate modal element. */
  validateModal() {
    if (!this.modal || !(this.modal instanceof HTMLElement)) {
      console.warn('[ModalController] Modal element is not provided or invalid.');
      return false;
    }
    if (typeof this.modal.showModal !== 'function') {
      this.modal.showModal = this.modal.showModal || (() => {
        this.modal?.setAttribute('open', '');
      });
    }
    if (typeof this.modal.close !== 'function') {
      this.modal.close = this.modal.close || (() => {
        this.modal?.removeAttribute('open');
      });
    }
    if (!this.modal.hasAttribute('tabindex')) {
      this.modal.tabIndex = -1;
    }
    return true;
  }

  /** Apply ARIA attributes for accessibility. */
  applyAriaAttributes() {
    if (!this.modal) return;
    this.modal.setAttribute('role', this.modal.getAttribute('role') || 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    if (this.modalTitle && this.modalTitle.id) {
      this.modal.setAttribute('aria-labelledby', this.modalTitle.id);
    }
    if (this.titleInput && this.titleInput.id) {
      this.modal.setAttribute('aria-describedby', this.titleInput.id);
    }
    this.modal.setAttribute('aria-hidden', 'true');
  }

  /** Show the modal. */
  async show(detail = {}) {
    if (!this.modal || this.isDestroyed || this.isDisabled) return;
    if (this.isOpen) {
      if (this.shouldAutoFocus) {
        this.focusTitleInput();
      }
      return;
    }
    await this.runHook('onBeforeShow');
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (this.enableStacking) {
      this.addToStack();
    }
    if (typeof this.modal.showModal === 'function' && !this.modal.open) {
      this.modal.showModal();
    } else {
      this.modal.setAttribute('open', '');
    }
    this.modal.setAttribute('aria-hidden', 'false');
    this.isOpen = true;
    if (this.shouldAutoFocus) {
      this.focusTitleInput();
    }
    this.dispatchEvent('shown', { controller: this, ...detail });
    await this.runHook('onAfterShow');
  }

  /** Hide the modal. */
  async hide(detail = {}) {
    if (!this.modal || this.isDestroyed || this.isDisabled || !this.isOpen) return;
    await this.runHook('onBeforeHide');
    if (typeof this.modal.close === 'function' && this.modal.open) {
      this.modal.close();
    } else {
      this.modal.removeAttribute('open');
    }
    this.modal.setAttribute('aria-hidden', 'true');
    this.isOpen = false;
    this.removeFromStack();
    await this.restoreFocus();
    this.dispatchEvent('hidden', { controller: this, ...detail });
    await this.runHook('onAfterHide');
  }

  /** Focuses the title input field when present. */
  focusTitleInput() {
    const target = this.titleInput || this.modal?.querySelector('[autofocus]');
    if (!target || typeof target.focus !== 'function') {
      return;
    }
    window.setTimeout(() => {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }, 50);
  }

  /** Restore focus to previous element. */
  async restoreFocus() {
    const target = this.previouslyFocusedElement || this.openButton;
    if (target && typeof target.focus === 'function') {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }
    this.previouslyFocusedElement = null;
  }

  /** Setup all required event listeners. */
  setupEventListeners() {
    if (!this.modal) return;
    if (this.openButton) {
      this.openButton.addEventListener('click', this.boundHandlers.handleOpenClick);
    }
    if (this.closeButton) {
      this.closeButton.addEventListener('click', this.boundHandlers.handleCloseClick);
    }
    if (this.backdropButton) {
      this.backdropButton.addEventListener('click', this.boundHandlers.handleBackdropClick);
    }
    this.modal.addEventListener('cancel', this.boundHandlers.handleCancel);
    this.modal.addEventListener('keydown', this.boundHandlers.handleKeydown);
    if (this.eventTarget) {
      this.eventTarget.addEventListener(this.events.openRequest, this.boundHandlers.handleDocumentOpenRequest);
      this.eventTarget.addEventListener(this.events.closeRequest, this.boundHandlers.handleDocumentCloseRequest);
    }
  }

  /** Remove all listeners. */
  cleanup() {
    if (!this.modal) return;
    if (this.openButton) {
      this.openButton.removeEventListener('click', this.boundHandlers.handleOpenClick);
    }
    if (this.closeButton) {
      this.closeButton.removeEventListener('click', this.boundHandlers.handleCloseClick);
    }
    if (this.backdropButton) {
      this.backdropButton.removeEventListener('click', this.boundHandlers.handleBackdropClick);
    }
    this.modal.removeEventListener('cancel', this.boundHandlers.handleCancel);
    this.modal.removeEventListener('keydown', this.boundHandlers.handleKeydown);
    if (this.eventTarget) {
      this.eventTarget.removeEventListener(this.events.openRequest, this.boundHandlers.handleDocumentOpenRequest);
      this.eventTarget.removeEventListener(this.events.closeRequest, this.boundHandlers.handleDocumentCloseRequest);
    }
  }

  /** Destroy controller and cleanup listeners. */
  async destroy(detail = {}) {
    if (this.isDestroyed) return;
    await this.hide(detail);
    this.cleanup();
    this.isDestroyed = true;
  }

  /** Toggle edit mode state. */
  setEditMode(isEdit = false) {
    if (this.modalTitle) {
      this.modalTitle.textContent = isEdit ? this.editTitle : this.defaultTitle;
    }
    if (this.modal) {
      this.modal.setAttribute('data-mode', isEdit ? 'edit' : 'create');
    }
    this.currentMode = isEdit ? 'edit' : 'create';
  }

  /** Handle open button click. */
  handleOpenClick(event) {
    event.preventDefault();
    this.dispatchEvent('prepare', { mode: 'create', controller: this });
    this.setEditMode(false);
    this.show({ reason: 'open-button' });
  }

  /** Handle close button click. */
  handleCloseClick(event) {
    event.preventDefault();
    this.requestClose('user-dismissed');
  }

  /** Handle backdrop click. */
  handleBackdropClick(event) {
    event.preventDefault();
    this.requestClose('backdrop');
  }

  /** Handle cancel event (keyboard). */
  handleCancel(event) {
    event.preventDefault();
    this.requestClose('keyboard');
  }

  /** Handle keydown for focus trap and escape. */
  handleKeydown(event) {
    if (this.enableFocusTrap && event.key === 'Tab') {
      this.maintainFocus(event);
    }
    if (event.key === 'Escape') {
      this.requestClose('keyboard');
    }
  }

  /** Maintain focus within modal. */
  maintainFocus(event) {
    if (!this.modal) return;
    const focusable = this.getFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      this.modal.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Get focusable elements inside modal. */
  getFocusableElements() {
    if (!this.modal) return [];
    return Array.from(this.modal.querySelectorAll(FOCUSABLE_SELECTORS)).filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hasAttribute('disabled')) return false;
      const ariaHidden = el.getAttribute('aria-hidden');
      return ariaHidden !== 'true';
    });
  }

  /** Handle global open request events. */
  handleDocumentOpenRequest(event) {
    if (!event || (event.detail && event.detail.controller && event.detail.controller !== this)) {
      return;
    }
    const isEdit = Boolean(event?.detail?.mode === 'edit');
    this.setEditMode(isEdit);
    this.show({ reason: event?.detail?.reason || 'external-open', mode: event?.detail?.mode });
  }

  /** Handle global close request events. */
  handleDocumentCloseRequest(event) {
    if (!event) return;
    if (event.detail?.controller && event.detail.controller !== this) {
      return;
    }
    if (event.detail?.initiatedBy === 'controller') {
      return;
    }
    const reason = event.detail?.reason || 'external-close';
    this.hide({ reason });
  }

  /** Dispatch a custom event. */
  dispatchEvent(name, detail = {}) {
    const eventName = this.events[name];
    if (!eventName || !this.eventTarget || typeof this.eventTarget.dispatchEvent !== 'function') {
      return;
    }
    const customEvent = new CustomEvent(eventName, {
      detail,
      bubbles: false,
      cancelable: true
    });
    this.eventTarget.dispatchEvent(customEvent);
  }

  /** Initiate a close request with events. */
  requestClose(reason) {
    const detail = { reason, controller: this };
    this.dispatchEvent('cancelled', detail);
    this.dispatchEvent('closeRequest', { ...detail, initiatedBy: 'controller' });
    this.hide({ reason });
  }

  /** Run animation hook if provided. */
  async runHook(hookName) {
    const hook = this.animationHooks?.[hookName];
    if (typeof hook === 'function') {
      await hook(this);
    }
  }

  /** Add controller to active stack. */
  addToStack() {
    const stack = ModalController.activeStack;
    const existingIndex = stack.indexOf(this);
    if (existingIndex !== -1) {
      stack.splice(existingIndex, 1);
    }
    stack.push(this);
    this.stackIndex = stack.length - 1;
    this.modal?.setAttribute('data-stack-index', String(this.stackIndex));
  }

  /** Remove controller from stack. */
  removeFromStack() {
    const stack = ModalController.activeStack;
    const index = stack.indexOf(this);
    if (index !== -1) {
      stack.splice(index, 1);
    }
    this.stackIndex = undefined;
    if (this.modal) {
      this.modal.removeAttribute('data-stack-index');
    }
  }
}

/**
 * Factory for creating modal controllers.
 * @param {ModalControllerOptions} options
 * @returns {ModalController}
 */
export function createModalController(options) {
  return new ModalController(options);
}
