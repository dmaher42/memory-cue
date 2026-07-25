import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const REMINDER_STORAGE_KEY = 'memoryCue:offlineReminders';
const SERVER_BOOT_TIMEOUT_MS = 15000;

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

async function resolveBuiltAppDir(cwd) {
  const distDir = path.resolve(cwd, 'dist');
  const mobileHtmlPath = path.join(distDir, 'mobile.html');
  try {
    await fs.access(mobileHtmlPath);
    return distDir;
  } catch {
    throw new Error(`Built app not found at ${mobileHtmlPath}. Run "npm run build" before "npm run check:reminders".`);
  }
}

async function startStaticServer(appDir) {
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === '/') {
        pathname = '/mobile.html';
      }

      const resolvedPath = path.resolve(appDir, `.${pathname}`);
      if (!resolvedPath.startsWith(appDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const file = await fs.readFile(resolvedPath);
      res.writeHead(200, { 'Content-Type': getContentType(resolvedPath) });
      res.end(file);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(process.env.PORT ? Number(process.env.PORT) : 0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : process.env.PORT;
  return {
    server,
    baseUrl: process.env.URL || `http://127.0.0.1:${port}/mobile.html`,
  };
}

async function waitForServer(url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_BOOT_TIMEOUT_MS) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the timeout expires.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for local server at ${url}`);
}

async function main() {
  const cwd = process.cwd();
  const appDir = await resolveBuiltAppDir(cwd);
  const { server, baseUrl } = await startStaticServer(appDir);
  let browser = null;

  try {
    await waitForServer(baseUrl);

    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
    });
    const context = await browser.newContext({
      timezoneId: 'Australia/Adelaide',
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();

    const logs = [];
    page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => logs.push({ type: 'pageerror', text: error.message }));

    await page.addInitScript(({ reminderStorageKey }) => {
      const fixedNowIso = '2026-03-23T08:00:00+10:30';
      const NativeDate = Date;
      const fixedNow = new NativeDate(fixedNowIso);

      class MockDate extends NativeDate {
        constructor(...args) {
          if (args.length === 0) {
            super(fixedNow.getTime());
            return;
          }
          super(...args);
        }

        static now() {
          return fixedNow.getTime();
        }
      }

      MockDate.UTC = NativeDate.UTC;
      MockDate.parse = NativeDate.parse;
      globalThis.Date = MockDate;
      globalThis.toast = () => {};
      localStorage.setItem('memoryCueInbox', JSON.stringify([]));
      localStorage.setItem(reminderStorageKey, JSON.stringify([
        {
          id: 'seed-unscheduled-title',
          title: 'call tuesday about roster',
          category: 'General',
          priority: 'Medium',
          done: false,
          createdAt: fixedNow.getTime() - 60000,
          updatedAt: fixedNow.getTime() - 60000,
        },
      ]));
    }, { reminderStorageKey: REMINDER_STORAGE_KEY });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.memoryCueQuickAddNow === 'function');
    await page.evaluate(() => {
      window.memoryCueQuickAddNow({ forceText: 'add remider tomorrow at 8:30 am get naplan' });
      return true;
    });
    await page.waitForFunction((reminderStorageKey) => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
        return Array.isArray(reminders) && reminders.length > 0;
      } catch {
        return false;
      }
    }, REMINDER_STORAGE_KEY);
    await page.click('#mobile-footer-reminders');
    await page.waitForFunction(() => {
      const panel = document.getElementById('view-reminders');
      return panel && !panel.classList.contains('hidden');
    });

    const visibleTitleCount = await page.locator('.reminders-screen-title:visible').count();
    if (visibleTitleCount !== 0) {
      throw new Error('Expected the space-consuming Reminders title card to be removed.');
    }
    const quickAddPlaceholder = await page.locator('#reminderQuickAdd').getAttribute('placeholder');
    if (quickAddPlaceholder) {
      throw new Error(`Expected an empty quick-add field, received placeholder: ${quickAddPlaceholder}`);
    }

    await page.click('#quickAddOptionsToggle');
    if (await page.locator('#quickAddOptions').isHidden()) {
      throw new Error('Expected reminder options to open from the compact options button.');
    }
    const quickAddOptionsScreenshotOutput = typeof process.env.PLAYWRIGHT_QUICK_ADD_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_QUICK_ADD_SCREENSHOT_PATH.trim()
      : '';
    if (quickAddOptionsScreenshotOutput) {
      const quickAddOptionsScreenshotPath = path.resolve(cwd, quickAddOptionsScreenshotOutput);
      await fs.mkdir(path.dirname(quickAddOptionsScreenshotPath), { recursive: true });
      await page.screenshot({ path: quickAddOptionsScreenshotPath, fullPage: true });
    }
    await page.selectOption('#quickAddCategory', 'School');
    await page.fill('#reminderQuickAdd', 'Call Mum tomorrow at 6pm');
    await page.click('#quickAddSubmit');
    await page.waitForFunction((reminderStorageKey) => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
        return reminders.some((reminder) => reminder?.title === 'Call Mum' && reminder?.category === 'School');
      } catch {
        return false;
      }
    }, REMINDER_STORAGE_KEY);
    if (!(await page.locator('#quickAddOptions').isHidden())) {
      throw new Error('Expected reminder options to close after saving.');
    }

    const boardColumnLabels = await page.locator('.reminder-category-column-title').allTextContents();
    if (JSON.stringify(boardColumnLabels.map((label) => label.trim())) !== JSON.stringify(['School', 'Footy'])) {
      throw new Error(`Expected School and Footy board columns, received: ${JSON.stringify(boardColumnLabels)}`);
    }

    await page.locator('[data-reminder-column="school"] [data-action="rename-column"]').click();
    await page.locator('[data-reminder-column="school"] .reminder-category-column-rename-input').fill('Work');
    const renameEditorScreenshotOutput = typeof process.env.PLAYWRIGHT_RENAME_EDITOR_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_RENAME_EDITOR_SCREENSHOT_PATH.trim()
      : '';
    if (renameEditorScreenshotOutput) {
      const renameEditorScreenshotPath = path.resolve(cwd, renameEditorScreenshotOutput);
      await fs.mkdir(path.dirname(renameEditorScreenshotPath), { recursive: true });
      await page.screenshot({ path: renameEditorScreenshotPath, fullPage: true });
    }
    await page.locator('[data-reminder-column="school"] .reminder-category-column-rename-save').click();
    await page.waitForFunction(() => (
      document.querySelector('[data-reminder-column="school"] .reminder-category-column-title')?.textContent?.trim() === 'Work'
    ));
    const renamedSchoolLabel = (
      await page.locator('[data-reminder-column="school"] .reminder-category-column-title').textContent()
    )?.trim();
    const persistedBoardLabels = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('memoryCue:reminderBoardLabels') || '{}');
      } catch {
        return {};
      }
    });
    const otherReminderHelp = (
      await page.locator('.reminder-other-cards-help').textContent()
    )?.trim();
    if (renamedSchoolLabel !== 'Work' || persistedBoardLabels.school !== 'Work') {
      throw new Error(`Expected renamed School column to persist as Work, received: ${JSON.stringify({ renamedSchoolLabel, persistedBoardLabels })}`);
    }
    if (!/Move these to Work or Footy/i.test(otherReminderHelp || '')) {
      throw new Error(`Expected Other reminder help to use the renamed column, received: ${otherReminderHelp}`);
    }

    await page.locator('[data-reminder-column="school"] [data-action="change-column-colour"]').evaluate((input) => {
      input.value = '#dc2626';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      try {
        const colors = JSON.parse(localStorage.getItem('memoryCue:reminderGroupColors') || '{}');
        return colors.School === '#dc2626'
          && document.querySelector('[data-reminder-column="school"]')?.style.getPropertyValue('--reminder-column-accent') === '#dc2626'
          && getComputedStyle(document.querySelector('[data-title="Call Mum"]')).borderLeftColor === 'rgb(220, 38, 38)';
      } catch {
        return false;
      }
    });
    const schoolColumnColour = await page.locator('[data-reminder-column="school"] [data-action="change-column-colour"]').inputValue();
    if (schoolColumnColour !== '#dc2626') {
      throw new Error(`Expected Work column colour to be #dc2626, received: ${schoolColumnColour}`);
    }

    await page.locator('[data-reminder-column="other"] [data-title="Call Tuesday About Roster"] .reminder-stream-more').click();
    const categoryColourControl = page.locator('.reminder-card-actions-menu [data-action="change-category-colour"] input[type="color"]');
    await categoryColourControl.waitFor({ state: 'visible' });
    const colourMenuScreenshotOutput = typeof process.env.PLAYWRIGHT_COLOUR_MENU_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_COLOUR_MENU_SCREENSHOT_PATH.trim()
      : '';
    if (colourMenuScreenshotOutput) {
      const colourMenuScreenshotPath = path.resolve(cwd, colourMenuScreenshotOutput);
      await fs.mkdir(path.dirname(colourMenuScreenshotPath), { recursive: true });
      await page.screenshot({ path: colourMenuScreenshotPath, fullPage: true });
    }
    await categoryColourControl.evaluate((input) => {
      input.value = '#0d9488';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      try {
        const colors = JSON.parse(localStorage.getItem('memoryCue:reminderGroupColors') || '{}');
        return colors.General === '#0d9488'
          && document.querySelector('[data-title="Call Tuesday About Roster"]')?.style.getPropertyValue('--reminder-category-color') === '#0d9488'
          && getComputedStyle(document.querySelector('[data-title="Call Tuesday About Roster"]')).borderLeftColor === 'rgb(13, 148, 136)';
      } catch {
        return false;
      }
    });
    const generalCategoryColour = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('memoryCue:reminderGroupColors') || '{}').General || '';
      } catch {
        return '';
      }
    });

    await page.click('#quickAddOptionsToggle');
    await page.selectOption('#quickAddCategory', 'Footy');
    await page.fill('#reminderQuickAdd', 'Training tomorrow at 7pm');
    await page.click('#quickAddSubmit');
    await page.waitForFunction((reminderStorageKey) => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
        return reminders.some((reminder) => reminder?.title === 'Training' && reminder?.category === 'Footy');
      } catch {
        return false;
      }
    }, REMINDER_STORAGE_KEY);

    const screenshotOutput = typeof process.env.PLAYWRIGHT_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_SCREENSHOT_PATH.trim()
      : '';
    if (screenshotOutput) {
      const screenshotPath = path.resolve(cwd, screenshotOutput);
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    await page.locator('[data-reminder-column="school"] [data-title="Call Mum"] .reminder-stream-more').click();
    await page.locator('.reminder-card-actions-menu [data-action="move-to-footy"]').click();
    await page.waitForFunction((reminderStorageKey) => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
        return reminders.some((reminder) => reminder?.title === 'Call Mum' && reminder?.category === 'Footy');
      } catch {
        return false;
      }
    }, REMINDER_STORAGE_KEY);

    await page.locator('[data-reminder-column="footy"] [data-title="Training"] .reminder-stream-more').click();
    await page.locator('.reminder-card-actions-menu [data-action="move-card-up"]').click();
    const firstFootyCardTitle = await page.locator('[data-reminder-column="footy"] [data-reminder-item="true"]')
      .first()
      .getAttribute('data-title');
    if (firstFootyCardTitle !== 'Training') {
      throw new Error(`Expected Training to move to the top of Footy, received: ${firstFootyCardTitle}`);
    }

    await page.locator('[data-reminder-column="footy"] [data-title="Training"] .reminder-stream-more').click();
    await page.locator('.reminder-card-actions-menu [data-action="edit-card"]').click();
    await page.locator('#create-sheet[data-mode="edit"]').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');

    await page.locator('[data-reminder-column="footy"] [data-title="Training"] .reminder-stream-more').click();
    await page.locator('.reminder-card-actions-menu [data-action="delete-card"]').click();
    await page.waitForFunction((reminderStorageKey) => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
        return !reminders.some((reminder) => reminder?.title === 'Training');
      } catch {
        return false;
      }
    }, REMINDER_STORAGE_KEY);

    await page.locator('[data-reminder-column="footy"] .reminder-category-add-card').click();
    const addCardCategory = await page.inputValue('#category');
    if (addCardCategory !== 'Footy') {
      throw new Error(`Expected Footy add-card control to preselect Footy, received: ${addCardCategory}`);
    }

    const sheetCategoryState = await page.evaluate(() => ({
      footyPressed: document.querySelector('[data-category-choice="Footy"]')?.getAttribute('aria-pressed'),
      footyLabel: document.querySelector('[data-category-choice="Footy"]')?.textContent?.trim(),
      schoolLabel: document.querySelector('[data-category-choice="School"]')?.textContent?.trim(),
      otherPressed: document.getElementById('reminderCategoryOther')?.getAttribute('aria-pressed'),
      customCategoryHidden: document.getElementById('reminderCustomCategoryField')?.classList.contains('hidden'),
      saveLabel: document.getElementById('saveReminder')?.textContent?.trim(),
      focusedId: document.activeElement?.id,
    }));
    if (
      sheetCategoryState.footyPressed !== 'true' ||
      sheetCategoryState.footyLabel !== 'Footy' ||
      sheetCategoryState.schoolLabel !== 'Work' ||
      sheetCategoryState.otherPressed !== 'false' ||
      sheetCategoryState.customCategoryHidden !== true ||
      sheetCategoryState.saveLabel !== 'Add to Footy' ||
      sheetCategoryState.focusedId !== 'reminderText'
    ) {
      throw new Error(`Unexpected add-reminder category state: ${JSON.stringify(sheetCategoryState)}`);
    }

    await page.locator('[data-reminder-date-preset="tomorrow"]').click();
    const tomorrowValue = await page.inputValue('#reminderDate');
    if (tomorrowValue !== '2026-03-24') {
      throw new Error(`Expected Tomorrow to choose 2026-03-24, received: ${tomorrowValue}`);
    }

    await page.locator('#reminderDetailsDisclosure > summary').click();
    await page.fill('#reminderDetails', 'Bring the team sheet');
    if ((await page.locator('#reminderDetailsSummary').textContent())?.trim() !== 'Added') {
      throw new Error('Expected the details summary to confirm that details were added');
    }

    await page.locator('#reminderOptionsDisclosure > summary').click();
    const priorityLabels = page.locator('#priorityChips .priority-pill');
    if (await priorityLabels.count() !== 3) {
      throw new Error('Expected three visible priority choices');
    }
    for (const label of await priorityLabels.all()) {
      if (!(await label.isVisible())) {
        throw new Error(`Priority choice is hidden: ${(await label.textContent())?.trim()}`);
      }
    }
    if (!(await page.locator('.reminder-notification-setting .switch-track').isVisible())) {
      throw new Error('Expected the reminder alert switch to be visibly styled');
    }

    const reminderOptionsScreenshotOutput = typeof process.env.PLAYWRIGHT_REMINDER_OPTIONS_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_REMINDER_OPTIONS_SCREENSHOT_PATH.trim()
      : '';
    if (reminderOptionsScreenshotOutput) {
      const reminderOptionsScreenshotPath = path.resolve(cwd, reminderOptionsScreenshotOutput);
      await fs.mkdir(path.dirname(reminderOptionsScreenshotPath), { recursive: true });
      await page.locator('#priorityChips').scrollIntoViewIfNeeded();
      await page.screenshot({ path: reminderOptionsScreenshotPath, fullPage: true });
      await page.evaluate(() => {
        const content = document.querySelector('.reminder-sheet-content');
        if (content instanceof HTMLElement) content.scrollTop = 0;
      });
    }

    const overlapState = await page.evaluate(() => {
      const save = document.getElementById('saveReminder')?.getBoundingClientRect();
      const date = document.getElementById('reminderDate')?.getBoundingClientRect();
      const time = document.getElementById('reminderTime')?.getBoundingClientRect();
      const overlaps = (first, second) => Boolean(first && second && !(
        first.right <= second.left ||
        first.left >= second.right ||
        first.bottom <= second.top ||
        first.top >= second.bottom
      ));
      return {
        saveOverlapsDate: overlaps(save, date),
        saveOverlapsTime: overlaps(save, time),
      };
    });
    if (overlapState.saveOverlapsDate || overlapState.saveOverlapsTime) {
      throw new Error(`Save action overlaps date controls: ${JSON.stringify(overlapState)}`);
    }

    await page.setViewportSize({ width: 390, height: 520 });
    const compactLayoutState = await page.evaluate(() => {
      const panelElement = document.querySelector('#create-sheet .sheet-panel');
      const shellElement = document.querySelector('.reminder-editor-shell');
      const panel = panelElement?.getBoundingClientRect();
      const shell = document.querySelector('.reminder-editor-shell')?.getBoundingClientRect();
      const header = document.querySelector('.reminder-editor-header')?.getBoundingClientRect();
      const save = document.getElementById('saveReminder')?.getBoundingClientRect();
      return {
        panelTop: panel?.top,
        panelBottom: panel?.bottom,
        panelHeight: panel?.height,
        shellTop: shell?.top,
        shellBottom: shell?.bottom,
        shellHeight: shell?.height,
        headerBottom: header?.bottom,
        saveTop: save?.top,
        saveBottom: save?.bottom,
        viewportHeight: window.innerHeight,
        panelBoxSizing: panelElement ? getComputedStyle(panelElement).boxSizing : '',
        panelPadding: panelElement ? getComputedStyle(panelElement).padding : '',
        panelPosition: panelElement ? getComputedStyle(panelElement).position : '',
        panelTopStyle: panelElement ? getComputedStyle(panelElement).top : '',
        panelBottomStyle: panelElement ? getComputedStyle(panelElement).bottom : '',
        panelHeightStyle: panelElement ? getComputedStyle(panelElement).height : '',
        panelTransform: panelElement ? getComputedStyle(panelElement).transform : '',
        shellHeightStyle: shellElement ? getComputedStyle(shellElement).height : '',
      };
    });
    if (
      compactLayoutState.shellTop < 0 ||
      compactLayoutState.saveTop <= compactLayoutState.headerBottom ||
      compactLayoutState.saveBottom > compactLayoutState.viewportHeight
    ) {
      throw new Error(`Reminder sheet does not fit compact viewport: ${JSON.stringify(compactLayoutState)}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    await page.fill('#reminderDetails', '');
    await page.locator('#reminderOptionsDisclosure > summary').click();
    await page.locator('#reminderDetailsDisclosure > summary').click();
    const reminderSheetScreenshotOutput = typeof process.env.PLAYWRIGHT_REMINDER_SHEET_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_REMINDER_SHEET_SCREENSHOT_PATH.trim()
      : '';
    if (reminderSheetScreenshotOutput) {
      const reminderSheetScreenshotPath = path.resolve(cwd, reminderSheetScreenshotOutput);
      await fs.mkdir(path.dirname(reminderSheetScreenshotPath), { recursive: true });
      await page.screenshot({ path: reminderSheetScreenshotPath, fullPage: true });
    }

    await page.locator('#saveReminder').click();
    if (!(await page.locator('#reminderTitleError').isVisible())) {
      throw new Error('Expected an inline title message when saving a blank reminder');
    }
    await page.keyboard.press('Escape');

    const titleTexts = await page.locator(
      '#view-reminders .reminder-row-title, #view-reminders .reminder-group-row-title',
    ).allTextContents();
    const metaTexts = await page.locator(
      '#view-reminders .reminder-stream-meta, #view-reminders .reminder-row-meta, #view-reminders .reminder-group-row-due',
    ).allTextContents();
    const titleText = (titleTexts || []).map((text) => (text || '').trim()).find((text) => text === 'Get Naplan');
    const metaText = (metaTexts || []).map((text) => (text || '').trim()).find((text) => /Tomorrow,\s*0?8:30(?:\s?AM)?/i.test(text || ''));
    const unscheduledTitle = (titleTexts || []).map((text) => (text || '').trim()).find((text) => text === 'Call Tuesday About Roster');

    if (titleText !== 'Get Naplan') {
      throw new Error(`Expected rendered reminders to include "Get Naplan", received: ${JSON.stringify(titleTexts)}`);
    }

    if (!/Tomorrow,\s*0?8:30(?:\s?AM)?/i.test(metaText || '')) {
      throw new Error(`Unexpected reminder meta values: ${JSON.stringify(metaTexts)}`);
    }

    if (unscheduledTitle !== 'Call Tuesday About Roster') {
      throw new Error(`Expected unscheduled reminder title to preserve weekday text, received: ${JSON.stringify(titleTexts)}`);
    }

    const persistedReminders = await page.evaluate((reminderStorageKey) => {
      try {
        return JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
      } catch {
        return [];
      }
    }, REMINDER_STORAGE_KEY);

    if (!Array.isArray(persistedReminders) || persistedReminders.length === 0) {
      throw new Error('No reminders were persisted to local storage.');
    }

    const persistedQuickAddReminder = persistedReminders.find((reminder) => {
      const title = typeof reminder?.title === 'string' ? reminder.title.trim().toLowerCase() : '';
      return title === 'get naplan';
    });
    const visibleQuickAddReminder = persistedReminders.find((reminder) => (
      reminder?.title === 'Call Mum'
    ));

    if (typeof persistedQuickAddReminder?.due !== 'string' || !persistedQuickAddReminder.due) {
      throw new Error(`Expected persisted reminder to include a due value, received: ${JSON.stringify(persistedReminders)}`);
    }

    if (typeof visibleQuickAddReminder?.due !== 'string' || !visibleQuickAddReminder.due) {
      throw new Error(`Expected the visible quick-add bar to save a dated reminder, received: ${JSON.stringify(persistedReminders)}`);
    }

    await page.locator('[data-title="Get Naplan"] [data-reminder-control="toggle"]').click();
    await page.locator('[data-action="clear-completed-reminders"]').waitFor({ state: 'visible' });
    const clearedDoneCount = Number(
      (await page.locator('.reminder-completed-section-count').textContent())?.trim(),
    );
    if (clearedDoneCount !== 1) {
      throw new Error(`Expected one completed reminder before clearing, received: ${clearedDoneCount}`);
    }
    const doneCleanupScreenshotOutput = typeof process.env.PLAYWRIGHT_DONE_CLEANUP_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_DONE_CLEANUP_SCREENSHOT_PATH.trim()
      : '';
    if (doneCleanupScreenshotOutput) {
      const doneCleanupScreenshotPath = path.resolve(cwd, doneCleanupScreenshotOutput);
      await fs.mkdir(path.dirname(doneCleanupScreenshotPath), { recursive: true });
      await page.locator('.reminder-completed-section').scrollIntoViewIfNeeded();
      await page.screenshot({ path: doneCleanupScreenshotPath, fullPage: true });
    }
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-action="clear-completed-reminders"]').click();
    await page.waitForFunction((reminderStorageKey) => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
        return Array.isArray(reminders) && reminders.every((reminder) => reminder?.done !== true);
      } catch {
        return false;
      }
    }, REMINDER_STORAGE_KEY);
    if (await page.locator('[data-action="clear-completed-reminders"]').count()) {
      throw new Error('Expected the completed-reminder section to disappear after clearing');
    }

    const inboxEntries = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem('memoryCueInbox') || '[]');
      } catch {
        return [];
      }
    });
    const mirroredInboxEntry = inboxEntries.find((entry) => {
      const text = typeof entry?.text === 'string' ? entry.text.trim().toLowerCase() : '';
      return text === 'add remider tomorrow at 8:30 am get naplan';
    });

    if (!mirroredInboxEntry || mirroredInboxEntry.entryPoint !== 'reminders.quickAddNow' || mirroredInboxEntry.source !== 'quick-add') {
      throw new Error(`Expected quick-add reminder to mirror into inbox, received: ${JSON.stringify(inboxEntries)}`);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.memoryCueQuickAddNow === 'function');
    await page.click('#mobile-footer-reminders');
    await page.waitForFunction(() => (
      document.querySelector('[data-reminder-column="school"] .reminder-category-column-title')?.textContent?.trim() === 'Work'
    ));
    const reloadedSchoolLabel = (
      await page.locator('[data-reminder-column="school"] .reminder-category-column-title').textContent()
    )?.trim();
    const reloadedSchoolColour = await page.locator('[data-reminder-column="school"] [data-action="change-column-colour"]').inputValue();
    if (reloadedSchoolColour !== '#dc2626') {
      throw new Error(`Expected Work column colour to persist after reload, received: ${reloadedSchoolColour}`);
    }
    const reloadedGeneralColour = await page.locator('[data-title="Call Tuesday About Roster"]').evaluate((card) => (
      card.style.getPropertyValue('--reminder-category-color')
    ));
    if (reloadedGeneralColour !== '#0d9488') {
      throw new Error(`Expected General category colour to persist after reload, received: ${reloadedGeneralColour}`);
    }

    const blockingErrors = logs.filter((entry) => {
      const text = entry.text || '';
      return (
        entry.type === 'pageerror'
        || /Failed to initialise reminders/i.test(text)
        || /Firestore reminders sync error/i.test(text)
        || /Cannot access .* before initialization/i.test(text)
      );
    });

    if (blockingErrors.length) {
      throw new Error(`Blocking browser errors detected:\n${JSON.stringify(blockingErrors, null, 2)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      checkedUrl: baseUrl,
      titleText,
      metaText,
      unscheduledTitle,
      persistedDue: persistedQuickAddReminder.due,
      visibleQuickAddCategory: visibleQuickAddReminder.category,
      boardColumnLabels,
      renamedSchoolLabel,
      reloadedSchoolLabel,
      schoolColumnColour,
      reloadedSchoolColour,
      generalCategoryColour,
      reloadedGeneralColour,
      persistedBoardLabels,
      movedCardCategory: persistedReminders.find((reminder) => reminder?.title === 'Call Mum')?.category,
      firstFootyCardTitle,
      addCardCategory,
      sheetCategoryState,
      tomorrowValue,
      overlapState,
      compactLayoutState,
      clearedDoneCount,
      mirroredInboxSource: mirroredInboxEntry.source,
      mirroredInboxEntryPoint: mirroredInboxEntry.entryPoint,
      blockingErrors,
    }, null, 2));

  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
