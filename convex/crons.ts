import { cronJobs } from 'convex/server';
import {
  DELETE_BATCH_SIZE,
  IDLE_WORLD_TIMEOUT,
  OBSERVATION_MAX_AGE_MS,
  VACUUM_MAX_AGE,
} from './constants';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { TableNames } from './_generated/dataModel';
import { v } from 'convex/values';

const crons = cronJobs();

crons.interval(
  'stop inactive worlds',
  { seconds: IDLE_WORLD_TIMEOUT / 1000 },
  internal.world.stopInactiveWorlds,
);

crons.interval('restart dead worlds', { seconds: 60 }, internal.world.restartDeadWorlds);

crons.daily('vacuum old entries', { hourUTC: 4, minuteUTC: 20 }, internal.crons.vacuumOldEntries);

export default crons;

const TablesToVacuum: TableNames[] = [
  // Un-comment this to also clean out old conversations.
  // 'conversationMembers', 'conversations', 'messages',

  // Inputs aren't useful unless you're trying to replay history.
  // If you want to support that, you should add a snapshot table, so you can
  // replay from a certain time period. Or stop vacuuming inputs and replay from
  // the beginning of time
  'inputs',

  // We can keep memories without their embeddings for inspection, but we won't
  // retrieve them when searching memories via vector search.
  'memories',
  // We can vacuum fewer tables without serious consequences, but the only
  // one that will cause issues over time is having >>100k vectors.
  'memoryEmbeddings',

  // Conflict/consequence log for the Tensions feed and inspector history; only
  // recent events are ever displayed, so old rows are safe to drop.
  'relationshipEvents',

  // Short-term gauge transitions. Higher volume than relationshipEvents (a few
  // per agent per game-day) and only useful to an offline evaluation run, so it
  // is safe on the same two-week window.
  'shortTermEvents',
];

// The perception stream is far higher volume than anything above and has a much
// shorter useful life: an observation feeds the reacting loop for minutes, and
// anything worth keeping was already promoted into `memories` with an embedding.
// So it gets its own aggressive sweep rather than the shared two-week window.
crons.interval(
  'vacuum observations',
  { seconds: 15 * 60 },
  internal.crons.vacuumObservations,
);

export const vacuumObservations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const before = Date.now() - OBSERVATION_MAX_AGE_MS;
    const stale = await ctx.db
      .query('observations')
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
      .take(DELETE_BATCH_SIZE);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    // Re-run immediately while there's still a backlog, so a busy world doesn't
    // accumulate faster than a single 15-minute batch can clear.
    if (stale.length === DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.crons.vacuumObservations, {});
    }
  },
});

export const vacuumOldEntries = internalMutation({
  args: {},
  handler: async (ctx, args) => {
    const before = Date.now() - VACUUM_MAX_AGE;
    for (const tableName of TablesToVacuum) {
      console.log(`Checking ${tableName}...`);
      const exists = await ctx.db
        .query(tableName)
        .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
        .first();
      if (exists) {
        console.log(`Vacuuming ${tableName}...`);
        await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
          tableName,
          before,
          cursor: null,
          soFar: 0,
        });
      }
    }
  },
});

export const vacuumTable = internalMutation({
  args: {
    tableName: v.string(),
    before: v.number(),
    cursor: v.union(v.string(), v.null()),
    soFar: v.number(),
  },
  handler: async (ctx, { tableName, before, cursor, soFar }) => {
    const results = await ctx.db
      .query(tableName as TableNames)
      .withIndex('by_creation_time', (q) => q.lt('_creationTime', before))
      .paginate({ cursor, numItems: DELETE_BATCH_SIZE });
    for (const row of results.page) {
      await ctx.db.delete(row._id);
    }
    if (!results.isDone) {
      await ctx.scheduler.runAfter(0, internal.crons.vacuumTable, {
        tableName,
        before,
        soFar: results.page.length + soFar,
        cursor: results.continueCursor,
      });
    } else {
      console.log(`Vacuumed ${soFar + results.page.length} entries from ${tableName}`);
    }
  },
});
