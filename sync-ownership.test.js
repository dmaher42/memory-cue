const fs = require('fs');
const path = require('path');

test('calendar bridge is inactive until a real integration is rebuilt', () => {
  const root = __dirname;
  const mobileHtml = fs.readFileSync(path.join(root, 'mobile.html'), 'utf8');
  const mobileRuntime = fs.readFileSync(path.join(root, 'mobile.js'), 'utf8');
  const mobileShellUi = fs.readFileSync(path.join(root, 'src/ui/mobileShellUi.js'), 'utf8');
  const reminderController = fs.readFileSync(path.join(root, 'src/reminders/reminderController.js'), 'utf8');
  const reminderFormHandlers = fs.readFileSync(path.join(root, 'src/reminders/reminderFormHandlers.js'), 'utf8');
  const mobileSyncControls = fs.readFileSync(path.join(root, 'src/ui/mobileSyncControls.js'), 'utf8');

  expect(mobileHtml).not.toMatch(/Calendar bridge URL/);
  expect(mobileHtml).not.toMatch(/Sync Reminders to Calendar/);
  expect(mobileHtml).not.toMatch(/script\.google\.com\/macros/);
  expect(mobileHtml).not.toMatch(/data-menu-action="sync-all"/);

  expect(mobileSyncControls).not.toMatch(/syncUrl/);
  expect(mobileSyncControls).not.toMatch(/Apps Script/);
  expect(mobileSyncControls).not.toMatch(/Sync Reminders to Calendar/);

  expect(reminderController).not.toMatch(/syncAllBtn\?\.addEventListener\('click'/);
  expect(reminderController).not.toMatch(/saveSettings\?\.addEventListener\('click'/);
  expect(reminderController).not.toMatch(/testSync\?\.addEventListener\('click'/);
  expect(reminderController).not.toMatch(/tryCalendarSync/);
  expect(reminderController).not.toMatch(/localStorage\.getItem\('syncUrl'\)/);
  expect(reminderFormHandlers).not.toMatch(/tryCalendarSync/);

  expect(mobileRuntime).not.toMatch(/syncAllBtnSel/);
  expect(mobileRuntime).not.toMatch(/syncUrlInputSel/);
  expect(mobileRuntime).not.toMatch(/saveSettingsSel/);
  expect(mobileRuntime).not.toMatch(/testSyncSel/);
  expect(mobileShellUi).not.toMatch(/syncAll/);
  expect(mobileShellUi).not.toMatch(/sync-all/);
});
