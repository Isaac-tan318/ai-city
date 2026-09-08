import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { characters } from '../data/characters';
import { insertInput } from './aiTown/insertInput';
import {
  DEFAULT_NAME,
  ENGINE_ACTION_DURATION,
  IDLE_WORLD_TIMEOUT,
  PLAYER_MEMORIES_LIMIT,
  PLAYER_RELATIONSHIP_EVENTS_LIMIT,
  RECENT_RELATIONSHIP_EVENTS_LIMIT,
  WORLD_HEARTBEAT_INTERVAL,
} from './constants';
import { playerId } from './aiTown/ids';
import { kickEngine, startEngine, stopEngine } from './aiTown/main';
import { engineInsertInput } from './engine/abstractGame';

export const defaultWorldStatus = query({
  handler: async (ctx) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    return worldStatus;
  },
});

export const heartbeatWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .first();
    if (!worldStatus) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const now = Date.now();

    // Skip the update (and then potentially make the transaction readonly)
    // if it's been viewed sufficiently recently..
    if (!worldStatus.lastViewed || worldStatus.lastViewed < now - WORLD_HEARTBEAT_INTERVAL / 2) {
      await ctx.db.patch(worldStatus._id, {
        lastViewed: Math.max(worldStatus.lastViewed ?? now, now),
      });
    }

    // Restart inactive worlds, but leave worlds explicitly stopped by the developer alone.
    if (worldStatus.status === 'stoppedByDeveloper') {
      console.debug(`World ${worldStatus._id} is stopped by developer, not restarting.`);
    }
    if (worldStatus.status === 'inactive') {
      console.log(`Restarting inactive world ${worldStatus._id}...`);
      await ctx.db.patch(worldStatus._id, { status: 'running' });
      await startEngine(ctx, worldStatus.worldId);
    }
  },
});

// Stop a world the moment nobody is looking at it, rather than waiting out
// IDLE_WORLD_TIMEOUT and the cron behind it.
//
// This exists because a running world costs the same whether or not anyone is
// watching: the engine steps once per second forever, rewriting the whole world
// document and driving every agent's LLM calls. A browser tab left open behind
// other windows keeps heartbeating (background timer throttling floors out at
// about once a minute, which is exactly the heartbeat interval), so a forgotten
// tab can simulate for days. Killing the dev server does NOT help — the page
// talks straight to the Convex deployment, so an already-loaded tab keeps going.
//
// Safe to call spuriously: a world someone else is still watching gets restarted
// by their next heartbeat within WORLD_HEARTBEAT_INTERVAL, and a world the
// developer paused by hand is left alone.
export const releaseWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .first();
    if (!worldStatus) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    // Only ever stop a world that is actually running. In particular never touch
    // 'stoppedByDeveloper' — that's the explicit Pause, and clobbering it here
    // would let the next heartbeat resume something the developer switched off.
    if (worldStatus.status !== 'running') {
      return;
    }
    console.log(`Releasing unwatched world ${worldStatus._id}`);
    await ctx.db.patch(worldStatus._id, { status: 'inactive' });
    await stopEngine(ctx, worldStatus.worldId);
  },
});

export const stopInactiveWorlds = internalMutation({
  handler: async (ctx) => {
    const cutoff = Date.now() - IDLE_WORLD_TIMEOUT;
    const worlds = await ctx.db.query('worldStatus').collect();
    for (const worldStatus of worlds) {
      if (cutoff < worldStatus.lastViewed || worldStatus.status !== 'running') {
        continue;
      }
      console.log(`Stopping inactive world ${worldStatus._id}`);
      await ctx.db.patch(worldStatus._id, { status: 'inactive' });
      await stopEngine(ctx, worldStatus.worldId);
    }
  },
});

export const restartDeadWorlds = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Restart an engine if it hasn't run for 2x its action duration.
    const engineTimeout = now - ENGINE_ACTION_DURATION * 2;
    const worlds = await ctx.db.query('worldStatus').collect();
    for (const worldStatus of worlds) {
      if (worldStatus.status !== 'running') {
        continue;
      }
      const engine = await ctx.db.get(worldStatus.engineId);
      if (!engine) {
        throw new Error(`Invalid engine ID: ${worldStatus.engineId}`);
      }
      if (engine.currentTime && engine.currentTime < engineTimeout) {
        console.warn(`Restarting dead engine ${engine._id}...`);
        await kickEngine(ctx, worldStatus.worldId);
      }
    }
  },
});

export const userStatus = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    // const identity = await ctx.auth.getUserIdentity();
    // if (!identity) {
    //   return null;
    // }
    // return identity.tokenIdentifier;
    return DEFAULT_NAME;
  },
});

