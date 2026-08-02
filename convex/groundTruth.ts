// Materialising the hidden ground-truth answer key into the database.
//
// data/groundTruth.ts is authored by character NAME (stable across wipes); the
// engine works in per-world GameIds ('p:7') that are reallocated on every
// wipe+init. This module bridges the two, and is the only writer of the
// groundTruthProfiles table.
//
// Seeding is idempotent and lazy on purpose. `npx convex run init` queues agent
// creation as engine *inputs*, so at the moment init runs there are no
// playerDescriptions to key against yet. Rather than guess at a delay, every
// consumer calls ensureGroundTruth first; it is a cheap no-op once the rows exist.

import { v } from 'convex/values';
import { internalMutation, mutation, MutationCtx } from './_generated/server';
import { Id } from './_generated/dataModel';
import { groundTruth } from '../data/groundTruth';

export async function seedGroundTruthProfiles(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
): Promise<{ inserted: number; updated: number; unknown: string[] }> {
  const descriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();

  let inserted = 0;
  let updated = 0;
  const unknown: string[] = [];

  for (const description of descriptions) {
    const profile = groundTruth[description.name];
    if (!profile) {
      // A human player, a debug player, or a character added to
      // data/characters.ts without a matching ground-truth entry. Not fatal —
      // the evaluator simply can't score them, and says so.
      unknown.push(description.name);
      continue;
    }
    const row = {
      worldId,
      playerId: description.playerId,
      name: description.name,
      culturalBackground: profile.culturalBackground,
      religion: profile.religion,
      hardTaboos: profile.hardTaboos,
      essentialNeeds: profile.essentialNeeds,
      preferences: profile.preferences,
      budgetLimit: profile.budgetLimit,
      communicationStyle: profile.communicationStyle,
    };
    const existing = await ctx.db
      .query('groundTruthProfiles')
      .withIndex('by_player', (q) => q.eq('worldId', worldId).eq('playerId', description.playerId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, row);
      updated++;
    } else {
      await ctx.db.insert('groundTruthProfiles', row);
      inserted++;
    }
  }
  return { inserted, updated, unknown };
}

// Called defensively before any read of the answer key. Returns immediately once
// the world has been seeded, so it is safe on a hot path.
export const ensureGroundTruth = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('groundTruthProfiles')
      .withIndex('by_world', (q) => q.eq('worldId', args.worldId))
      .first();
    if (existing) return { seeded: false as const };
    const result = await seedGroundTruthProfiles(ctx, args.worldId);
    console.log(
      `Seeded ground truth for world ${args.worldId}: ${result.inserted} profiles` +
        (result.unknown.length ? ` (no entry for: ${result.unknown.join(', ')})` : ''),
    );
    return { seeded: true as const, ...result };
  },
});

// Re-seed from data/groundTruth.ts, overwriting existing rows. Run this after
// editing the answer key:  npx convex run groundTruth:reseed
export const reseed = mutation({
  args: { worldId: v.optional(v.id('worlds')) },
  handler: async (ctx, args) => {
    let worldId = args.worldId;
    if (!worldId) {
      const worldStatus = await ctx.db
        .query('worldStatus')
        .filter((q) => q.eq(q.field('isDefault'), true))
        .unique();
      if (!worldStatus) throw new Error('No default world; run `npx convex run init` first.');
      worldId = worldStatus.worldId;
    }
    const result = await seedGroundTruthProfiles(ctx, worldId);
    console.log(
      `Ground truth reseeded: ${result.inserted} inserted, ${result.updated} updated` +
        (result.unknown.length ? `; no entry for: ${result.unknown.join(', ')}` : ''),
    );
    return result;
  },
});
