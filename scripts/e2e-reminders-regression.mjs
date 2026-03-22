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

async function startStaticServer(cwd) {
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === '/') {
        pathname = '/mobile.html';
      }

      const resolvedPath = path.resolve(cwd, `.${pathname}`);
      if (!resolvedPath.startsWith(cwd)) {
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
  const { server, baseUrl } = await startStaticServer(cwd);

  try {
    await waitForServer(baseUrl);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      timezoneId: 'Australia/Adelaide',
      serviceWorkers: 'block',
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
      localStorage.setItem(reminderStorageKey, JSON.stringify([]));
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

    const titleText = await page.locator('#view-reminders .reminder-row-title').first().textContent();
    const metaText = await page.locator('#view-reminders .reminder-row-meta').first().textContent();

    if ((titleText || '').trim() !== 'Get Naplan') {
      throw new Error(`Unexpected reminder title: ${titleText}`);
    }

    if (!/Tomorrow,\s*8:30\s?AM/i.test(metaText || '')) {
      throw new Error(`Unexpected reminder meta: ${metaText}`);
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

    if (typeof persistedReminders[0]?.due !== 'string' || !persistedReminders[0].due) {
      throw new Error(`Expected persisted reminder to include a due value, received: ${JSON.stringify(persistedReminders[0] || null)}`);
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
      titleText: (titleText || '').trim(),
      metaText: (metaText || '').trim(),
      persistedDue: persistedReminders[0].due,
      blockingErrors,
    }, null, 2));

    await browser.close();
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
