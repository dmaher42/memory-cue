import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function cleanDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });
}

async function buildCss() {
  const cssOutput = path.join(distDir, 'styles.css');
  await run('npx', ['tailwindcss', '-i', 'src/input.css', '-o', cssOutput, '--minify']);

  const cssContent = await fs.readFile(cssOutput);
  const hash = crypto.createHash('sha256').update(cssContent).digest('hex').slice(0, 8);
  const hashedName = `styles-${hash}.css`;
  const hashedPath = path.join(assetsDir, hashedName);
  await fs.rename(cssOutput, hashedPath);
  return `./assets/${hashedName}`;
}

function buildEntryMap(metafile) {
  const map = new Map();
  for (const [outfile, output] of Object.entries(metafile.outputs)) {
    if (!output.entryPoint) continue;
    const entry = output.entryPoint.replace(/^\.\//, '');
    const htmlKey = `./${entry.replace(/\\/g, '/')}`;
    const relPath = path.relative(distDir, path.resolve(rootDir, outfile)).replace(/\\/g, '/');
    map.set(htmlKey, `./${relPath}`);
  }
  return map;
}

async function buildScripts() {
  const moduleEntries = {
    './app.js': 'app',
    './js/main.js': 'main',
    './js/config-supabase.js': 'config-supabase',
    './js/mobile-theme-toggle.js': 'mobile-theme-toggle',
    './mobile.js': 'mobile',
  };

  const legacyEntries = {
    './js/runtime-env-shim.js': 'runtime-env-shim',
    './js/update-footer-year.js': 'update-footer-year',
    './js/register-service-worker.js': 'register-service-worker',
  };

  const moduleResult = await build({
    entryPoints: Object.keys(moduleEntries),
    outdir: distDir,
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: true,
    sourcemap: false,
    target: ['esnext'],
    metafile: true,
    entryNames: 'assets/[name]-[hash]',
    chunkNames: 'assets/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    logLevel: 'info',
  });

  const legacyResult = await build({
    entryPoints: Object.keys(legacyEntries),
    outdir: distDir,
    bundle: true,
    splitting: false,
    format: 'iife',
    minify: true,
    sourcemap: false,
    target: ['es2017'],
    metafile: true,
    entryNames: 'assets/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    logLevel: 'info',
  });

  return new Map([
    ...buildEntryMap(moduleResult.metafile),
    ...buildEntryMap(legacyResult.metafile),
  ]);
}

async function copyStatic() {
  const filesToCopy = [
    'manifest.webmanifest',
    'service-worker.js',
    '404.html',
    'index.html',
    'mobile.html',
  ];

  for (const file of filesToCopy) {
    const source = path.join(rootDir, file);
    try {
      await fs.copyFile(source, path.join(distDir, file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const directories = ['icons', 'styles', 'css', 'memory'];
  for (const dir of directories) {
    const source = path.join(rootDir, dir);
    try {
      await fs.cp(source, path.join(distDir, dir), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function rewriteHtml(assetMap, cssPath) {
  const htmlFiles = ['index.html', '404.html', 'mobile.html'];
  for (const file of htmlFiles) {
    const targetPath = path.join(distDir, file);
    try {
      let html = await fs.readFile(targetPath, 'utf8');
      html = html.replace(/\.\/dist\/styles\.css/g, cssPath);
      for (const [original, hashed] of assetMap) {
        const pattern = new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        html = html.replace(pattern, hashed);
      }
      await fs.writeFile(targetPath, html);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function main() {
  await cleanDist();
  const cssPath = await buildCss();
  const assetMap = await buildScripts();
  await copyStatic();
  await rewriteHtml(assetMap, cssPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
