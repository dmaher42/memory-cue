import { existsSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const requiredPaths = [
  { path: 'mobile.js', type: 'file' },
  { path: 'mobile.html', type: 'file' },
  { path: 'service-worker.js', type: 'file' },
  { path: 'api', type: 'directory' },
];

const missing = requiredPaths.filter((entry) => !existsSync(path.join(rootDir, entry.path)));

if (missing.length > 0) {
  const details = missing
    .map((entry) => `- Missing ${entry.type}: ${entry.path}`)
    .join('\n');
  console.error(`Build verification failed:\n${details}`);
  process.exit(1);
}

console.log('Build verification passed.');
