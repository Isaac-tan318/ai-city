// Interviews: asking a character a question without touching the simulation.
//
// Every other way of talking to this cast leaves a mark. A conversation on the
// map writes messages, gets remembered afterwards, moves affinity, tires the
// agent out and re-plans their day around it; even a memory *lookup* writes
// `lastAccess` back and reshuffles what that agent recalls next time. That is
// the right behaviour for the town, and the wrong behaviour for a person who
// just wants to ask Ratna what she thinks of her employer.
//
// So an interview is deliberately outside the world:
//   - it takes no engine input, so nothing is scheduled, moved or interrupted;
//   - it writes no messages, no memories and no conversation record;
//   - it reads memories straight off the table rather than through
//     `memory.searchMemories`, whose ranking mutation would touch `lastAccess`;
//   - the transcript lives in the browser and is passed back in on each turn, so
//     closing the panel is the end of it — the agent never knew it happened.
//
// The one thing it does write is the `llmCalls` usage row every model call in
// this repo records, which is accounting, not world state.
import { v } from 'convex/values';
import { action, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { playerId } from './aiTown/ids';
import { LLMMessage } from './util/llm';
import { trackedChatCompletion } from './util/llmTrack';
import { effectiveIdentity } from './aiTown/agentDescription';
import { FamilyTie, affinityLabel, affinityToward, familyRelation } from './aiTown/affinity';
import { buildShortTermSnapshot, shortTermSelfDescription } from './aiTown/shortTerm';
import { computeGameTime } from './aiTown/gameTime';
import { nearestLocation, workplaceFor } from '../data/cityLocations';
import { splitProfileConstraints } from './agent/profileConstraints';
import { INTERVIEW_HISTORY_TURNS, INTERVIEW_MEMORY_COUNT } from './constants';

// Everything the interview prompt needs about one character, in a single
// read-only round trip. No mutation runs anywhere on this path.
export const interviewContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    if (!agent) {
      // Only agents can be interviewed — the human player has their own mouth.
      throw new Error(`Player ${args.playerId} isn't an agent`);
    }
    const agentDescription = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
      .first();
    const name = playerDescription?.name ?? 'Someone';

    // Read straight off the table, newest first. `memory.searchMemories` would
    // give better-targeted recall, but it runs `rankAndTouchMemories`, and an
    // interview that quietly reorders what a character remembers next is exactly
    // the side effect this module exists to avoid.
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', args.playerId))
      .order('desc')
      .take(INTERVIEW_MEMORY_COUNT);

    // How they feel about the people they know, by name — family ties first,
    // then anyone they've formed an opinion about.
    const family: FamilyTie[] = agentDescription?.family ?? [];
    const affinities = agent.affinities ?? {};
    const people = new Map<string, { name: string; relation?: string; affinity: number }>();
    for (const tie of family) {
      people.set(tie.name, {
        name: tie.name,
        relation: tie.relation,
        affinity: affinityToward({ affinities, otherPlayerId: '', family, otherName: tie.name }),
      });
    }
    for (const [otherId, value] of Object.entries(affinities)) {
      const other = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', otherId as any))
        .first();
      if (!other || people.has(other.name)) continue;
      people.set(other.name, {
        name: other.name,
        relation: familyRelation(family, other.name),
        affinity: value,
      });
    }

    const step =
      agent.schedule && agent.currentStepIndex !== undefined
        ? agent.schedule[agent.currentStepIndex]
        : undefined;
    return {
      name,
      identity: effectiveIdentity(agentDescription) ?? `${name} is a resident of Singapore.`,
      profile: agentDescription?.profile,
      learnedTraits: agent.learnedTraits,
      health: agent.health === 'sick' ? ('sick' as const) : ('well' as const),
      shortTerm: agent.shortTerm,
      balance: agent.balance,
      position: player.position,
      activity:
        player.activity && player.activity.until > Date.now()
          ? player.activity.description
          : undefined,
      plan: step?.description,
      memories: memories.map((m) => m.description),
      people: [...people.values()],
      worldStartTime: world.worldStartTime,
    };
  },
});

type InterviewContext = Awaited<ReturnType<typeof interviewContext>>;

