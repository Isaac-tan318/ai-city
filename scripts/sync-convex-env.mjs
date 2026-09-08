// Syncs API keys / LLM config between the local .env.keys file and the current Convex
// deployment's environment variables (`npx convex env ...`).
//
// Convex stores env vars on the deployment itself, so they don't transfer when you swap
// Convex accounts/projects. This script lets you keep a local backup and restore it in one
// shot instead of re-running `npx convex env set` for every key by hand.
//
//   node scripts/sync-convex-env.mjs pull [--prod]   # deployment -> .env.keys
//   node scripts/sync-convex-env.mjs push [--prod]   # .env.keys -> deployment
//
// Also available as `npm run env:pull` / `npm run env:push` (pass extra flags after `--`,
// e.g. `npm run env:push -- --prod`).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envKeysPath = path.join(__dirname, '..', '.env.keys');

const [, , modeArg, ...extraArgs] = process.argv;
const mode = modeArg;

if (mode !== 'push' && mode !== 'pull') {
  console.error('Usage: node scripts/sync-convex-env.mjs <push|pull> [-- extra convex flags]');
  process.exit(1);
}

function runConvex(args) {
  const result = spawnSync('npx', ['convex', ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`\`npx convex ${args.join(' ')}\` failed`);
  }
  return result.stdout ?? '';
}

// Parses simple KEY=value lines, skipping blanks and comments. Preserves nothing else -
// callers that need to keep comments (pull) merge into the existing file's key order.
function parseEnvLines(text) {
  const entries = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    entries.set(key, value);
  }
  return entries;
}

if (mode === 'push') {
  if (!existsSync(envKeysPath)) {
    console.error(`No .env.keys file found at ${envKeysPath}.`);
    console.error('Copy .env.keys.example to .env.keys and fill in your keys first.');
    process.exit(1);
  }
  const entries = parseEnvLines(readFileSync(envKeysPath, 'utf8'));
  if (entries.size === 0) {
    console.log('.env.keys has no KEY=value entries - nothing to push.');
    process.exit(0);
  }
  for (const [key, value] of entries) {
    if (!value) {
      console.log(`Skipping ${key} (blank in .env.keys)`);
      continue;
    }
    console.log(`Setting ${key} on the current Convex deployment...`);
    runConvex(['env', 'set', `${key}=${value}`, ...extraArgs]);
  }
  console.log(`Done. Pushed ${entries.size} variable(s) from .env.keys to Convex.`);
} else {
  const stdout = runConvex(['env', 'list', ...extraArgs]);
  const fetched = parseEnvLines(stdout);
  if (fetched.size === 0) {
    console.log('Convex deployment has no environment variables set - nothing to pull.');
    process.exit(0);
  }

  const existingText = existsSync(envKeysPath) ? readFileSync(envKeysPath, 'utf8') : '';
  const lines = existingText.split(/\r?\n/);
  const seen = new Set();

  const updatedLines = lines.map((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return rawLine;
    const eq = line.indexOf('=');
    if (eq === -1) return rawLine;
    const key = line.slice(0, eq).trim();
    if (fetched.has(key)) {
      seen.add(key);
      return `${key}=${fetched.get(key)}`;
    }
    return rawLine;
  });

  for (const [key, value] of fetched) {
    if (!seen.has(key)) {
      updatedLines.push(`${key}=${value}`);
    }
  }

  writeFileSync(envKeysPath, updatedLines.join('\n').replace(/\n{3,}/g, '\n\n'));
  console.log(`Done. Pulled ${fetched.size} variable(s) from Convex into .env.keys.`);
}
