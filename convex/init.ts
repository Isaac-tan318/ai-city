import { v } from 'convex/values';
import { internal } from './_generated/api';
import { DatabaseReader, MutationCtx, mutation } from './_generated/server';
import { Descriptions } from '../data/characters';
import * as map from '../data/city';
import { insertInput } from './aiTown/insertInput';
import { Id } from './_generated/dataModel';
import { createEngine } from './aiTown/main';
import { ENGINE_ACTION_DURATION } from './constants';
import { detectMismatchedLLMProvider } from './util/llm';
import { seedGroundTruthProfiles } from './groundTruth';

const init = mutation({
  args: {
    // Cap on how many of the MISSING characters to create in this run. Left out,
    // `init` brings the world up to the full `Descriptions` roster; it is safe to
    // re-run, and a no-op once everyone is present.
    numAgents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    detectMismatchedLLMProvider();
    const { worldStatus, engine } = await getOrCreateDefaultWorld(ctx);
    if (worldStatus.status !== 'running') {
      console.warn(
        `Engine ${engine._id} is not active! Run "npx convex run testing:resume" to restart it.`,
      );
      return;
    }
    const missing = await missingDescriptionIndexes(ctx.db, worldStatus.worldId);
    const toCreate = args.numAgents !== undefined ? missing.slice(0, args.numAgents) : missing;
    for (const descriptionIndex of toCreate) {
      await insertInput(ctx, worldStatus.worldId, 'createAgent', { descriptionIndex });
    }
    if (toCreate.length > 0) {
      console.log(
        `Queued ${toCreate.length} agent(s): ${toCreate
          .map((i) => Descriptions[i].name)
          .join(', ')}`,
      );
    }
    // Seed the decision engine's hidden ground truth. Agents are created through
    // queued engine inputs, so on a fresh world there are no playerDescriptions
    // to key against yet and this is a no-op — it lands on the next `init` run,
    // and ensureGroundTruth covers the lazy path in the meantime.
    await seedGroundTruthProfiles(ctx, worldStatus.worldId);
  },
});
export default init;

async function getOrCreateDefaultWorld(ctx: MutationCtx) {
  const now = Date.now();

  let worldStatus = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .unique();
  if (worldStatus) {
    const engine = (await ctx.db.get(worldStatus.engineId))!;
    return { worldStatus, engine };
  }

  const engineId = await createEngine(ctx);
  const engine = (await ctx.db.get(engineId))!;
  const worldId = await ctx.db.insert('worlds', {
    nextId: 0,
    agents: [],
    conversations: [],
    players: [],
  });
  const worldStatusId = await ctx.db.insert('worldStatus', {
    engineId: engineId,
    isDefault: true,
    lastViewed: now,
    status: 'running',
    worldId: worldId,
  });
  worldStatus = (await ctx.db.get(worldStatusId))!;
  await ctx.db.insert('maps', {
    worldId,
    width: map.mapwidth,
    height: map.mapheight,
    tileSetUrl: map.tilesetpath,
    tileSetDimX: map.tilesetpxw,
    tileSetDimY: map.tilesetpxh,
    tileDim: map.tiledim,
    bgTiles: map.bgtiles,
    objectTiles: map.objmap,
    animatedSprites: map.animatedsprites,
  });
  await ctx.scheduler.runAfter(0, internal.aiTown.main.runStep, {
    worldId,
    generationNumber: engine.generationNumber,
    maxDuration: ENGINE_ACTION_DURATION,
  });
  return { worldStatus, engine };
}

// Which entries of `Descriptions` have no agent in this world yet, as indexes
// into that array.
//
// This used to be a yes/no `shouldCreateAgents`, which answered no the moment the
// world held a single agent. That made the roster size permanent: growing
// `Descriptions` did nothing to a world that already existed, and the only way to
// see the new characters was `wipeAllTables` — throwing away every memory,
// conversation, relationship and usage row to gain a few residents. Asking which
// ones are missing instead covers both cases with the same code: an empty world
// is missing all of them, and a world grown from 25 to 50 is missing exactly the
// 25 that were appended.
//
// Matched by NAME rather than by index, because the index is only a pointer into
// an array that has been appended to twice.
//
// This deliberately does NOT look at the input queue to see who is already on
// their way in. That table is written several times a second by a running
// engine, and a mutation that reads it loses the optimistic-concurrency race
// almost every time — which would hang `convex dev --run init --until-success`
// (i.e. `npm run dev`) against a busy world. Re-running `init` before the queue
// drains therefore queues some characters twice, and the `createAgent` handler
// in aiTown/agentInputs.ts is what makes that harmless.
async function missingDescriptionIndexes(
  db: DatabaseReader,
  worldId: Id<'worlds'>,
): Promise<number[]> {
  const world = await db.get(worldId);
  if (!world) {
    throw new Error(`Invalid world ID: ${worldId}`);
  }
  const playerDescriptions = await db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  // A description outlives the player it belonged to (they are archived, not
  // deleted), so only the ones still in the world count as present.
  const livePlayerIds = new Set(world.players.map((p) => p.id));
  const present = new Set(
    playerDescriptions.filter((d) => livePlayerIds.has(d.playerId)).map((d) => d.name),
  );
  return Descriptions.map((d, i) => [d, i] as const)
    .filter(([d]) => !present.has(d.name))
    .map(([, i]) => i);
}
