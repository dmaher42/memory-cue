/**
 * @jest-environment jsdom
 */

const { describe, it, expect, beforeEach, beforeAll, afterEach } = require('@jest/globals');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

let DailyTasksManager;
let createDailyTasksManager;
let formatDuration;
let extractQuickAddMetadata;
let normaliseDailyTask;

function loadDailyTasksModule() {
  const filePath = path.resolve(__dirname, '../modules/daily-tasks.js');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source
    .replace(
      /import\s+\{\s*escapeCueText\s*\}\s+from\s+'\.\/field-helpers\.js';/,
      `function escapeCueText(value) {
  if (typeof value !== "string") {
    return "";
  }
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (char) => map[char] || char);
}`
    )
    .replace(/export\s+class\s+DailyTasksManager/g, 'class DailyTasksManager')
    .replace(/export\s+function\s+createDailyTasksManager/g, 'function createDailyTasksManager')
    .replace(/export\s+{[^}]+};?/g, '');
  source += `\nmodule.exports = { DailyTasksManager, createDailyTasksManager, formatDuration, extractQuickAddMetadata, normaliseDailyTask };\n`;
  const module = { exports: {} };
  const moduleRequire = Module.createRequire(filePath);
  const sandbox = {
    module,
    exports: module.exports,
    require: moduleRequire,
    console,
    document,
    window,
    HTMLElement,
    CustomEvent,
    navigator,
    crypto
  };
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return module.exports;
}

function createMockStorage() {
  const store = {};
  return {
    store,
    getItem: jest.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
    setItem: jest.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      Object.keys(store).forEach((key) => delete store[key]);
    })
  };
}

function setupDailyDom() {
  document.body.innerHTML = `
    <div>
      <div class="tabs">
        <button id="tab-cues" class="tab">Cues</button>
        <button id="tab-daily" class="tab">Daily</button>
      </div>
      <section id="cues-view"></section>
      <section id="daily-list-view" class="hidden">
        <h2 id="daily-list-header">Today's List</h2>
        <form id="quick-add-form">
          <input id="quick-add-input" />
          <button type="submit">Add</button>
          <button type="button" id="daily-voice-btn"><span aria-hidden="true">🎙️</span></button>
        </form>
        <div id="daily-list-permission-notice" class="hidden">Permission required</div>
        <div id="daily-tasks-container"></div>
      </section>
    </div>
  `;
  return {
    dailyTab: document.getElementById('tab-daily'),
    cuesTab: document.getElementById('tab-cues'),
    dailyView: document.getElementById('daily-list-view'),
    cuesView: document.getElementById('cues-view'),
    header: document.getElementById('daily-list-header'),
    quickAddForm: document.getElementById('quick-add-form'),
    quickAddInput: document.getElementById('quick-add-input'),
    voiceButton: document.getElementById('daily-voice-btn'),
    permissionNotice: document.getElementById('daily-list-permission-notice'),
    container: document.getElementById('daily-tasks-container')
  };
}

function createManager(overrides = {}) {
  const elements = setupDailyDom();
  const storage = createMockStorage();
  const manager = createDailyTasksManager({
    dailyTab: elements.dailyTab,
    cuesTab: elements.cuesTab,
    dailyView: elements.dailyView,
    cuesView: elements.cuesView,
    dailyListHeader: elements.header,
    quickAddForm: elements.quickAddForm,
    quickAddInput: elements.quickAddInput,
    quickAddVoiceButton: elements.voiceButton,
    dailyTasksContainer: elements.container,
    dailyListPermissionNotice: elements.permissionNotice,
    storage,
    window,
    document,
    forceLocalMode: overrides.forceLocalMode ?? true,
    ensureCueFirestore: overrides.ensureCueFirestore || (() => Promise.resolve(null))
  });
  return { manager, storage, elements };
}

beforeAll(() => {
  if (!global.crypto) {
    global.crypto = { randomUUID: jest.fn(() => `test-${Math.random().toString(16).slice(2)}`) };
  } else if (typeof global.crypto.randomUUID !== 'function') {
    global.crypto.randomUUID = jest.fn(() => `test-${Math.random().toString(16).slice(2)}`);
  }
  ({ DailyTasksManager, createDailyTasksManager, formatDuration, extractQuickAddMetadata, normaliseDailyTask } = loadDailyTasksModule());
});

beforeEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterEach(() => {
  document.body.innerHTML = '';
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete window.SpeechRecognition;
});

