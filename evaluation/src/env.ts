// Environment for the standalone evaluator.
//
// The simulation itself never needs this file: every LLM call in convex/ runs
// inside a Convex action, where the provider variables live on the deployment.
// This program runs on your machine, so it loads the same variables from the
// local .env.keys that `npm run env:push` syncs upward — same key, same model,
// same provider — and then hands off to convex/util/llm.ts unchanged.
import { config as loadDotenv } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getLLMConfig } from '../../convex/util/llm';

// Walk up from the working directory to the directory holding package.json.
// The CLI is bundled into evaluation/.build/, so import.meta.url is not a
// reliable anchor; the repo root is.
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find the repo root (no package.json above ${process.cwd()}).`);
}

let loaded = false;

// Load .env.keys, then .env.local as a fallback. Existing process.env wins, so
// `LLM_MODEL=... npm run eval` still overrides the file for a one-off run.
export function loadEnv(): void {
  if (loaded) return;
  const root = repoRoot();
  for (const file of ['.env.keys', '.env.local']) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) loadDotenv({ path: full });
  }
  loaded = true;
}

export type ResolvedLLM = {
  provider: string;
  url: string;
  model: string;
  hasKey: boolean;
};

// Resolve the provider through the repo's own getLLMConfig so this program can
// never drift from what the simulation uses. Fails loudly and early: an
// evaluation that silently runs against a different model than the town did is
// worse than one that refuses to start.
export function resolveLLM(): ResolvedLLM {
  loadEnv();
  const config = getLLMConfig();
  if (!config.apiKey && config.provider !== 'ollama') {
    throw new Error(
      `No API key for provider '${config.provider}'. Fill in LLM_API_KEY (or OPENAI_API_KEY) ` +
        `in .env.keys — see .env.keys.example.`,
    );
  }
  return {
    provider: config.provider,
    url: config.url,
    model: config.chatModel,
    hasKey: !!config.apiKey,
  };
}

export function describeLLM(r: ResolvedLLM): string {
  return `${r.provider} · ${r.model} · ${r.url}`;
}
