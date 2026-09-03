import { readFile } from 'node:fs/promises';

export async function loadCanonicalUrgency() {
  const sourceUrl = new URL(
    '../../../src/reminders/reminderUrgency.js',
    import.meta.url
  );
  const source = await readFile(sourceUrl, 'utf8');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import('data:text/javascript;base64,' + encoded);
}
