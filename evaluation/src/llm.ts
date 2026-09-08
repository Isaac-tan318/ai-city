// The single path from this program to a language model.
//
// Everything the judges need goes through `judge()`: one prompt in, one
// zod-validated object out, or undefined. That is the same contract as
// convex/util/llmJson.ts — never throw, never return a half-valid object — and
// it exists for the same reason. A judge that throws halfway through a corpus
// loses the work already done; a judge that returns undefined costs one
// datapoint, which the metrics already model as an abstention.
//
// Two things are layered on top of the repo's chatCompletion:
//
//   Caching. Judgements are deterministic-ish and expensive. A hash of
//   (model, prompt) keys a file under evaluation/.cache, so re-running a report
//   after editing the report formatting costs nothing. Delete the folder, or
//   pass --no-cache, to force fresh judgements.
//
//   Concurrency. A corpus is hundreds of independent calls; issuing them one at
//   a time is needlessly slow, and issuing them all at once gets you rate
//   limited. A small fixed pool is the whole scheduler this needs.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { chatCompletion } from '../../convex/util/llm';
import { parseLLMJson } from '../../convex/util/llmJson';
import { repoRoot } from './env';

export type JudgeOptions = {
  cache: boolean;
  concurrency: number;
  dryRun: boolean;
  verbose: boolean;
  maxTokens: number;
};

export const DEFAULT_JUDGE_OPTIONS: JudgeOptions = {
  cache: true,
  concurrency: 4,
  dryRun: false,
  verbose: false,
  maxTokens: 1200,
};

export type JudgeStats = {
  calls: number;
  cacheHits: number;
  failures: number;
  ms: number;
};

export class Judge {
  readonly stats: JudgeStats = { calls: 0, cacheHits: 0, failures: 0, ms: 0 };
  private readonly cacheDir: string;
  private inFlight = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly opts: JudgeOptions) {
    this.cacheDir = path.join(repoRoot(), 'evaluation', '.cache');
    if (this.opts.cache) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  // Ask for one structured judgement. `context` is a short label that appears in
  // the log line when a response fails to validate, so a bad answer can be
  // traced to the call site — same convention as parseLLMJson's third argument.
  async ask<S extends z.ZodTypeAny>(
    context: string,
    prompt: string,
    schema: S,
  ): Promise<z.output<S> | undefined> {
    const key = this.cacheKey(prompt);
    if (this.opts.cache) {
      const hit = this.readCache(key);
      if (hit !== undefined) {
        this.stats.cacheHits++;
        return parseLLMJson(hit, schema, `${context} (cached)`);
      }
    }
    if (this.opts.dryRun) return undefined;

    const content = await this.withSlot(async () => {
      const started = Date.now();
      try {
        const result = await chatCompletion({
          messages: [{ role: 'user', content: prompt }],
          max_tokens: this.opts.maxTokens,
          // Judgements should be reproducible across runs of the same corpus.
          temperature: 0,
          response_format: { type: 'json_object' },
        });
        this.stats.calls++;
        this.stats.ms += Date.now() - started;
        return result.content;
      } catch (err) {
        this.stats.failures++;
        console.error(`[judge] ${context} failed: ${(err as Error).message}`);
        return undefined;
      }
    });
    if (content === undefined) return undefined;

    const parsed = parseLLMJson(content, schema, context);
    // Only cache what validated. Caching a malformed response would make the
    // failure permanent until someone thought to clear the cache.
    if (parsed !== undefined && this.opts.cache) this.writeCache(key, content);
    return parsed;
  }

  // Map over inputs with the pool, preserving order. Failures come back as
  // undefined rather than rejecting the whole batch.
  async all<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R | undefined>,
  ): Promise<(R | undefined)[]> {
    return Promise.all(items.map((item, i) => fn(item, i)));
  }

  summary(): string {
    const { calls, cacheHits, failures, ms } = this.stats;
    const avg = calls === 0 ? 0 : Math.round(ms / calls);
    return `${calls} LLM calls (${cacheHits} cached, ${failures} failed), ~${avg}ms each`;
  }

  private cacheKey(prompt: string): string {
    const model = process.env.LLM_MODEL ?? process.env.OPENAI_CHAT_MODEL ?? 'default';
    return crypto.createHash('sha256').update(`${model}\n${prompt}`).digest('hex').slice(0, 32);
  }

  private readCache(key: string): string | undefined {
    const file = path.join(this.cacheDir, `${key}.json`);
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  }

  private writeCache(key: string, content: string): void {
    try {
      fs.writeFileSync(path.join(this.cacheDir, `${key}.json`), content);
    } catch (err) {
      if (this.opts.verbose) console.error(`[judge] cache write failed: ${err}`);
    }
  }

  // A counting semaphore. Small enough to read in one sitting, which is the
  // right size for something whose only job is to not hammer the provider.
  private async withSlot<R>(fn: () => Promise<R>): Promise<R> {
    if (this.inFlight >= this.opts.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.inFlight++;
    try {
      return await fn();
    } finally {
      this.inFlight--;
      this.queue.shift()?.();
    }
  }
}

// convex/util/llm.ts logs the full request body and the full completion on every
// call — useful when tailing Convex logs, overwhelming when running hundreds of
// judgements in a terminal. Silence console.log for the duration unless the user
// asked for --verbose; console.error is deliberately left alone so real failures
// still surface.
export async function quiet<T>(verbose: boolean, fn: () => Promise<T>): Promise<T> {
  if (verbose) return fn();
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}
