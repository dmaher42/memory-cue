import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:3000/mobile.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => logs.push({ type: 'pageerror', text: err.message }));

  console.log('Navigating to', URL);
  await page.goto(URL, { waitUntil: 'networkidle' });

  // Attempt to detect which header/button variant is present (original vs slim)
  let btnSelector = null;
  let menuSelector = null;
  try {
    const btn = await page.waitForSelector('#headerMenuBtn', { timeout: 2000, state: 'attached' }).catch(() => null);
    if (btn) {
      btnSelector = '#headerMenuBtn';
      menuSelector = '#headerMenu';
    } else {
      const btnSlim = await page.waitForSelector('#headerMenuBtnSlim', { timeout: 2000, state: 'attached' }).catch(() => null);
      if (btnSlim) {
        btnSelector = '#headerMenuBtnSlim';
        menuSelector = '#headerMenuSlim';
      }
    }

    if (!btnSelector || !menuSelector) {
      throw new Error('no header button/menu selectors found');
    }
  } catch (err) {
    console.error('Header selectors not found:', err.message);
    await page.screenshot({ path: 'e2e-header-error.png', fullPage: true });
    await browser.close();
    process.exit(2);
  }

  // Click overflow menu button
  console.log('Clicking', btnSelector);
  await page.click(btnSelector);
  await page.waitForTimeout(400);

  const menuVisible = await page.$eval(menuSelector, (el) => !el.classList.contains('hidden'));
  console.log('menuVisible:', menuVisible);

  // Click outside to close
  await page.click('body', { position: { x: 10, y: 10 } });
  await page.waitForTimeout(200);
  const menuVisibleAfter = await page.$eval(menuSelector, (el) => !el.classList.contains('hidden'));
  console.log('menuVisibleAfter:', menuVisibleAfter);

  // Click Open Notebook global button
  let savedOpen = null;
  try {
    await page.waitForSelector('#openSavedNotesGlobal', { timeout: 3000 });
    console.log('Waiting briefly to allow bindings to attach...');
    await page.waitForTimeout(800);
    // Wait for the saved-notes binder test flag that the app sets when it attaches
    try {
      await page.waitForFunction(() => !!window.__mcSavedNotesBinderAttached, { timeout: 5000 });
      console.log('saved-notes binder attached (window.__mcSavedNotesBinderAttached)');
    } catch (e) {
      console.log('saved-notes binder flag not observed after wait:', e && e.message ? e.message : e);
    }
    try {
      await page.waitForFunction(() => typeof window.showSavedNotesSheet === 'function', { timeout: 3000 });
      console.log('window.showSavedNotesSheet is available');
    } catch (e) {
      console.log('window.showSavedNotesSheet not available after wait:', e.message);
    }
    console.log('Clicking #openSavedNotesGlobal');
    await page.click('#openSavedNotesGlobal');
    await page.waitForTimeout(200);
    // If the inline/global function exists, also invoke it directly as a fallback
    const hasGlobalFn = await page.evaluate(() => typeof window.showSavedNotesSheet === 'function');
    console.log('window.showSavedNotesSheet exists:', hasGlobalFn);
    if (hasGlobalFn) {
      await page.evaluate(() => window.showSavedNotesSheet());
      await page.waitForTimeout(200);
    }
    savedOpen = await page.$eval('#savedNotesSheet', (el) => el.dataset.open === 'true');
    console.log('savedNotesSheet open:', savedOpen);
    // If the global header trigger didn't open the sheet, try fallback triggers
    if (!savedOpen) {
      try {
        const sheetBtn =
          (await page.$('#openSavedNotesSheetButton')) ||
          (await page.$('#openSavedNotesSheet'));
        if (sheetBtn) {
          console.log('Clicking fallback #openSavedNotesSheet');
          await sheetBtn.click();
          await page.waitForTimeout(200);
          savedOpen = await page.$eval('#savedNotesSheet', (el) => el.dataset.open === 'true');
          console.log('savedNotesSheet open after fallback sheetBtn:', savedOpen);
        }
      } catch (e) {
        console.log('Fallback #openSavedNotesSheet click failed:', e && e.message ? e.message : e);
      }
    }

    if (!savedOpen) {
      try {
        const shortcutBtn =
          (await page.$('#openSavedNotesSheetButton')) ||
          (await page.$('#savedNotesShortcut'));
        if (shortcutBtn) {
          console.log('Clicking fallback #savedNotesShortcut');
          await shortcutBtn.click();
          await page.waitForTimeout(200);
          savedOpen = await page.$eval('#savedNotesSheet', (el) => el.dataset.open === 'true');
          console.log('savedNotesSheet open after fallback shortcutBtn:', savedOpen);
        }
      } catch (e) {
        console.log('Fallback #savedNotesShortcut click failed:', e && e.message ? e.message : e);
      }
    }
    if (!savedOpen) {
      try {
        const globalAlt = await page.$('.open-saved-notes-global');
        if (globalAlt) {
          console.log('Clicking fallback .open-saved-notes-global');
          await globalAlt.click();
          await page.waitForTimeout(200);
          savedOpen = await page.$eval('#savedNotesSheet', (el) => el.dataset.open === 'true');
          console.log('savedNotesSheet open after fallback globalAlt:', savedOpen);
        }
      } catch (e) {
        console.log('Fallback .open-saved-notes-global click failed:', e && e.message ? e.message : e);
      }
    }
  } catch (err) {
    console.warn('openSavedNotesGlobal not found or click failed:', err.message);
  }

  // Save screenshot
  const screenshotPath = 'e2e-header-screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Saved screenshot to', screenshotPath);

  // Check Google Sign-in button wiring
  const signInInfo = { exists: false };
  try {
    const signInBtn = await page.$('#googleSignInBtn');
    signInInfo.exists = !!signInBtn;
    if (signInBtn) {
      signInInfo.wired = await page.evaluate(() => !!(document.getElementById('googleSignInBtn') && document.getElementById('googleSignInBtn')._mcAuthWired));
      signInInfo.supabasePresent = await page.evaluate(() => typeof window.supabase !== 'undefined');
      signInInfo.startSignInFlowPresent = await page.evaluate(() => typeof window.startSignInFlow === 'function');
      signInInfo.inlineTriggerPresent = await page.evaluate(() => typeof window.__mcTriggerSignIn === 'function');
      // Attempt to click the sign-in button and capture any console messages
      try {
        await page.click('#googleSignInBtn');
        await page.waitForTimeout(800);
        signInInfo.clicked = true;
        // check whether the inline trigger was invoked
        signInInfo.inlineTriggerInvoked = await page.evaluate(() => !!window.__mcTriggerSignInInvoked);
      } catch (err) {
        signInInfo.clicked = false;
        signInInfo.clickError = err.message;
      }
    }
  } catch (e) {
    signInInfo.error = String(e && e.message ? e.message : e);
  }

  await browser.close();

  console.log(JSON.stringify({ menuVisible, menuVisibleAfter, savedOpen, signInInfo, logs }, null, 2));
  process.exit(0);
})();