describe('DailyTasksManager', () => {
  it('switches between cues and daily views', async () => {
    const { manager, elements } = createManager();
    await manager.loadDailyTasks();
    manager.switchToDailyView();
    expect(elements.dailyView.classList.contains('hidden')).toBe(false);
    expect(elements.cuesView.classList.contains('hidden')).toBe(true);
    expect(elements.dailyTab.getAttribute('aria-selected')).toBe('true');

    manager.switchToCuesView();
    expect(elements.cuesView.classList.contains('hidden')).toBe(false);
    expect(elements.dailyView.classList.contains('hidden')).toBe(true);
    expect(elements.cuesTab.getAttribute('aria-selected')).toBe('true');
  });

  it('parses quick add metadata and renders tasks with stats', async () => {
    const { manager, storage, elements } = createManager();
    await manager.handleQuickAdd('Finish report !high #work @30m');
    expect(manager.tasks).toHaveLength(1);
    const [task] = manager.tasks;
    expect(task.priority).toBe('high');
    expect(task.category).toBe('work');
    expect(task.estimateMs).toBe(30 * 60_000);
    expect(elements.container.innerHTML).toContain('Finish report');
    expect(storage.setItem).toHaveBeenCalled();
    const statsText = document.querySelector('[data-role="daily-task-stats"]').textContent;
    expect(statsText).toContain('Tasks: 1');
  });

  it('completes and reverts tasks while tracking time', async () => {
    const { manager } = createManager();
    await manager.handleQuickAdd('Practice guitar');
    const [task] = manager.tasks;
    await manager.completeTask(task.id, true);
    const completedTask = manager.tasks.find((item) => item.id === task.id);
    expect(completedTask.completed).toBe(true);
    expect(completedTask.completedAt).not.toBeNull();
    expect(elementsFromManager(manager).container.innerHTML).toContain('Time:');

    await manager.completeTask(task.id, false);
    const reverted = manager.tasks.find((item) => item.id === task.id);
    expect(reverted.completed).toBe(false);
    expect(reverted.timeTrackedMs).toBe(0);
  });

  it('clears completed tasks and supports undo', async () => {
    const { manager } = createManager();
    await manager.handleQuickAdd('Task one');
    await manager.handleQuickAdd('Task two');
    const [first, second] = manager.tasks;
    await manager.completeTask(first.id, true);

    await manager.clearCompleted();
    expect(manager.tasks).toHaveLength(1);
    expect(manager.tasks[0].id).toBe(second.id);

    manager.undoLastAction();
    expect(manager.tasks).toHaveLength(2);
  });

  it('cycles priorities and sorts tasks accordingly', async () => {
    const { manager, elements } = createManager();
    await manager.handleQuickAdd('Medium priority !medium');
    await manager.handleQuickAdd('Low priority !low');
    const lowTask = manager.tasks.find((task) => task.text.includes('Low priority'));
    manager.cycleTaskPriority(lowTask.id);

    const rendered = Array.from(elements.container.querySelectorAll('[data-task-id]'));
    expect(rendered[0]?.textContent || '').toContain('Low priority');
    expect(rendered[0]?.textContent || '').toContain('Priority: High');
    const combinedText = rendered.map((node) => node.textContent || '').join(' ');
    expect(combinedText).toContain('Priority: Medium');
  });

  it('displays the permission notice in local mode', async () => {
    const { manager, elements } = createManager({ forceLocalMode: true });
    elements.permissionNotice.classList.add('hidden');
    await manager.loadDailyTasks();
    expect(elements.permissionNotice.classList.contains('hidden')).toBe(false);
    manager.hidePermissionNotice();
    expect(elements.permissionNotice.classList.contains('hidden')).toBe(true);
  });

  it('integrates voice input start and stop flows', async () => {
    class FakeSpeechRecognition {
      constructor() {
        this.start = jest.fn();
        this.stop = jest.fn();
        this.lang = 'en-AU';
        this.interimResults = false;
        this.continuous = false;
      }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    const { manager, elements } = createManager();

    elements.voiceButton.click();
    expect(manager.quickAddVoiceRecognition.start).toHaveBeenCalledTimes(1);
    expect(elements.voiceButton.getAttribute('aria-pressed')).toBe('true');

    manager.quickAddVoiceRecognition.onresult({ results: [[{ transcript: 'Buy milk' }]] });
    expect(elements.quickAddInput.value).toBe('Buy milk');

    elements.voiceButton.click();
    expect(manager.quickAddVoiceRecognition.stop).toHaveBeenCalledTimes(1);
  });

  it('renders completed task statistics and allows undoing deletion', async () => {
    const { manager } = createManager();
    await manager.handleQuickAdd('Task removable');
    const [task] = manager.tasks;
    manager.deleteTask(task.id);
    expect(manager.tasks).toHaveLength(0);
    manager.undoLastAction();
    expect(manager.tasks).toHaveLength(1);
    const statsText = document.querySelector('[data-role="daily-task-stats"]').textContent;
    expect(statsText).toContain('Tasks: 1');
  });

  it('formats durations for statistics helpers', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(90_000)).toBe('1m');
    expect(formatDuration(3_600_000)).toBe('1h');
  });

  it('extracts quick add metadata tokens', () => {
    const parsed = extractQuickAddMetadata('Call mom !low #family @2h');
    expect(parsed.priority).toBe('low');
    expect(parsed.category).toBe('family');
    expect(parsed.estimateMs).toBe(2 * 60 * 60_000);
    expect(parsed.text).toBe('Call mom');
  });
});

function elementsFromManager(manager) {
  return {
    container: manager.dailyTasksContainer
  };
}
