import { existsSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');

const requiredPaths = [
  { path: path.join(distDir, 'index.html'), label: 'dist/index.html', type: 'file' },
  { path: path.join(distDir, 'mobile.html'), label: 'dist/mobile.html', type: 'file' },
  { path: path.join(distDir, 'service-worker-v3.js'), label: 'dist/service-worker-v3.js', type: 'file' },
  { path: path.join(rootDir, 'functions', 'api'), label: 'functions/api', type: 'directory' },
];

const missing = requiredPaths.filter((entry) => !existsSync(entry.path));

if (missing.length > 0) {
  const details = missing
    .map((entry) => `- Missing ${entry.type}: ${entry.label}`)
    .join('\n');
  console.error(`Build verification failed:\n${details}`);
  process.exit(1);
}

console.log('Build verification passed.');
