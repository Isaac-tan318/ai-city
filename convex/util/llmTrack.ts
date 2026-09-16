// Usage-recording wrappers around the raw provider calls in ./llm.ts.
//
// llm.ts is deliberately dependency-free (it is also imported from plain Node by
// the offline evaluation harness), so it cannot touch the database. These
// wrappers are the Convex-side layer: same arguments, plus the ActionCtx and a
// label saying what the call was for, and one `llmCalls` row per call.
//
// Recording is best-effort by design. A failed insert must never take down the
// agent loop that was only trying to think — so errors here are logged and
// swallowed, while errors from the provider call itself propagate unchanged.
import { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import {
  LLMUsage,
  chatCompletion,
  fetchEmbeddingBatch,
  getLLMConfig,
} from './llm';

export type LLMCallLabel = {
  // What this call is for, e.g. 'conversation.continue'. Dotted lowercase by
  // convention so the usage page groups read as a call tree.
  operation: string;
  worldId?: Id<'worlds'>;
  // Agent/player name or scenario the call was made on behalf of, when known.
  subject?: string;
};

type ChatBody = Parameters<typeof chatCompletion>[0];

async function record(
  ctx: ActionCtx,
  label: LLMCallLabel,
  fields: {
    kind: 'chat' | 'embedding';
    model: string;
    usage: LLMUsage | undefined;
    ms: number;
    retries: number;
    ok: boolean;
    error?: string;
  },
) {
  try {
    const usage = fields.usage;
    await ctx.runMutation(internal.llmUsage.record, {
      at: Date.now(),
      kind: fields.kind,
      operation: label.operation,
      model: fields.model,
      provider: providerName(),
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      estimated: usage?.estimated ?? true,
      ms: fields.ms,
      retries: fields.retries,
      ok: fields.ok,
      error: fields.error,
      worldId: label.worldId,
      subject: label.subject,
    });
  } catch (err) {
    console.error(`Failed to record LLM usage for ${label.operation}:`, err);
  }
}

function providerName(): string {
  try {
    return getLLMConfig().provider;
  } catch {
    return 'unknown';
  }
}

function configuredChatModel(): string {
  try {
    return getLLMConfig().chatModel;
  } catch {
    return 'unknown';
  }
}

// Drop-in replacement for `chatCompletion` that logs the call. Non-streaming
// only: a streamed response has no usage block to record, and nothing in the
// town streams today.
export async function trackedChatCompletion(
  ctx: ActionCtx,
  label: LLMCallLabel,
  body: Omit<ChatBody, 'stream'> & { stream?: false | null | undefined },
): Promise<{ content: string; retries: number; ms: number }> {
  const started = Date.now();
  try {
    const result = await chatCompletion(body);
    await record(ctx, label, {
      kind: 'chat',
      model: result.model,
      usage: result.usage,
      ms: result.ms,
      retries: result.retries,
      ok: true,
    });
    return { content: result.content, retries: result.retries, ms: result.ms };
  } catch (err) {
    await record(ctx, label, {
      kind: 'chat',
      model: body.model ?? configuredChatModel(),
      usage: undefined,
      ms: Date.now() - started,
      retries: 0,
      ok: false,
      error: String((err as Error)?.message ?? err).slice(0, 500),
    });
    throw err;
  }
}

// Drop-in replacement for `fetchEmbeddingBatch`. Only the calls that actually
// reach the provider pass through here — the embeddings cache short-circuits
// hits before this is ever called, which is the honest thing to count.
export async function trackedFetchEmbeddingBatch(
  ctx: ActionCtx,
  label: LLMCallLabel,
  texts: string[],
) {
  const started = Date.now();
  try {
    const result = await fetchEmbeddingBatch(texts);
    await record(ctx, label, {
      kind: 'embedding',
      model: result.model,
      usage: result.llmUsage,
      ms: result.ms,
      retries: result.retries,
      ok: true,
    });
    return result;
  } catch (err) {
    await record(ctx, label, {
      kind: 'embedding',
      model: embeddingModelName(),
      usage: undefined,
      ms: Date.now() - started,
      retries: 0,
      ok: false,
      error: String((err as Error)?.message ?? err).slice(0, 500),
    });
    throw err;
  }
}

function embeddingModelName(): string {
  try {
    return getLLMConfig().embeddingModel;
  } catch {
    return 'unknown';
  }
}

export async function trackedFetchEmbedding(
  ctx: ActionCtx,
  label: LLMCallLabel,
  text: string,
) {
  const { embeddings, ...stats } = await trackedFetchEmbeddingBatch(ctx, label, [text]);
  return { embedding: embeddings[0], ...stats };
}