// The character's side of an interview: who they are, where they are, what they
// remember, and the rule that they answer as themselves and nobody else.
function interviewPrompt(subject: InterviewContext): string[] {
  const prompt: string[] = [
    `You are ${subject.name}, a resident of this Singapore neighbourhood. Someone has stopped you to ask you a few questions about yourself and your life here, and you are willing to talk to them.`,
    `Answer in the first person, in your own voice, entirely in character. Speak from your own experience and opinions — never describe yourself from the outside, never narrate stage directions, and never answer as anyone else.`,
    `About you: ${subject.identity}`,
  ];
  if (subject.profile && Object.keys(subject.profile).length > 0) {
    const { constraints, rest } = splitProfileConstraints(subject.profile);
    if (rest.length > 0) {
      prompt.push(
        [`Your background details:`, ...rest.map(([k, val]) => `  - ${k}: ${val}`)].join('\n'),
      );
    }
    if (constraints.length > 0) {
      prompt.push(
        [
          `Fixed facts about your life — these are not preferences you can trade away:`,
          ...constraints.map(([k, val]) => `  - ${k}: ${val}`),
        ].join('\n'),
      );
    }
  }
  if (subject.learnedTraits && subject.learnedTraits.length > 0) {
    prompt.push(
      [
        `Things you've come to realise about yourself over time:`,
        ...subject.learnedTraits.map((t) => `  - ${t}`),
      ].join('\n'),
    );
  }
  const work = workplaceFor(subject.name);
  if (work) {
    prompt.push(`You work at ${work.location.name} — ${work.activity}.`);
  }
  if (subject.worldStartTime !== undefined) {
    const gt = computeGameTime(Date.now(), subject.worldStartTime);
    prompt.push(
      `It is Day ${gt.dayNumber}, ${gt.timeStr} (${gt.isDay ? 'daytime' : 'nighttime'}).`,
    );
  }
  prompt.push(`You are at ${nearestLocation(subject.position).name}.`);
  if (subject.plan) prompt.push(`Your plan for right now: ${subject.plan}.`);
  if (subject.activity) prompt.push(`You are ${subject.activity} while you answer.`);
  if (subject.health === 'sick') {
    prompt.push(`You're unwell today — low on energy, and it shows in how you answer.`);
  }
  const selfState = shortTermSelfDescription(
    buildShortTermSnapshot({
      shortTerm: subject.shortTerm,
      balance: subject.balance,
      health: subject.health,
      now: Date.now(),
    }),
  );
  if (selfState) {
    prompt.push(`${selfState} Let it colour your tone without taking over the answer.`);
  }
  if (subject.people.length > 0) {
    prompt.push(
      [
        `The people you know, and how you feel about them:`,
        ...subject.people.map(
          (p) =>
            `  - ${p.name}${p.relation ? ` (your ${p.relation})` : ''}: you feel ${affinityLabel(
              p.affinity,
            )} toward them`,
        ),
      ].join('\n'),
    );
  }
  if (subject.memories.length > 0) {
    prompt.push(
      [
        `Things you remember, most recent first. Draw on them when they're relevant, in your own words:`,
        ...subject.memories.map((m) => `  - ${m}`),
      ].join('\n'),
    );
  }
  prompt.push(
    `If you genuinely wouldn't know something, say so rather than inventing it. If a question is too personal for how you're feeling, you may deflect — in character.`,
    `Keep answers conversational: two or three sentences unless the question really needs more.`,
  );
  return prompt;
}

// Ask one question and get one answer back. Stateless by design: `history` is
// the running transcript held by the browser, so the server keeps nothing and
// the character has no idea this ever happened.
export const ask = action({
  args: {
    worldId: v.id('worlds'),
    playerId,
    question: v.string(),
    history: v.array(
      v.object({
        // Who said this line: the person asking, or the character answering.
        role: v.union(v.literal('interviewer'), v.literal('subject')),
        text: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ answer: string }> => {
    const question = args.question.trim();
    if (!question) {
      throw new Error('Ask them something first.');
    }
    const subject: InterviewContext = await ctx.runQuery(internal.interview.interviewContext, {
      worldId: args.worldId,
      playerId: args.playerId,
    });
    const messages: LLMMessage[] = [
      { role: 'system', content: interviewPrompt(subject).join('\n') },
      // Only the tail of the transcript: an interview can run as long as someone
      // keeps typing, and the whole of it in every prompt would grow without
      // bound for no benefit.
      ...args.history.slice(-INTERVIEW_HISTORY_TURNS).map(
        (m): LLMMessage => ({
          role: m.role === 'interviewer' ? 'user' : 'assistant',
          content: m.text,
        }),
      ),
      { role: 'user', content: question },
    ];
    const { content } = await trackedChatCompletion(
      ctx,
      { operation: 'interview.ask', worldId: args.worldId, subject: subject.name },
      { messages, max_tokens: 400 },
    );
    // Models like to prefix the answer with the speaker's own name; strip it so
    // the panel doesn't read "Ratna: Ratna: ...".
    const answer = content.trim().replace(new RegExp(`^${subject.name}\\s*:\\s*`, 'i'), '');
    return { answer };
  },
});
