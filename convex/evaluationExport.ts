// The admin export the evaluation program consumes.
//
// An internalQuery, not a public one, and deliberately so: it returns
// groundTruthProfiles — the answer key that convex/evaluator.ts is the only
// thing in the simulation allowed to read. A public query would put it one
// fetch away from the browser, where any agent-facing code could reach it.
// Internal means it is only callable through the Convex CLI's admin path:
//
//   npx convex run evaluationExport:bundle > evaluation/data/bundle.json
//   npx convex run evaluationExport:bundle '{"limit":20}'
//
// which is the same way convex/dryRun.ts is driven.
//
// What this adds over the public chat-history export (convex/messages.ts):
// scenarioId on every message, so a transcript joins to the decision it
// produced; the full candidate menu from deciderTraces, without which no
// aggregation rule has anything to re-rank; and the short-term transition log,
// without which Component 5 has nothing to score.
import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
import { Doc, Id } from './_generated/dataModel';

// Worlds get large. These caps keep a bundle inside the query read limit and are
// the reason `limit` is worth passing on a long-running world.
const DEFAULT_CONVERSATION_LIMIT = 200;
const DEFAULT_EVENT_LIMIT = 5000;

export const bundle = internalQuery({
  args: {
    worldId: v.optional(v.id('worlds')),
    // Most recent N conversations and decisions. Undefined uses the default cap.
    limit: v.optional(v.number()),
    // Only rows at or after this timestamp (ms). Useful for scoring one session.
    since: v.optional(v.number()),
  },
  // Explicit `any`: this query returns a deep composite shape, and an inferred
  // return type that transitively depends on the generated api makes the api
  // type graph circular — the same hazard called out in convex/evaluator.ts.
  handler: async (ctx, args): Promise<any> => {
    let worldId: Id<'worlds'> | undefined = args.worldId;
    if (!worldId) {
      const status = await ctx.db
        .query('worldStatus')
        .filter((q) => q.eq(q.field('isDefault'), true))
        .unique();
      if (!status) {
        throw new Error('No default world. Run `npx convex run init` first.');
      }
      worldId = status.worldId;
    }
    const since = args.since ?? 0;
    const limit = args.limit ?? DEFAULT_CONVERSATION_LIMIT;

    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId!))
      .collect();
    const nameByPlayer = new Map(playerDescriptions.map((p) => [p.playerId, p.name]));

    const groundTruthRows = await ctx.db
      .query('groundTruthProfiles')
      .withIndex('by_world', (q) => q.eq('worldId', worldId!))
      .collect();

    // --- conversations, with the scenario stamp the public export drops -------
    const archived = await ctx.db
      .query('archivedConversations')
      .withIndex('worldId', (q) => q.eq('worldId', worldId!))
      .collect();
    archived.sort((a, b) => b.ended - a.ended);
    const recent = archived.filter((c) => c.ended >= since).slice(0, limit);

    const conversations = [];
    for (const conversation of recent) {
      const messages = await ctx.db
        .query('messages')
        .withIndex('conversationId', (q) =>
          q.eq('worldId', worldId!).eq('conversationId', conversation.id),
        )
        .collect();
      conversations.push({
        id: conversation.id,
        created: new Date(conversation.created).toISOString(),
        ended: new Date(conversation.ended).toISOString(),
        participants: conversation.participants.map((p) => ({
          id: p,
          name: nameByPlayer.get(p) ?? p,
        })),
        numMessages: conversation.numMessages,
        scenarioIds: [
          ...new Set(messages.map((m) => m.scenarioId).filter((s): s is string => !!s)),
        ],
        messages: messages.map((m) => ({
          author: nameByPlayer.get(m.author) ?? m.author,
          text: m.text,
          timestamp: new Date(m._creationTime).toISOString(),
          scenarioId: m.scenarioId,
        })),
      });
    }

    // --- decisions: the evaluation joined to the menu it chose from ----------
    const evaluations = await ctx.db
      .query('evaluations')
      .withIndex('by_world', (q) => q.eq('worldId', worldId!))
      .order('desc')
      .collect();

    const decisions = [];
    for (const evaluation of evaluations.filter((e) => e.at >= since).slice(0, limit)) {
      const trace = await ctx.db
        .query('deciderTraces')
        .withIndex('by_scenario', (q) =>
          q.eq('worldId', worldId!).eq('scenarioId', evaluation.scenarioId),
        )
        .unique()
        .catch(() => null);
      decisions.push({
        scenarioId: evaluation.scenarioId,
        scenarioName: evaluation.scenarioName,
        focalPlayerId: evaluation.focalPlayerId,
        focalName: evaluation.focalName,
        selectedOptionId: evaluation.selectedOptionId,
        selectedOptionTitle: evaluation.selectedOptionTitle,
        aggregatedGroupUtility: evaluation.aggregatedGroupUtility,
        bestOptionId: evaluation.bestOptionId,
        bestOptionTitle: evaluation.bestOptionTitle,
        bestGroupUtility: evaluation.bestGroupUtility,
        regret: evaluation.regret,
        questionsAsked: evaluation.questionsAsked,
        forcedDecision: evaluation.forcedDecision,
        optionScores: evaluation.optionScores,
        agentScores: evaluation.agentScores.map((a) => ({
          playerId: a.playerId,
          name: a.name,
          hardTabooViolated: a.hardTabooViolated,
          violatedTaboo: a.violatedTaboo,
          reason: a.reason,
          totalIndividualUtility: a.totalIndividualUtility,
        })),
        at: evaluation.at,
        options: trace?.options ?? [],
        // The evaluations row keeps per-agent scores only for the option that
        // WON — the losing options survive as a group mean and nothing else.
        // So the aggregation comparison, which needs a utility vector per
        // option, can only see the winner here. Re-running the evaluator with
        // per-option utilities retained is what would fill this in; leaving it
        // empty is honest, and normalize.ts reports the component as skipped
        // rather than comparing the winner against itself.
        perOptionUtilities: [] as {
          optionId: string;
          utilities: { name: string; utility: number }[];
        }[],
      });
    }

    const perceivedKnowledge = await ctx.db
      .query('perceivedKnowledge')
      .withIndex('by_focal', (q) => q.eq('worldId', worldId!))
      .collect();

    // --- the short-term transition log ---------------------------------------
    const shortTermEvents = await ctx.db
      .query('shortTermEvents')
      .withIndex('world', (q) => q.eq('worldId', worldId!).gte('at', since))
      .order('desc')
      .take(args.limit ? args.limit * 50 : DEFAULT_EVENT_LIMIT);

    return {
      kind: 'ai-town-evaluation-bundle',
      world: { worldId, exportedAt: Date.now() },
      players: playerDescriptions.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        character: p.character,
      })),
      groundTruth: groundTruthRows.map((row: Doc<'groundTruthProfiles'>) => ({
        playerId: row.playerId,
        name: row.name,
        culturalBackground: row.culturalBackground,
        religion: row.religion,
        hardTaboos: row.hardTaboos,
        essentialNeeds: row.essentialNeeds,
        preferences: row.preferences,
        budgetLimit: row.budgetLimit,
        communicationStyle: row.communicationStyle,
      })),
      conversations,
      decisions,
      perceivedKnowledge: perceivedKnowledge.map((p) => ({
        focalPlayerId: p.focalPlayerId,
        targetPlayerId: p.targetPlayerId,
        knownTaboos: p.knownTaboos,
        knownPreferences: p.knownPreferences,
        uncertainties: p.uncertainties,
        confidenceScore: p.confidenceScore,
        updatedAt: p.updatedAt,
      })),
      // Oldest first: the evaluator walks each character's events in order to
      // work out which transitions crossed a scenario boundary.
      shortTermEvents: shortTermEvents
        .slice()
        .sort((a, b) => a.at - b.at)
        .map((e) => ({
          at: e.at,
          playerId: e.playerId,
          name: nameByPlayer.get(e.playerId) ?? e.playerId,
          component: e.component,
          delta: e.delta,
          valueBefore: e.valueBefore,
          valueAfter: e.valueAfter,
          cause: e.cause,
          reason: e.reason,
          conversationId: e.conversationId,
          scenarioId: e.scenarioId,
          goalMet: e.goalMet,
        })),
    };
  },
});
