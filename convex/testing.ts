import { Id, TableNames } from './_generated/dataModel';
import { internal } from './_generated/api';
import * as mapData from '../data/city';
import {
  DatabaseReader,
  internalAction,
  internalMutation,
  mutation,
  query,
} from './_generated/server';
import { v } from 'convex/values';
import schema from './schema';
import { DELETE_BATCH_SIZE } from './constants';
import { kickEngine, startEngine, stopEngine } from './aiTown/main';
import { insertInput } from './aiTown/insertInput';
import { fetchEmbedding } from './util/llm';
import { chatCompletion } from './util/llm';
import { startConversationMessage } from './agent/conversation';
import { GameId } from './aiTown/ids';
import { point } from './util/types';

// Clear all of the tables except for the embeddings cache.
const excludedTables: Array<TableNames> = ['embeddingsCache'];

export const wipeAllTables = internalMutation({
  handler: async (ctx) => {
    for (const tableName of Object.keys(schema.tables)) {
      if (excludedTables.includes(tableName as TableNames)) {
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.testing.deletePage, { tableName, cursor: null });
    }
  },
});

export const deletePage = internalMutation({
  args: {
    tableName: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query(args.tableName as TableNames)
      .paginate({ cursor: args.cursor, numItems: DELETE_BATCH_SIZE });
    for (const row of results.page) {
      await ctx.db.delete(row._id);
    }
    if (!results.isDone) {
      await ctx.scheduler.runAfter(0, internal.testing.deletePage, {
        tableName: args.tableName,
        cursor: results.continueCursor,
      });
    }
  },
});

export const kick = internalMutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    await kickEngine(ctx, worldStatus.worldId);
  },
});

export const stopAllowed = query({
  handler: async () => {
    return !process.env.STOP_NOT_ALLOWED;
  },
});

export const stop = mutation({
  handler: async (ctx) => {
    if (process.env.STOP_NOT_ALLOWED) throw new Error('Stop not allowed');
    const { worldStatus, engine } = await getDefaultWorld(ctx.db);
    if (worldStatus.status === 'inactive' || worldStatus.status === 'stoppedByDeveloper') {
      if (engine.running) {
        throw new Error(`Engine ${engine._id} isn't stopped?`);
      }
      console.debug(`World ${worldStatus.worldId} is already inactive`);
      return;
    }
    console.log(`Stopping engine ${engine._id}...`);
    await ctx.db.patch(worldStatus._id, { status: 'stoppedByDeveloper' });
    await stopEngine(ctx, worldStatus.worldId);
  },
});

export const resume = mutation({
  handler: async (ctx) => {
    const { worldStatus, engine } = await getDefaultWorld(ctx.db);
    if (worldStatus.status === 'running') {
      if (!engine.running) {
        throw new Error(`Engine ${engine._id} isn't running?`);
      }
      console.debug(`World ${worldStatus.worldId} is already running`);
      return;
    }
    console.log(
      `Resuming engine ${engine._id} for world ${worldStatus.worldId} (state: ${worldStatus.status})...`,
    );
    await ctx.db.patch(worldStatus._id, { status: 'running' });
    await startEngine(ctx, worldStatus.worldId);
  },
});

export const archive = internalMutation({
  handler: async (ctx) => {
    const { worldStatus, engine } = await getDefaultWorld(ctx.db);
    if (engine.running) {
      throw new Error(`Engine ${engine._id} is still running!`);
    }
    console.log(`Archiving world ${worldStatus.worldId}...`);
    await ctx.db.patch(worldStatus._id, { isDefault: false });
  },
});

async function getDefaultWorld(db: DatabaseReader) {
  const worldStatus = await db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!worldStatus) {
    throw new Error('No default world found');
  }
  const engine = await db.get(worldStatus.engineId);
  if (!engine) {
    throw new Error(`Engine ${worldStatus.engineId} not found`);
  }
  return { worldStatus, engine };
}

export const debugCreatePlayers = internalMutation({
  args: {
    numPlayers: v.number(),
  },
  handler: async (ctx, args) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    for (let i = 0; i < args.numPlayers; i++) {
      const inputId = await insertInput(ctx, worldStatus.worldId, 'join', {
        name: `Robot${i}`,
        description: `This player is a robot.`,
        character: `f${1 + (i % 8)}`,
      });
    }
  },
});

export const randomPositions = internalMutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    const map = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .unique();
    if (!map) {
      throw new Error(`No map for world ${worldStatus.worldId}`);
    }
    const world = await ctx.db.get(worldStatus.worldId);
    if (!world) {
      throw new Error(`No world for world ${worldStatus.worldId}`);
    }
    for (const player of world.players) {
      await insertInput(ctx, world._id, 'moveTo', {
        playerId: player.id,
        destination: {
          x: 1 + Math.floor(Math.random() * (map.width - 2)),
          y: 1 + Math.floor(Math.random() * (map.height - 2)),
        },
      });
    }
  },
});

