import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { conversationId, playerId } from './aiTown/ids';
import { affinityToward, isFamilyMember, type FamilyTie } from './aiTown/affinity';

export const listMessages = query({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', args.conversationId))
      .collect();
    const out = [];
    for (const message of messages) {
      const playerDescription = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', message.author))
        .first();
      if (!playerDescription) {
        throw new Error(`Invalid author ID: ${message.author}`);
      }
      out.push({
        ...message,
        authorName: playerDescription.name,
        authorCharacter: playerDescription.character,
      });
    }
    return out;
  },
});

export const listAllConversations = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const archived = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    archived.sort((a, b) => b.ended - a.ended);

    const playerDescs = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const nameMap = new Map(playerDescs.map((p) => [p.playerId, p.name]));
    const charMap = new Map(playerDescs.map((p) => [p.playerId, p.character]));

    return archived.map((conv) => ({
      ...conv,
      participantNames: conv.participants.map((p) => nameMap.get(p) ?? p),
      participantCharacters: conv.participants.map((p) => charMap.get(p) ?? null),
    }));
  },
});

export const exportAllConversations = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const archived = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    archived.sort((a, b) => b.ended - a.ended);

    const playerDescs = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const nameMap = new Map(playerDescs.map((p) => [p.playerId, p.name]));

    const result = [];
    for (const conv of archived) {
      const messages = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q) =>
          q.eq('worldId', args.worldId).eq('conversationId', conv.id),
        )
        .collect();

      result.push({
        id: conv.id,
        created: new Date(conv.created).toISOString(),
        ended: new Date(conv.ended).toISOString(),
        participants: conv.participants.map((p) => ({ id: p, name: nameMap.get(p) ?? p })),
        numMessages: conv.numMessages,
        messages: messages.map((m) => ({
          author: nameMap.get(m.author) ?? m.author,
          text: m.text,
          timestamp: new Date(m._creationTime).toISOString(),
        })),
      });
    }
    return result;
  },
});

export const conversationGraph = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const edges = await ctx.db
      .query('participatedTogether')
      .withIndex('edge', (q) => q.eq('worldId', args.worldId))
      .collect();

    const playerDescs = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const nameMap = new Map(playerDescs.map((p) => [p.playerId, p.name]));
    const charMap = new Map(playerDescs.map((p) => [p.playerId, p.character]));

    // Pull live affinity (mutable, directional 0–100) off the serialized agents,
    // and the immutable family ties off the agent descriptions, so the graph can
    // reflect how each pair actually feels — not just how often they talk.
    const world = await ctx.db.get(args.worldId);
    const agentDescs = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    const familyByAgent = new Map<string, FamilyTie[]>(
      agentDescs.map((d) => [d.agentId, d.family ?? []]),
    );
    // playerId -> { affinities they hold toward others, their authored family }.
    const affinityByPlayer = new Map<
      string,
      { affinities: Record<string, number>; family: FamilyTie[] }
    >();
    for (const agent of world?.agents ?? []) {
      affinityByPlayer.set(agent.playerId, {
        affinities: agent.affinities ?? {},
        family: familyByAgent.get(agent.id) ?? [],
      });
    }
    // Directional affinity `from` feels toward `to`, resolved through the same
    // family-aware default used by the engine and the inspector.
    const affinityFor = (from: string, to: string) => {
      const entry = affinityByPlayer.get(from);
      return affinityToward({
        affinities: entry?.affinities,
        otherPlayerId: to,
        family: entry?.family,
        otherName: nameMap.get(to),
      });
    };

    // `participatedTogether` stores a directed edge for each ordered pair, so we
    // canonicalize to an unordered pair and count distinct conversations.
    const pairs = new Map<
      string,
      { a: string; b: string; conversations: Set<string>; lastEnded: number }
    >();
    const nodeIds = new Set<string>();
    for (const edge of edges) {
      nodeIds.add(edge.player1);
      nodeIds.add(edge.player2);
      const [a, b] =
        edge.player1 < edge.player2 ? [edge.player1, edge.player2] : [edge.player2, edge.player1];
      const key = `${a}|${b}`;
      let entry = pairs.get(key);
      if (!entry) {
        entry = { a, b, conversations: new Set(), lastEnded: 0 };
        pairs.set(key, entry);
      }
      entry.conversations.add(edge.conversationId);
      entry.lastEnded = Math.max(entry.lastEnded, edge.ended);
    }

    const links = [...pairs.values()].map((p) => {
      const affinityAB = affinityFor(p.a, p.b);
      const affinityBA = affinityFor(p.b, p.a);
      return {
        source: p.a,
        target: p.b,
        count: p.conversations.size,
        lastEnded: p.lastEnded,
        // a -> b and b -> a can diverge (affinity is one-sided); `affinity` is the
        // mutual average the graph paints edges with.
        affinityAB,
        affinityBA,
        affinity: Math.round((affinityAB + affinityBA) / 2),
        family:
          isFamilyMember(affinityByPlayer.get(p.a)?.family, nameMap.get(p.b)) ||
          isFamilyMember(affinityByPlayer.get(p.b)?.family, nameMap.get(p.a)),
      };
    });

    const nodes = [...nodeIds].map((id) => {
      const myLinks = links.filter((l) => l.source === id || l.target === id);
      // Average affinity this agent *holds* toward the people they talk to — a
      // rough "warmth" read on the agent themselves.
      const outgoing = myLinks.map((l) => (l.source === id ? l.affinityAB : l.affinityBA));
      const avgAffinity =
        outgoing.length > 0
          ? Math.round(outgoing.reduce((sum, v) => sum + v, 0) / outgoing.length)
          : undefined;
      return {
        id,
        name: nameMap.get(id) ?? id,
        character: charMap.get(id) ?? null,
        conversations: myLinks.reduce((sum, l) => sum + l.count, 0),
        avgAffinity,
      };
    });
    nodes.sort((a, b) => b.conversations - a.conversations);

    return { nodes, links };
  },
});

export const writeMessage = mutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    playerId,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      messageUuid: args.messageUuid,
      text: args.text,
      worldId: args.worldId,
    });
    await insertInput(ctx, args.worldId, 'finishSendingMessage', {
      conversationId: args.conversationId,
      playerId: args.playerId,
      timestamp: Date.now(),
    });
  },
});
