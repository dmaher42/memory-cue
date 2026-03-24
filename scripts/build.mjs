import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const assetsDir = path.join(distDir, 'assets');
const runtimeEnvPath = path.join(distDir, 'js', 'runtime-env.js');

const CLIENT_RUNTIME_ENV_KEYS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const child = spawn(
      isWindows ? 'cmd.exe' : command,
      isWindows ? ['/d', '/s', '/c', command, ...args] : args,
      {
      stdio: 'inherit',
      shell: false,
      ...options,
      }
    );

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

async function readDotEnvFile(filePath) {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .reduce((env, line) => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
          return env;
        }

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        if (key && typeof env[key] === 'undefined') {
          env[key] = value;
        }

        return env;
      }, {});
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function resolveRuntimeEnv() {
  const [dotEnv, dotEnvLocal] = await Promise.all([
    readDotEnvFile(path.join(rootDir, '.env')),
    readDotEnvFile(path.join(rootDir, '.env.local')),
  ]);

  return CLIENT_RUNTIME_ENV_KEYS.reduce((env, key) => {
    const value = process.env[key] ?? dotEnvLocal[key] ?? dotEnv[key] ?? '';
    if (typeof value === 'string' && value.trim()) {
      env[key] = value.trim();
    }
    return env;
  }, {});
}

async function writeRuntimeEnvScript() {
  const runtimeEnv = await resolveRuntimeEnv();
  const script = `window.__ENV = {
  ...(window.__ENV && typeof window.__ENV === 'object' && !Array.isArray(window.__ENV) ? window.__ENV : {}),
  ${CLIENT_RUNTIME_ENV_KEYS.map((key) => {
    const value = runtimeEnv[key];
    return value ? `${JSON.stringify(key)}: ${JSON.stringify(value)},` : '';
  })
    .filter(Boolean)
    .join('\n  ')}
};

window.textureUrl =
  window.textureUrl ||
  ((filename) => {
    if (typeof filename !== 'string') {
      return '';
    }

    return filename;
  });
`;

  await fs.mkdir(path.dirname(runtimeEnvPath), { recursive: true });
  await fs.writeFile(runtimeEnvPath, script);
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
  const mobileEntry = './mobile.js';
  const appEntry = './app.js';

  let primaryEntry;
  try {
    await fs.access(path.join(rootDir, mobileEntry));
    primaryEntry = mobileEntry;
  } catch {
    try {
      await fs.access(path.join(rootDir, appEntry));
      primaryEntry = appEntry;
    } catch {
      throw new Error('No valid entry point found for Memory Cue build.');
    }
  }

  const moduleEntries = {
    './mobile.js': 'mobile',
    './js/init-env.js': 'init-env',
    './js/mobile-theme-toggle.js': 'mobile-theme-toggle',
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

  return buildEntryMap(moduleResult.metafile);
}

async function copyStatic() {
  const filesToCopy = [
    { source: 'manifest.webmanifest' },
    { source: 'service-worker.js' },
    { source: 'service-worker-v3.js' },
    { source: '404.html' },
    { source: 'index.html' },
    { source: 'mobile.html' },
    { source: 'mobile.css' },
  ];

  for (const file of filesToCopy) {
    const source = path.join(rootDir, file.source);
    const destination = path.join(distDir, file.destination ?? file.source);
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const directories = ['icons', 'styles', 'css', 'js', 'memory'];
  for (const dir of directories) {
    const source = path.join(rootDir, dir);
    try {
      await fs.cp(source, path.join(distDir, dir), { recursive: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function ensureRootHtml() {
  const rootIndexPath = path.join(distDir, 'index.html');
  const mobileShellPath = path.join(distDir, 'mobile.html');

  try {
    await fs.access(rootIndexPath);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  try {
    await fs.copyFile(mobileShellPath, rootIndexPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Build failed: no root HTML entry was generated. Expected dist/index.html or dist/mobile.html.');
    }
    throw error;
  }
}

async function rewriteHtml(assetMap, cssPath) {
  const htmlFiles = ['index.html', '404.html', 'mobile.html'];
  for (const file of htmlFiles) {
    const targetPath = path.join(distDir, file);
    try {
      let html = await fs.readFile(targetPath, 'utf8');
      html = html.replace(/\.\/styles\/tailwind\.css/g, cssPath);
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

async function validateBuildOutput() {
  const rootIndexPath = path.join(distDir, 'index.html');

  try {
    await fs.access(rootIndexPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Build failed: dist/index.html is required for the Cloudflare Pages root entry point.');
    }
    throw error;
  }
}

async function main() {
  await cleanDist();
  const cssPath = await buildCss();
  const assetMap = await buildScripts();
  await copyStatic();
  await writeRuntimeEnvScript();
  await ensureRootHtml();
  await rewriteHtml(assetMap, cssPath);
  await validateBuildOutput();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