export const skipTime = mutation({
  args: { skipMs: v.number() },
  handler: async (ctx, { skipMs }) => {
    if (process.env.STOP_NOT_ALLOWED) throw new Error('Stop not allowed');
    const { worldStatus } = await getDefaultWorld(ctx.db);
    // Route through the engine input system so the change lands in the engine's
    // in-memory state and gets persisted on the next save (direct DB patches get
    // overwritten when the engine flushes its world diff).
    await insertInput(ctx, worldStatus.worldId, 'skipTime', { skipMs });
  },
});

export const movePlayerTo = mutation({
  args: {
    playerId: v.id('players'),
    destination: point,
  },
  handler: async (ctx, args) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    // Route through engine inputs so the move is persisted.
    await insertInput(ctx, worldStatus.worldId, 'moveTo', {
      playerId: args.playerId,
      destination: args.destination,
    });
  },
});

// Instantly snap a character (by display name) to a tile. Unlike movePlayerTo,
// which walks there via pathfinding, this teleports immediately. The destination
// must be a passable tile (the engine rejects blocked ones).
//   npx convex run testing:teleport '{"name":"Cedric","x":36,"y":20}'
export const teleport = mutation({
  args: { name: v.string(), x: v.number(), y: v.number() },
  handler: async (ctx, args) => {
    const { worldStatus, engine } = await getDefaultWorld(ctx.db);

    // Inputs are only drained while the engine is running. If it's paused, the
    // teleport would queue with no visible effect ("runs but does nothing").
    if (!engine.running || worldStatus.status !== 'running') {
      throw new Error(
        `World is not running (status: ${worldStatus.status}). Open the app at http://localhost:5173 ` +
          `or run "npx convex run testing:resume", then retry.`,
      );
    }

    // Resolve the character name -> internal player id.
    const descriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .collect();
    const match = descriptions.find(
      (d) => d.name.toLowerCase() === args.name.trim().toLowerCase(),
    );
    if (!match) {
      const names = descriptions.map((d) => d.name).join(', ');
      throw new Error(`No character named "${args.name}". Known: ${names}`);
    }

    // Pre-validate the destination against the map so a blocked or out-of-bounds
    // tile fails loudly HERE rather than erroring silently inside the engine
    // input (whose error is recorded as the input's return value, not surfaced
    // to the CLI). A tile is blocked if any object layer is non-(-1) there.
    const map = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .unique();
    if (!map) throw new Error(`No map for world ${worldStatus.worldId}`);
    const x = Math.floor(args.x);
    const y = Math.floor(args.y);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      throw new Error(`Tile (${x}, ${y}) is out of bounds (map is ${map.width}x${map.height}).`);
    }
    for (const layer of map.objectTiles) {
      if (layer[x][y] !== -1) {
        throw new Error(
          `Tile (${x}, ${y}) is blocked — it's inside a building/object. Pick a passable tile, ` +
            `e.g. a workplace standing tile like A*STAR 13,8, MBS 36,22, or the hawker centre 63,27.`,
        );
      }
    }

    await insertInput(ctx, worldStatus.worldId, 'teleportPlayer', {
      playerId: match.playerId,
      destination: { x, y },
    });
    // Nudge the engine so the queued teleport is processed promptly even if the
    // sim was idling (also revives a stalled loop after a wipe).
    await kickEngine(ctx, worldStatus.worldId);
  },
});

export const reinitMap = mutation({
  handler: async (ctx) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    const existing = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .unique();
    if (!existing) throw new Error('No map found for default world');
    await ctx.db.patch(existing._id, {
      width: (mapData as any).mapwidth,
      height: (mapData as any).mapheight,
      tileSetUrl: mapData.tilesetpath,
      tileSetDimX: mapData.tilesetpxw,
      tileSetDimY: mapData.tilesetpxh,
      tileDim: mapData.tiledim,
      bgTiles: mapData.bgtiles,
      objectTiles: (mapData as any).objmap ?? [],
      animatedSprites: (mapData as any).animatedsprites ?? [],
    });
    console.log(
      `Map reloaded from data/city.js — tileset: ${mapData.tilesetpath}, ` +
      `dims: ${mapData.tilesetpxw}x${mapData.tilesetpxh}, tileSize: ${mapData.tiledim}px`,
    );
  },
});

export const fixMapTilesetUrl = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    const { worldStatus } = await getDefaultWorld(ctx.db);
    const map = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldStatus.worldId))
      .unique();
    if (!map) throw new Error('No map found for default world');
    await ctx.db.patch(map._id, { tileSetUrl: url });
    console.log(`Updated tileSetUrl to: ${url}`);
  },
});

export const testEmbedding = internalAction({
  args: { input: v.string() },
  handler: async (_ctx, args) => {
    return await fetchEmbedding(args.input);
  },
});

export const testCompletion = internalAction({
  args: {},
  handler: async (ctx, args) => {
    return await chatCompletion({
      messages: [
        { content: 'You are helpful', role: 'system' },
        { content: 'Where is pizza?', role: 'user' },
      ],
    });
  },
});

export const testConvo = internalAction({
  args: {},
  handler: async (ctx, args) => {
    const a: any = (await startConversationMessage(
      ctx,
      'm1707m46wmefpejw1k50rqz7856qw3ew' as Id<'worlds'>,
      'c:115' as GameId<'conversations'>,
      'p:0' as GameId<'players'>,
      Date.now(),
    )) as any;
    return await a.readAll();
  },
});
