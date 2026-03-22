import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = process.env.PORT || '4173';
const BASE_URL = process.env.URL || `http://127.0.0.1:${PORT}/mobile.html`;
const REMINDER_STORAGE_KEY = 'memoryCue:offlineReminders';
const SERVER_BOOT_TIMEOUT_MS = 15000;

function startStaticServer(cwd) {
  const serveCliPath = path.resolve(cwd, 'node_modules/serve/build/main.js');
  const child = spawn(process.execPath, [serveCliPath, '-l', PORT, '.'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output = [];
  child.stdout.on('data', (chunk) => {
    output.push(chunk.toString());
  });
  child.stderr.on('data', (chunk) => {
    output.push(chunk.toString());
  });

  return {
    child,
    getOutput: () => output.join(''),
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
  const server = startStaticServer(cwd);

  try {
    await waitForServer(BASE_URL);

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

      const seededReminders = [
        {
          id: 'seed-reminder-1',
          title: 'add remider tomorrow at 8:30 am get naplan',
          category: 'Tasks',
          priority: 'Medium',
          done: false,
          createdAt: fixedNow.getTime(),
          updatedAt: fixedNow.getTime(),
        },
      ];

      localStorage.setItem(reminderStorageKey, JSON.stringify(seededReminders));
    }, { reminderStorageKey: REMINDER_STORAGE_KEY });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
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
      checkedUrl: BASE_URL,
      titleText: (titleText || '').trim(),
      metaText: (metaText || '').trim(),
      blockingErrors,
    }, null, 2));

    await browser.close();
  } finally {
    server.child.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
