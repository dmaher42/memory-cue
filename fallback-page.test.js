const fs = require('fs');
const path = require('path');

describe('invalid-address fallback', () => {
  const filePath = path.resolve(__dirname, '404.html');
  const html = fs.readFileSync(filePath, 'utf8');

  test('redirects invalid addresses to the mobile app with a manual link', () => {
    expect(html).toMatch(
      /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["']0;\s*url=\/mobile["']/i,
    );
    expect(html).toMatch(/<a\s+href=["']\/mobile["']>Open Memory Cue<\/a>/i);
  });

  test('does not recreate or load the retired desktop runtime', () => {
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/js\/(?:main|daily-log-view|router)\.js/i);
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(5000);
  });
});
