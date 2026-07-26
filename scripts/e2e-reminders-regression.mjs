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
      const captureDue = new NativeDate(fixedNow);
      captureDue.setDate(captureDue.getDate() + 1);
      captureDue.setHours(8, 30, 0, 0);
      localStorage.setItem('memoryCueInbox', JSON.stringify([]));
      localStorage.setItem('memoryCueNotes', JSON.stringify([
        {
          id: 'capture-layout-note',
          title: 'Excursion permission form checklist',
          body: 'Confirm forms, medical details, and emergency contacts.',
          bodyHtml: 'Confirm forms, medical details, and emergency contacts.',
          bodyText: 'Confirm forms, medical details, and emergency contacts.',
          folderId: 'school',
          metadata: { source: 'chat' },
          createdAt: new NativeDate(fixedNow.getTime() - 100).toISOString(),
          updatedAt: new NativeDate(fixedNow.getTime() - 100).toISOString(),
        },
        {
          id: 'related-curriculum-map',
          title: 'Year 8 geography curriculum map',
          body: 'Sequence the landforms unit and achievement standards.',
          bodyHtml: 'Sequence the landforms unit and achievement standards.',
          bodyText: 'Sequence the landforms unit and achievement standards.',
          folderId: 'school',
          createdAt: new NativeDate(fixedNow.getTime() - 600000).toISOString(),
          updatedAt: new NativeDate(fixedNow.getTime() - 600000).toISOString(),
        },
        {
          id: 'related-lesson-notes',
          title: 'Previous lesson sequence notes',
          body: 'Source analysis prompts and the exit ticket.',
          bodyHtml: 'Source analysis prompts and the exit ticket.',
          bodyText: 'Source analysis prompts and the exit ticket.',
          folderId: 'school',
          createdAt: new NativeDate(fixedNow.getTime() - 900000).toISOString(),
          updatedAt: new NativeDate(fixedNow.getTime() - 900000).toISOString(),
        },
      ]));
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
        {
          id: 'capture-layout-reminder',
          title: 'Email the complete Year 8 geography lesson plan to everyone involved',
          category: 'School',
          source: 'capture',
          due: captureDue.toISOString(),
          createdAt: fixedNow.getTime() - 100,
          updatedAt: fixedNow.getTime() - 100,
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

    const captureHomeLayout = await page.evaluate(() => {
      const captureView = document.getElementById('view-capture');
      const conversation = document.getElementById('chatConversationContainer');
      const home = document.querySelector('.capture-home-shell');
      const captureLabels = Array.from(captureView?.querySelectorAll('h2, p') || [])
        .filter((element) => element.textContent?.trim() === 'Capture');
      const homeStyle = home ? getComputedStyle(home) : null;
      return {
        headingCount: captureLabels.length,
        conversationWidth: conversation?.getBoundingClientRect().width || 0,
        viewportWidth: window.innerWidth,
        homeHasBorder: homeStyle ? Number.parseFloat(homeStyle.borderTopWidth) > 0 : true,
        homeHasShadow: homeStyle ? homeStyle.boxShadow !== 'none' : true,
      };
    });
    if (
      captureHomeLayout.headingCount !== 1
      || captureHomeLayout.conversationWidth < captureHomeLayout.viewportWidth * 0.88
      || captureHomeLayout.homeHasBorder
      || captureHomeLayout.homeHasShadow
    ) {
      throw new Error(`Unexpected capture home layout: ${JSON.stringify(captureHomeLayout)}`);
    }

    await page.evaluate(() => {
      localStorage.setItem('memoryCueChatHistory', JSON.stringify([
        {
          id: 'capture-layout-user',
          role: 'user',
          content: 'Remind me tomorrow at 8:30 am to email the complete Year 8 geography lesson plan to everyone involved',
          timestamp: Date.now() - 1000,
        },
        {
          id: 'capture-layout-result',
          role: 'assistant',
          content: [
            'Reminder created.',
            '',
            'Related from your memory:',
            '- Year 8 geography curriculum map',
            '- Previous lesson sequence notes',
          ].join('\n'),
          relatedMemories: [
            { noteId: 'related-curriculum-map', label: 'Year 8 geography curriculum map' },
            { noteId: 'related-lesson-notes', label: 'Previous lesson sequence notes' },
          ],
          timestamp: Date.now(),
        },
      ]));
      document.dispatchEvent(new CustomEvent('memoryCue:chatUpdated'));
    });
    await page.waitForSelector('.chat-message--capture-result');
    const captureConversationLayout = await page.evaluate(() => {
      const conversation = document.getElementById('chatConversationContainer');
      const userMessage = document.querySelector('.chat-message--user');
      const resultMessage = document.querySelector('.chat-message--capture-result');
      const eyebrow = document.querySelector('.capture-result-eyebrow');
      const title = document.querySelector('.capture-result-title');
      const detail = document.querySelector('.capture-result-detail');
      const metadata = document.querySelector('.capture-result-meta');
      const timestamp = document.querySelector('.capture-result-time');
      const related = document.querySelector('.capture-result-related');
      const relatedSummary = document.querySelector('.capture-result-related-summary');
      const openAction = document.querySelector('[data-capture-action="open-reminder"]');
      const undoAction = document.querySelector('[data-capture-action="undo-reminder"]');
      return {
        conversationWidth: conversation?.getBoundingClientRect().width || 0,
        userWidth: userMessage?.getBoundingClientRect().width || 0,
        resultWidth: resultMessage?.getBoundingClientRect().width || 0,
        eyebrowFontSize: eyebrow ? Number.parseFloat(getComputedStyle(eyebrow).fontSize) : 0,
        titleFontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
        detailFontSize: detail ? Number.parseFloat(getComputedStyle(detail).fontSize) : 0,
        detailText: detail?.textContent || '',
        metadataText: metadata?.textContent || '',
        timestampText: timestamp?.textContent || '',
        relatedSummaryText: relatedSummary?.textContent || '',
        relatedOpen: related?.open ?? true,
        openActionText: openAction?.textContent || '',
        undoActionText: undoAction?.textContent || '',
        hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    if (
      captureConversationLayout.userWidth < captureConversationLayout.conversationWidth * 0.85
      || captureConversationLayout.resultWidth < captureConversationLayout.conversationWidth * 0.85
      || captureConversationLayout.eyebrowFontSize < 12
      || captureConversationLayout.titleFontSize < 16
      || captureConversationLayout.detailFontSize < 14
      || captureConversationLayout.detailText !== 'Email the complete Year 8 geography lesson plan to everyone involved'
      || !captureConversationLayout.metadataText.includes('Tomorrow, 8:30 am')
      || !captureConversationLayout.metadataText.includes('School')
      || captureConversationLayout.timestampText !== 'Just now'
      || captureConversationLayout.relatedSummaryText !== 'Related memories (2)'
      || captureConversationLayout.relatedOpen
      || captureConversationLayout.openActionText !== 'Open reminder'
      || captureConversationLayout.undoActionText !== 'Undo'
      || captureConversationLayout.hasHorizontalOverflow
    ) {
      throw new Error(`Unexpected capture conversation layout: ${JSON.stringify(captureConversationLayout)}`);
    }
    await page.click('[data-capture-action="open-reminder"]');
    await page.waitForFunction(() => {
      const sheet = document.getElementById('create-sheet');
      const title = document.getElementById('reminderText');
      return sheet && !sheet.classList.contains('hidden') && title?.value === 'Email the complete Year 8 geography lesson plan to everyone involved';
    });
    await page.click('#closeCreateSheet');
    await page.click('.capture-result-related-summary');
    const expandedRelatedState = await page.evaluate(() => ({
      open: document.querySelector('.capture-result-related')?.open ?? false,
      itemCount: document.querySelectorAll('.capture-result-related-item').length,
      linkLabels: Array.from(document.querySelectorAll('.capture-result-related-link'))
        .map((item) => item.textContent?.trim() || ''),
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    if (
      !expandedRelatedState.open
      || expandedRelatedState.itemCount !== 2
      || expandedRelatedState.linkLabels.join('|') !== 'Year 8 geography curriculum map|Previous lesson sequence notes'
      || expandedRelatedState.hasHorizontalOverflow
    ) {
      throw new Error(`Unexpected expanded related-memory state: ${JSON.stringify(expandedRelatedState)}`);
    }
    await page.click('[data-related-note-id="related-curriculum-map"]');
    await page.waitForFunction(() => {
      const notesView = document.getElementById('view-notebook');
      const title = document.getElementById('noteTitleMobile');
      return notesView
        && !notesView.classList.contains('hidden')
        && title?.value === 'Year 8 geography curriculum map';
    });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'capture' } }));
    });
    await page.waitForFunction(() => !document.getElementById('view-capture')?.classList.contains('hidden'));
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('memoryCue:chatUpdated'));
    });
    await page.waitForTimeout(100);
    await page.click('.capture-result-related-summary');
    await page.waitForTimeout(100);
    const narrowCaptureState = await page.evaluate(() => {
      const result = document.querySelector('.chat-message--capture-result')?.getBoundingClientRect();
      const composer = document.getElementById('thinkingBarContainer')?.getBoundingClientRect();
      const appContent = document.getElementById('main');
      return {
        relatedOpen: document.querySelector('.capture-result-related')?.open ?? false,
        resultBottom: result?.bottom || 0,
        composerTop: composer?.top || 0,
        mainScrollTop: appContent?.scrollTop || 0,
        mainScrollHeight: appContent?.scrollHeight || 0,
        mainClientHeight: appContent?.clientHeight || 0,
        hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    if (
      !narrowCaptureState.relatedOpen
      || narrowCaptureState.resultBottom > narrowCaptureState.composerTop
      || narrowCaptureState.hasHorizontalOverflow
    ) {
      throw new Error(`Capture result is obscured at 320px: ${JSON.stringify(narrowCaptureState)}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-capture-action="undo-reminder"]');
    await page.waitForFunction(() => document.querySelector('.capture-result-title')?.textContent === 'Reminder removed');
    const undoneCaptureState = await page.evaluate(() => {
      const reminders = JSON.parse(localStorage.getItem('memoryCue:offlineReminders') || '[]');
      const chatHistory = JSON.parse(localStorage.getItem('memoryCueChatHistory') || '[]');
      return {
        reminderStillExists: reminders.some((item) => item?.id === 'capture-layout-reminder'),
        resultContent: chatHistory.find((item) => item?.id === 'capture-layout-result')?.content || '',
        actionCount: document.querySelectorAll('.capture-result-action').length,
      };
    });
    if (
      undoneCaptureState.reminderStillExists
      || undoneCaptureState.resultContent !== 'Reminder creation undone: Email the complete Year 8 geography lesson plan to everyone involved.'
      || undoneCaptureState.actionCount !== 0
    ) {
      throw new Error(`Unexpected capture undo state: ${JSON.stringify(undoneCaptureState)}`);
    }

    await page.evaluate(() => {
      localStorage.setItem('memoryCueChatHistory', JSON.stringify([
        {
          id: 'capture-note-user',
          role: 'user',
          content: 'Save a note with my excursion permission form checklist',
          timestamp: Date.now() - 1000,
        },
        {
          id: 'capture-note-result',
          role: 'assistant',
          content: 'Saved note.',
          timestamp: Date.now(),
        },
      ]));
      document.dispatchEvent(new CustomEvent('memoryCue:chatUpdated'));
    });
    await page.waitForSelector('[data-capture-action="open-note"]');
    await page.waitForSelector('[data-capture-action="undo-note"]');
    const capturedNoteState = await page.evaluate(() => ({
      title: document.querySelector('.capture-result-title')?.textContent || '',
      detail: document.querySelector('.capture-result-detail')?.textContent || '',
      metadata: document.querySelector('.capture-result-meta')?.textContent || '',
      metadataLabel: document.querySelector('.capture-result-meta')?.getAttribute('aria-label') || '',
      openAction: document.querySelector('[data-capture-action="open-note"]')?.textContent || '',
      undoAction: document.querySelector('[data-capture-action="undo-note"]')?.textContent || '',
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    if (
      capturedNoteState.title !== 'Saved to notes'
      || capturedNoteState.detail !== 'Excursion permission form checklist'
      || capturedNoteState.metadata !== 'School'
      || capturedNoteState.metadataLabel !== 'Note details: School'
      || capturedNoteState.openAction !== 'Open note'
      || capturedNoteState.undoAction !== 'Undo'
      || capturedNoteState.hasHorizontalOverflow
    ) {
      throw new Error(`Unexpected captured note state: ${JSON.stringify(capturedNoteState)}`);
    }

    await page.click('[data-capture-action="open-note"]');
    await page.waitForFunction(() => {
      const notesView = document.getElementById('view-notebook');
      const title = document.getElementById('noteTitleMobile');
      return notesView && !notesView.classList.contains('hidden') && title?.value === 'Excursion permission form checklist';
    });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { view: 'capture' } }));
    });
    await page.waitForFunction(() => !document.getElementById('view-capture')?.classList.contains('hidden'));
    await page.click('[data-capture-action="undo-note"]');
    await page.waitForFunction(() => document.querySelector('.capture-result-title')?.textContent === 'Note removed');
    const undoneNoteState = await page.evaluate(() => {
      const notes = JSON.parse(localStorage.getItem('memoryCueNotes') || '[]');
      const chatHistory = JSON.parse(localStorage.getItem('memoryCueChatHistory') || '[]');
      return {
        noteStillExists: notes.some((item) => item?.id === 'capture-layout-note'),
        resultContent: chatHistory.find((item) => item?.id === 'capture-note-result')?.content || '',
        actionCount: document.querySelectorAll('.capture-result-action').length,
      };
    });
    if (
      undoneNoteState.noteStillExists
      || undoneNoteState.resultContent !== 'Note creation undone: Excursion permission form checklist.'
      || undoneNoteState.actionCount !== 0
    ) {
      throw new Error(`Unexpected captured note undo state: ${JSON.stringify(undoneNoteState)}`);
    }
    await page.evaluate(() => {
      localStorage.removeItem('memoryCueChatHistory');
      document.dispatchEvent(new CustomEvent('memoryCue:chatUpdated'));
    });

    await page.click('#mobile-footer-reminders');
    await page.waitForFunction(() => {
      const panel = document.getElementById('view-reminders');
      return panel && !panel.classList.contains('hidden');
    });

    if (await page.locator('#assistantHelpBtn').count()) {
      throw new Error('Expected the header question-mark button to be removed.');
    }
    const readabilityState = await page.evaluate(() => {
      const title = document.querySelector('.reminder-stream-row .reminder-row-title');
      const meta = document.querySelector('.reminder-stream-row .reminder-stream-meta');
      const header = document.getElementById('reminders-slim-header');
      const menuButton = document.getElementById('overflowMenuBtn');
      const universalComposer = document.getElementById('thinkingBarContainer');
      const titleStyle = title ? getComputedStyle(title) : null;
      const metaStyle = meta ? getComputedStyle(meta) : null;
      return {
        reminderQuickCaptureRemoved: !document.querySelector('.reminders-fast-capture'),
        universalComposerVisible: Boolean(
          universalComposer
          && getComputedStyle(universalComposer).display !== 'none'
          && universalComposer.getBoundingClientRect().height > 0
        ),
        titleFontSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : 0,
        metaFontSize: metaStyle ? Number.parseFloat(metaStyle.fontSize) : 0,
        headerHeight: header?.getBoundingClientRect().height || 0,
        menuButtonHeight: menuButton?.getBoundingClientRect().height || 0,
      };
    });
    if (
      !readabilityState.reminderQuickCaptureRemoved
      || !readabilityState.universalComposerVisible
      || readabilityState.titleFontSize < 13
      || readabilityState.metaFontSize < 10
      || readabilityState.headerHeight < 46
      || readabilityState.headerHeight > 50
      || readabilityState.menuButtonHeight > 37
    ) {
      throw new Error(`Unexpected reminder readability styles: ${JSON.stringify(readabilityState)}`);
    }

    const visibleTitleCount = await page.locator('.reminders-screen-title:visible').count();
    if (visibleTitleCount !== 0) {
      throw new Error('Expected the space-consuming Reminders title card to be removed.');
    }
    if (await page.locator('#quickAddForm').count()) {
      throw new Error('Expected the reminder-only quick-add bar to be removed.');
    }
    const universalCapturePlaceholder = await page.locator('#thinkingBarInput').getAttribute('placeholder');
    if (universalCapturePlaceholder !== 'Add a reminder, note, or ask…') {
      throw new Error(`Unexpected universal capture placeholder: ${universalCapturePlaceholder}`);
    }

    await page.fill('#thinkingBarInput', 'Remind me to Call Mum tomorrow at 6pm\n\n\n\n\n\n');
    const expandedCaptureHeight = await page.locator('#thinkingBarInput').evaluate((input) => input.getBoundingClientRect().height);
    if (expandedCaptureHeight < 80) {
      throw new Error(`Expected the multi-line capture field to expand before submit, received ${expandedCaptureHeight}px.`);
    }
    await page.click('#thinkingBarSubmit');
    await page.waitForFunction((reminderStorageKey) => {
      try {
        const reminders = JSON.parse(localStorage.getItem(reminderStorageKey) || '[]');
        return reminders.some((reminder) => reminder?.title === 'Call Mum');
      } catch {
        return false;
      }
    }, REMINDER_STORAGE_KEY);

    const clearedCaptureState = await page.locator('#thinkingBarInput').evaluate((input) => ({
      value: input.value,
      height: input.getBoundingClientRect().height,
    }));
    if (clearedCaptureState.value !== '' || clearedCaptureState.height > 60) {
      throw new Error(`Expected the capture field to clear and collapse after submit: ${JSON.stringify(clearedCaptureState)}`);
    }

    await page.locator('[data-reminder-column="other"] [data-title="Call Mum"] .reminder-stream-more').click();
    await page.locator('.reminder-card-actions-menu [data-action="move-to-school"]').click();
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
    const otherReminderHelpCount = await page.locator('.reminder-other-cards-help').count();
    if (renamedSchoolLabel !== 'Work' || persistedBoardLabels.school !== 'Work') {
      throw new Error(`Expected renamed School column to persist as Work, received: ${JSON.stringify({ renamedSchoolLabel, persistedBoardLabels })}`);
    }
    if (otherReminderHelpCount !== 0) {
      throw new Error(`Expected Other reminders to render without help text, found ${otherReminderHelpCount} helper elements.`);
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

    await page.evaluate(() => window.memoryCueQuickAddNow({
      forceText: 'Training tomorrow at 7pm',
      category: 'Footy',
      source: 'regression',
    }));
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
    const universalCaptureReminder = persistedReminders.find((reminder) => (
      reminder?.title === 'Call Mum'
    ));

    if (typeof persistedQuickAddReminder?.due !== 'string' || !persistedQuickAddReminder.due) {
      throw new Error(`Expected persisted reminder to include a due value, received: ${JSON.stringify(persistedReminders)}`);
    }

    if (typeof universalCaptureReminder?.due !== 'string' || !universalCaptureReminder.due) {
      throw new Error(`Expected the universal capture bar to save a dated reminder, received: ${JSON.stringify(persistedReminders)}`);
    }

    await page.locator('[data-title="Get Naplan"] [data-reminder-control="toggle"]').click();
    await page.waitForFunction(() => {
      const menuButton = document.getElementById('completedRemindersMenuBtn');
      const count = document.getElementById('completedRemindersMenuCount');
      return menuButton && !menuButton.hidden && count?.textContent?.trim() === '1';
    });
    if (await page.locator('.reminder-completed-section').count()) {
      throw new Error('Expected completed reminders to remain hidden from the active board.');
    }

    await page.locator('#overflowMenuBtn').click();
    const doneMenuScreenshotOutput = typeof process.env.PLAYWRIGHT_DONE_MENU_SCREENSHOT_PATH === 'string'
      ? process.env.PLAYWRIGHT_DONE_MENU_SCREENSHOT_PATH.trim()
      : '';
    if (doneMenuScreenshotOutput) {
      const doneMenuScreenshotPath = path.resolve(cwd, doneMenuScreenshotOutput);
      await fs.mkdir(path.dirname(doneMenuScreenshotPath), { recursive: true });
      await page.screenshot({ path: doneMenuScreenshotPath, fullPage: true });
    }
    await page.locator('#completedRemindersMenuBtn').click();
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
    if (!(await page.locator('#completedRemindersMenuBtn').isHidden())) {
      throw new Error('Expected the completed-reminder menu item to hide when no completed reminders remain');
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
      universalCaptureCategory: universalCaptureReminder.category,
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
