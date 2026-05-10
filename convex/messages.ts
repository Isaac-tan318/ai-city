import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { conversationId, playerId } from './aiTown/ids';

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
      out.push({ ...message, authorName: playerDescription.name });
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

    return archived.map((conv) => ({
      ...conv,
      participantNames: conv.participants.map((p) => nameMap.get(p) ?? p),
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