export const joinWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    // const identity = await ctx.auth.getUserIdentity();
    // if (!identity) {
    //   throw new ConvexError(`Not logged in`);
    // }
    // const name =
    //   identity.givenName || identity.nickname || (identity.email && identity.email.split('@')[0]);
    const name = DEFAULT_NAME;

    // if (!name) {
    //   throw new ConvexError(`Missing name on ${JSON.stringify(identity)}`);
    // }
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new ConvexError(`Invalid world ID: ${args.worldId}`);
    }
    // const { tokenIdentifier } = identity;
    return await insertInput(ctx, world._id, 'join', {
      name,
      character: characters[Math.floor(Math.random() * characters.length)].name,
      description: `${DEFAULT_NAME} is a human player`,
      // description: `${identity.givenName} is a human player`,
      tokenIdentifier: DEFAULT_NAME,
    });
  },
});

export const leaveWorld = mutation({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    // const identity = await ctx.auth.getUserIdentity();
    // if (!identity) {
    //   throw new Error(`Not logged in`);
    // }
    // const { tokenIdentifier } = identity;
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    // const existingPlayer = world.players.find((p) => p.human === tokenIdentifier);
    const existingPlayer = world.players.find((p) => p.human === DEFAULT_NAME);
    if (!existingPlayer) {
      return;
    }
    await insertInput(ctx, world._id, 'leave', {
      playerId: existingPlayer.id,
    });
  },
});

export const sendWorldInput = mutation({
  args: {
    engineId: v.id('engines'),
    name: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    // const identity = await ctx.auth.getUserIdentity();
    // if (!identity) {
    //   throw new Error(`Not logged in`);
    // }
    return await engineInsertInput(ctx, args.engineId, args.name as any, args.args);
  },
});

export const worldState = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`Invalid world ID: ${args.worldId}`);
    }
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', world._id))
      .unique();
    if (!worldStatus) {
      throw new Error(`Invalid world status ID: ${world._id}`);
    }
    const engine = await ctx.db.get(worldStatus.engineId);
    if (!engine) {
      throw new Error(`Invalid engine ID: ${worldStatus.engineId}`);
    }
    return { world, engine };
  },
});

export const gameDescriptions = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const agentDescriptions = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const worldMap = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .first();
    if (!worldMap) {
      throw new Error(`No map for world: ${args.worldId}`);
    }
    return { worldMap, playerDescriptions, agentDescriptions };
  },
});

export const previousConversation = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    // Walk the player's history in descending order, looking for a nonempty
    // conversation.
    const members = ctx.db
      .query('participatedTogether')
      .withIndex('playerHistory', (q) => q.eq('worldId', args.worldId).eq('player1', args.playerId))
      .order('desc');

    for await (const member of members) {
      const conversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('id', member.conversationId))
        .unique();
      if (!conversation) {
        throw new Error(`Invalid conversation ID: ${member.conversationId}`);
      }
      if (conversation.numMessages > 0) {
        return conversation;
      }
    }
    return null;
  },
});

// The newest relationship events (conflicts + consequences) for the Tensions
// feed; the client filters to a recency window and caps how many chips it shows.
export const recentRelationshipEvents = query({
  args: {
    worldId: v.id('worlds'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('relationshipEvents')
      .withIndex('world', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(RECENT_RELATIONSHIP_EVENTS_LIMIT);
  },
});

// A single agent's recent relationship events (newest first), for the
// inspector's per-relationship history in PlayerDetails.
export const relationshipEventsForPlayer = query({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('relationshipEvents')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actor', args.playerId))
      .order('desc')
      .take(PLAYER_RELATIONSHIP_EVENTS_LIMIT);
  },
});

// Everything one character remembers, newest first, for the agents popup's
// "more info" pane. The `memories` table is keyed by playerId alone (it carries
// no worldId), so this needs no world argument. `embeddingId` is dropped — it's
// a pointer into the vector table that the client has no use for, and shipping
// it would only widen the payload.
export const memoriesForPlayer = query({
  args: {
    playerId,
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .order('desc')
      .take(PLAYER_MEMORIES_LIMIT);
    return memories.map(({ embeddingId: _embeddingId, ...rest }) => rest);
  },
});

// The ground-truth scorecard for one decision scenario, for the scenario detail
// panel. Null until the evaluator has finished (a few seconds after the group
// commits) — the live deliberation state comes from the world doc instead.
export const evaluationForScenario = query({
  args: {
    worldId: v.id('worlds'),
    scenarioId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('evaluations')
      .withIndex('by_scenario', (q) =>
        q.eq('worldId', args.worldId).eq('scenarioId', args.scenarioId),
      )
      .order('desc')
      .first();
  },
});

// Every scored decision, newest first. Survives scenario teardown, so this is the
// durable record the analysis page reads.
export const recentEvaluations = query({
  args: {
    worldId: v.id('worlds'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('evaluations')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(Math.min(args.limit ?? 25, 100));
  },
});
