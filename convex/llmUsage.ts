// Read/write side of the LLM call log. The write is a single internal mutation
// called from convex/util/llmTrack.ts; everything else here exists to serve the
// usage page: a rolled-up summary over a time window, and the individual calls
// inside it.
import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { DELETE_BATCH_SIZE } from './constants';
import { Doc } from './_generated/dataModel';

// Ceiling on how many rows a single summary or listing reads. Convex caps a
// query at 16k documents, and a busy town can log several calls a second, so a
// wide window has to be allowed to come back partial rather than fail outright —
// the summary says so via `truncated` and the page shows it.
const MAX_SCAN = 10000;
const MAX_ROWS = 500;
const DEFAULT_ROWS = 100;

const kindValidator = v.union(v.literal('chat'), v.literal('embedding'));

export const record = internalMutation({
  args: {
    at: v.number(),
    kind: kindValidator,
    operation: v.string(),
    model: v.string(),
    provider: v.string(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    estimated: v.boolean(),
    ms: v.number(),
    retries: v.number(),
    ok: v.boolean(),
    error: v.optional(v.string()),
    worldId: v.optional(v.id('worlds')),
    subject: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('llmCalls', args);
  },
});

type Row = Doc<'llmCalls'>;

type Bucket = {
  key: string;
  calls: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  ms: number;
};

function emptyBucket(key: string): Bucket {
  return {
    key,
    calls: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    ms: 0,
  };
}

function addTo(map: Map<string, Bucket>, key: string, row: Row) {
  const bucket = map.get(key) ?? emptyBucket(key);
  bucket.calls += 1;
  if (!row.ok) bucket.failed += 1;
  bucket.promptTokens += row.promptTokens;
  bucket.completionTokens += row.completionTokens;
  bucket.totalTokens += row.totalTokens;
  bucket.ms += row.ms;
  map.set(key, bucket);
}

function sorted(map: Map<string, Bucket>): Bucket[] {
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

// Everything the usage page's headline numbers and breakdown tables need for a
// single time window.
export const summary = query({
  args: {
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    operation: v.optional(v.string()),
    kind: v.optional(kindValidator),
    // Number of points in the returned time series.
    buckets: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const until = args.until ?? Date.now();
    const since = args.since ?? 0;
    // One extra row past the cap is how we detect that the window overflowed.
    const scanned = await ctx.db
      .query('llmCalls')
      .withIndex('by_at', (q) => q.gte('at', since).lte('at', until))
      .order('desc')
      .take(MAX_SCAN + 1);
    const truncated = scanned.length > MAX_SCAN;
    const rowsInWindow = truncated ? scanned.slice(0, MAX_SCAN) : scanned;
    const rows = rowsInWindow.filter(
      (r) =>
        (!args.operation || r.operation === args.operation) &&
        (!args.kind || r.kind === args.kind),
    );

    const totals = {
      calls: 0,
      failed: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      ms: 0,
      estimatedCalls: 0,
      retries: 0,
    };
    const byOperation = new Map<string, Bucket>();
    const byModel = new Map<string, Bucket>();
    const byKind = new Map<string, Bucket>();
    const bySubject = new Map<string, Bucket>();

    for (const row of rows) {
      totals.calls += 1;
      if (!row.ok) totals.failed += 1;
      if (row.estimated) totals.estimatedCalls += 1;
      totals.promptTokens += row.promptTokens;
      totals.completionTokens += row.completionTokens;
      totals.totalTokens += row.totalTokens;
      totals.ms += row.ms;
      totals.retries += row.retries;
      addTo(byOperation, row.operation, row);
      addTo(byModel, row.model, row);
      addTo(byKind, row.kind, row);
      if (row.subject) addTo(bySubject, row.subject, row);
    }

    // Time series across the displayed window. With "all time" there is no
    // meaningful left edge until we know the oldest row, so take it from the data.
    const oldest = rows.length > 0 ? rows[rows.length - 1].at : until;
    const seriesStart = since > 0 ? since : oldest;
    const bucketCount = Math.max(1, Math.min(args.buckets ?? 48, 240));
    const span = Math.max(1, until - seriesStart);
    const width = Math.ceil(span / bucketCount);
    const series = Array.from({ length: bucketCount }, (_, i) => ({
      t: seriesStart + i * width,
      calls: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
    }));
    for (const row of rows) {
      const i = Math.min(bucketCount - 1, Math.max(0, Math.floor((row.at - seriesStart) / width)));
      series[i].calls += 1;
      series[i].totalTokens += row.totalTokens;
      series[i].promptTokens += row.promptTokens;
      series[i].completionTokens += row.completionTokens;
    }

    return {
      since,
      until,
      seriesStart,
      bucketWidth: width,
      // True when the window held more calls than the scan cap: the numbers
      // describe the most recent MAX_SCAN calls in it, not the whole window.
      truncated,
      scanCap: MAX_SCAN,
      totals,
      byOperation: sorted(byOperation),
      byModel: sorted(byModel),
      byKind: sorted(byKind),
      bySubject: sorted(bySubject).slice(0, 30),
      series,
      // Every operation seen in the window, so the filter dropdown offers real
      // values rather than a hard-coded list that drifts from the call sites.
      operations: [...new Set(rowsInWindow.map((r) => r.operation))].sort(),
    };
  },
});

// The individual calls behind the summary, newest first.
export const calls = query({
  args: {
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    operation: v.optional(v.string()),
    kind: v.optional(kindValidator),
    onlyFailed: v.optional(v.boolean()),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const until = args.until ?? Date.now();
    const since = args.since ?? 0;
    const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_ROWS, MAX_ROWS));
    const needle = args.search?.trim().toLowerCase();
    const filtered = !!(args.operation || args.kind || args.onlyFailed || needle);
    // Unfiltered, the newest `limit` rows are the answer, so only read those.
    // Filtered, we have to look further back — bounded by the same scan cap.
    const cap = filtered ? MAX_SCAN : limit;
    const rows = await ctx.db
      .query('llmCalls')
      .withIndex('by_at', (q) => q.gte('at', since).lte('at', until))
      .order('desc')
      .take(cap);
    const matching = rows.filter(
      (r) =>
        (!args.operation || r.operation === args.operation) &&
        (!args.kind || r.kind === args.kind) &&
        (!args.onlyFailed || !r.ok) &&
        (!needle ||
          r.operation.toLowerCase().includes(needle) ||
          (r.subject ?? '').toLowerCase().includes(needle) ||
          r.model.toLowerCase().includes(needle)),
    );
    return {
      rows: matching.slice(0, limit),
      matched: matching.length,
      // The scan stopped at the cap, so older matches may exist beyond these.
      truncated: filtered && rows.length >= cap,
    };
  },
});

// Drops logged calls. `before` keeps anything newer; omitting it clears the log.
export const clear = mutation({
  args: { before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.llmUsage.clearBatch, {
      before: args.before ?? Date.now(),
      deleted: 0,
    });
  },
});

export const clearBatch = internalMutation({
  args: { before: v.number(), deleted: v.number() },
  handler: async (ctx, args) => {
    const stale = await ctx.db
      .query('llmCalls')
      .withIndex('by_at', (q) => q.lt('at', args.before))
      .take(DELETE_BATCH_SIZE);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    if (stale.length === DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.llmUsage.clearBatch, {
        before: args.before,
        deleted: args.deleted + stale.length,
      });
    } else {
      console.log(`Cleared ${args.deleted + stale.length} llmCalls rows`);
    }
  },
});
