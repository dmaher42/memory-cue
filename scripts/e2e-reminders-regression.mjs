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

    await page.click('.reminders-fast-add-more > summary');
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

    const boardColumnLabels = await page.locator('.reminder-category-column-title').allTextContents();
    if (JSON.stringify(boardColumnLabels.map((label) => label.trim())) !== JSON.stringify(['School', 'Footy'])) {
      throw new Error(`Expected School and Footy board columns, received: ${JSON.stringify(boardColumnLabels)}`);
    }

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
      movedCardCategory: persistedReminders.find((reminder) => reminder?.title === 'Call Mum')?.category,
      firstFootyCardTitle,
      addCardCategory,
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
