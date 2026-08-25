// The Focal agent: one participant who actually runs the group decision.
//
// On its turn it does not simply say the next plausible thing. It:
//   1. updates what it believes about everyone (convex/decider.ts),
//   2. estimates a group utility for each candidate option,
//   3. checks whether it is ALLOWED to commit yet (convex/scoring.ts), and
//   4. either asks one targeted person one clarifying question, or commits.
//
// Step 3 is the load-bearing one and it is deliberately not the LLM's decision.
// The model proposes an action, and we record what it proposed, but TypeScript
// decides — otherwise the stopping criteria are a description of what the model
// was asked to do rather than a constraint on what it does. To make that override
// cheap, the model is asked to draft BOTH branches every turn (a question and a
// decision line) and we use whichever one the criteria select. That costs a
// sentence, not an extra round trip.
//
// Budget: 2 LLM calls per focal turn (memory extraction + this one), the same as
// an ordinary agent turn, which spends one on the message and one on
// decideNextSpeaker. A focal turn skips decideNextSpeaker because an
// ASK_QUESTION already names who should answer.

import { v } from 'convex/values';
import { z } from 'zod';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import { ActionCtx, internalAction, internalQuery } from './_generated/server';
import {
  continueConversationMessage,
  decideNextSpeaker,
  previousMessages,
} from './agent/conversation';
import { agentId, conversationId, GameId, playerId } from './aiTown/ids';
import {
  FOCAL_DECIDE_MESSAGE_HEADROOM,
  FOCAL_FORCE_DECIDE_MS,
  MAX_FOCAL_QUESTIONS,
  SCENARIO_CONVO_MAX_MESSAGES,
} from './constants';
import { extractMemoriesFor, PerceivedKnowledgeRow } from './decider';
import {
  checkStoppingCriteria,
  describeBlockers,
  OptionEstimate,
  TopScoreSnapshot,
} from './scoring';
import { chatCompletion, LLMMessage } from './util/llm';
import { parseLLMJson } from './util/llmJson';

const selfInternal = internal.focal;

// --- Schema ------------------------------------------------------------------

// The spec's FocalActionSchema, with three deliberate changes:
//  - `action` is `suggestedAction`, because it is advisory (see the header).
//  - both branches are always drafted, so the override never needs a second call.
//  - taboo risk names the people at risk rather than being a bare boolean, which
//    is what lets the deliberation panel say WHO is blocking the decision.
export const FocalActionSchema = z.object({
  estimatedUtilityBreakdown: z
    .array(
      z.object({
        optionId: z.string(),
        estimatedScore: z.number(),
        tabooRisk: z.boolean().default(false),
        riskyForNames: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  suggestedAction: z.enum(['ASK_QUESTION', 'DECIDE']),
  questionTargetName: z.string().nullable().default(null),
  // Both dialogue branches are requested every turn so TypeScript can override
  // the model's choice without a second round trip — but models reliably fill in
  // only the branch they picked and leave the other empty. That is a reasonable
  // response, not a malformed one, so empty is allowed here and the caller
  // substitutes a deterministic line when it needs the branch that is missing.
  questionOutput: z.string().default(''),
  selectedOptionId: z.string().nullable().default(null),
  decisionOutput: z.string().default(''),
});
export type FocalAction = z.infer<typeof FocalActionSchema>;

// What a completed focal turn changes about the deliberation. Rides back through
// agentSendMessage -> agentFinishSendingMessage, the same path goalMet and
// coveredTopics already take.
export type FocalTurnResult = {
  estimates: OptionEstimate[];
  topScore?: TopScoreSnapshot;
  blockedBy: string[];
  askedQuestion: boolean;
  // Who the question went to, and how many new facts the Decider pulled from the
  // transcript this turn. Both feed the live cues drawn over the sprites.
  questionTargetId?: string;
  factsLearned?: number;
  resolvedOptionId?: string;
  forcedDecision?: boolean;
};

// --- Data loading -------------------------------------------------------------

export type FocalTurnData = {
  scenarioId: string;
  scenarioName: string;
  instruction: string;
  context: string;
  completionGoal: string;
  conflict?: string;
  endTime: number;
  options: { optionId: string; title: string; details: string }[];
  previousEstimates: { optionId: string; estimatedScore: number }[];
  topScoreHistory: TopScoreSnapshot[];
  questionsAsked: number;
  participants: { playerId: string; name: string; present: boolean }[];
  selfName: string;
  numMessages: number;
  // True when this deliberation is happening in a group text rather than face to
  // face. The focal agent's two lines (their question and their commitment) go
  // through this prompt rather than the ordinary dialogue one, so without this
  // they come out formal and spoken in the middle of a phone thread.
  isText: boolean;
};

export const loadFocalTurnData = internalQuery({
  args: {
    worldId: v.id('worlds'),
    scenarioId: v.string(),
    conversationId,
    playerId,
  },
  handler: async (ctx, args): Promise<FocalTurnData | null> => {
    const world = await ctx.db.get(args.worldId);
    if (!world) return null;
    const sc = (world.activeScenarios ?? []).find((s) => s.id === args.scenarioId);
    if (!sc?.deliberation) return null;
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    if (!conversation) return null;

    // Only people actually in the room can be asked a question.
    const present = new Set(
      conversation.participants
        .filter((p) => p.status.kind === 'participating')
        .map((p) => p.playerId),
    );
    const participants = sc.participantIds.map((pid, i) => ({
      playerId: pid,
      name: sc.participantNames[i] ?? 'Someone',
      present: present.has(pid),
    }));
    return {
      scenarioId: sc.id,
      scenarioName: sc.name,
      instruction: sc.instruction,
      context: sc.context,
      completionGoal: sc.completionGoal ?? sc.goals,
      conflict: sc.conflict,
      endTime: sc.endTime,
      options: sc.deliberation.options,
      previousEstimates: sc.deliberation.estimates ?? [],
      topScoreHistory: sc.deliberation.topScoreHistory ?? [],
      questionsAsked: sc.deliberation.questionsAsked ?? 0,
      participants,
      selfName: participants.find((p) => p.playerId === args.playerId)?.name ?? 'Someone',
      numMessages: conversation.numMessages,
      isText: !!conversation.isText,
    };
  },
});

// --- The focal reasoning call --------------------------------------------------

export async function focalDecision(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  convId: GameId<'conversations'> | undefined,
  data: FocalTurnData,
  knowledge: PerceivedKnowledgeRow[],
): Promise<FocalAction | undefined> {
  const optionLines = data.options.map((o) => ` - ${o.optionId} "${o.title}": ${o.details}`);
  const knowledgeLines = knowledge.map((row) => {
    const parts = [
      `constraints you know of: ${row.knownTaboos.join('; ') || 'none'}`,
      `what they seem to want: ${row.knownPreferences.join('; ') || 'nothing yet'}`,
      `still unclear: ${row.uncertainties.join('; ') || 'nothing flagged'}`,
      `your confidence: ${Math.round(row.confidenceScore * 100)}%`,
    ];
    return ` - ${row.targetName} — ${parts.join(' | ')}`;
  });
  const previousEstimates = data.previousEstimates
    .map((e) => `${e.optionId}=${e.estimatedScore}`)
    .join(', ');
  const askableNames = data.participants
    .filter((p) => p.present && p.name !== data.selfName)
    .map((p) => p.name);

  const prompt = [
    `You are ${data.selfName}. You are the one trying to get this group to actually land on a decision.`,
    data.isText
      ? `This is a GROUP TEXT on your phone, not a face-to-face conversation — everyone is off doing their own thing. Both lines you draft below must read like texts: short, casual, lowercase is fine, no stage directions or descriptions of the room.`
      : ``,
    `Scenario: ${data.scenarioName} — ${data.instruction}`,
    `Situation: ${data.context}`,
    `What counts as done: ${data.completionGoal}`,
    data.conflict ? `Where people disagree: ${data.conflict}` : ``,
    ``,
    `The options on the table:`,
    ...optionLines,
    ``,
    `What you currently believe about the others (this is YOUR picture, and it may be wrong or incomplete):`,
    ...(knowledgeLines.length ? knowledgeLines : [' - you know nothing about anyone yet']),
    previousEstimates ? `` : ``,
    previousEstimates ? `Your estimates last turn: ${previousEstimates}` : ``,
    ``,
    `Score EVERY ONE of the ${data.options.length} options above out of 100 — all ${data.options.length} must appear in "estimatedUtilityBreakdown" — for how well each serves the WHOLE group, using what you know:`,
    `  35% whether it meets everyone's essential practical needs`,
    `  20% how well it matches what people actually want`,
    `  15% cost and time burden`,
    `  15% fairness — nobody carrying more of the cost or hassle than the rest`,
    `  10% social comfort`,
    `   5% effect on how people get on afterwards`,
    `Anyone you suspect has an absolute constraint against an option — a religious rule, an allergy or medical limit, a legal issue — makes that option worthless to them. Flag it with "tabooRisk": true and name them in "riskyForNames". Do NOT flag mere dislikes or preferences.`,
    ``,
    `Now draft BOTH of the following. Fill in BOTH, even the one you would not choose — whether the group is actually allowed to commit yet is decided separately, so an empty field wastes the turn:`,
    `1. "questionOutput" — one short, natural line of dialogue asking ONE person the single question that would most change your scoring. Name them in "questionTargetName" (one of: ${
      askableNames.join(', ') || 'nobody available'
    }). Ask about what they need or can't do, not about your scoring. Never mention scores, option ids, or that you are evaluating anyone.`,
    `2. "decisionOutput" — one short, natural line committing the group to the option with your HIGHEST estimatedScore, said the way ${data.selfName} would say it. Put that option's id in "selectedOptionId".`,
    `Then say in "suggestedAction" which of the two you would choose.`,
    `Both lines must sound like real speech in a casual conversation, under 200 characters, with no stage directions.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"estimatedUtilityBreakdown":[{"optionId":"opt1","estimatedScore":0,"tabooRisk":false,"riskyForNames":[]}],"suggestedAction":"ASK_QUESTION","questionTargetName":null,"questionOutput":"...","selectedOptionId":null,"decisionOutput":"..."}`,
  ]
    .filter(Boolean)
    .join('\n');

  const llmMessages: LLMMessage[] = [{ role: 'system', content: prompt }];
  if (convId) {
    llmMessages.push(...(await previousMessages(ctx, worldId, convId)));
  }

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 900,
    response_format: { type: 'json_object' },
  });
  return parseLLMJson(content, FocalActionSchema, `focalDecision/${data.scenarioName}`);
}

// --- Turn logic (pure enough to be driven by the dry run) ----------------------

export type FocalTurnOutcome = {
  text?: string;
  nextSpeaker?: string;
  goalMet: boolean;
  focal?: FocalTurnResult;
};

export async function takeFocalTurn(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  convId: GameId<'conversations'> | undefined,
  focalPlayerId: string,
  data: FocalTurnData,
  // The dry run supplies a synthetic transcript so it can drive the pipeline
  // without a live conversation.
  transcriptOverride?: { authorName: string; text: string }[],
): Promise<FocalTurnOutcome> {
  // 1. Learn from what has been said since the last focal turn. Built from the
  // turn data we already hold rather than re-reading the world, so the dry run
  // can drive this with a synthetic scenario and still exercise the real path.
  const { knowledge, learned } = await extractMemoriesFor(
    ctx,
    worldId,
    {
      scenarioId: data.scenarioId,
      name: data.scenarioName,
      instruction: data.instruction,
      context: data.context,
      goals: data.completionGoal,
      conflict: data.conflict,
      topics: [],
      completionGoal: data.completionGoal,
      participants: data.participants,
    },
    focalPlayerId,
    transcriptOverride,
  );

  // 2. Estimate.
  const action = await focalDecision(ctx, worldId, convId, data, knowledge);
  if (!action) return { goalMet: false };

  const nameToId = new Map(data.participants.map((p) => [p.name.toLowerCase(), p.playerId]));
  const validOptionIds = new Set(data.options.map((o) => o.optionId));
  const estimates: OptionEstimate[] = action.estimatedUtilityBreakdown
    .filter((e) => validOptionIds.has(e.optionId))
    .map((e) => ({
      optionId: e.optionId,
      estimatedScore: e.estimatedScore,
      tabooRisk: e.tabooRisk,
      riskyForPlayerIds: e.riskyForNames
        .map((n) => nameToId.get(n.trim().toLowerCase()))
        .filter((id): id is string => !!id),
    }));
  if (estimates.length === 0) return { goalMet: false };

  // 3. TypeScript decides, not the model.
  const check = checkStoppingCriteria(estimates, data.topScoreHistory);
  const top = check.top!;
  // A model that scores only some of the options gets a free pass on the margin
  // criterion — with one option scored there is nothing to out-rank. Treat a
  // partial breakdown as not yet decision-grade and go ask instead.
  const scoredEveryOption = estimates.length === data.options.length;
  const blockedBy = scoredEveryOption ? check.blockedBy : [...check.blockedBy, 'incomplete-scoring'];
  const forced = shouldForceDecision(data);
  const decide = (check.canDecide && scoredEveryOption) || forced;

  console.log(
    `[focal] ${data.selfName} / "${data.scenarioName}": top=${top.optionId} (${top.estimatedScore}) ` +
      `questions=${data.questionsAsked}/${MAX_FOCAL_QUESTIONS} model=${action.suggestedAction} ` +
      `-> ${decide ? (forced && !check.canDecide ? 'DECIDE (forced)' : 'DECIDE') : 'ASK'} ` +
      `[${describeBlockers(check)}]`,
  );

  const topScore: TopScoreSnapshot = { optionId: top.optionId, groupUtility: top.estimatedScore };

  if (decide) {
    const chosen = data.options.find((o) => o.optionId === top.optionId);
    // Use the model's line only when it actually wrote one AND it commits to the
    // option we are choosing. Otherwise it is either empty (the model drafted
    // only the branch it preferred) or about a different option, so substitute a
    // plain line naming the right one.
    const drafted = action.decisionOutput.trim();
    const text =
      drafted && action.selectedOptionId === top.optionId
        ? drafted
        : `Okay — let's settle on ${chosen?.title ?? 'that one'}. That's the one that works best for all of us.`;
    return {
      text,
      goalMet: true,
      focal: {
        estimates,
        topScore,
        blockedBy,
        askedQuestion: false,
        factsLearned: learned,
        resolvedOptionId: top.optionId,
        forcedDecision: forced && !(check.canDecide && scoredEveryOption),
      },
    };
  }

  // Ask. Steering nextSpeaker to the person being asked is what makes the
  // question get answered, rather than someone else changing the subject.
  const targetId = action.questionTargetName
    ? nameToId.get(action.questionTargetName.trim().toLowerCase())
    : undefined;
  const target = data.participants.find((p) => p.playerId === targetId);
  const drafted = action.questionOutput.trim();
  const text = drafted || fallbackQuestion(knowledge, target?.name);
  return {
    text,
    nextSpeaker: target?.present ? targetId : undefined,
    goalMet: false,
    focal: {
      estimates,
      topScore,
      blockedBy,
      askedQuestion: true,
      questionTargetId: targetId,
      factsLearned: learned,
    },
  };
}

// Used when the model committed to DECIDE and so left questionOutput empty, but
// the stopping criteria overruled it. Aims at whoever the focal agent understands
// least well, which is the question most likely to move the estimates.
function fallbackQuestion(knowledge: PerceivedKnowledgeRow[], targetName?: string): string {
  const name =
    targetName ??
    [...knowledge].sort((a, b) => a.confidenceScore - b.confidenceScore)[0]?.targetName;
  if (!name) return 'Before we lock this in — is there anything that would not work for anyone?';
  return `${name}, before we lock this in — is there anything about this that wouldn't work for you?`;
}

// Safety valves. The stopping criteria decide whether the focal agent MAY commit;
// these decide when it must anyway, so a deliberation always resolves into
// something the evaluator can score rather than trailing off unfinished.
function shouldForceDecision(data: FocalTurnData): boolean {
  if (data.questionsAsked >= MAX_FOCAL_QUESTIONS) return true;
  if (data.numMessages >= SCENARIO_CONVO_MAX_MESSAGES - FOCAL_DECIDE_MESSAGE_HEADROOM) return true;
  if (Date.now() > data.endTime - FOCAL_FORCE_DECIDE_MS) return true;
  return false;
}

// --- The operation -------------------------------------------------------------

export const runFocalAgentTurn = internalAction({
  args: {
    worldId: v.id('worlds'),
    agentId,
    playerId,
    conversationId,
    operationId: v.string(),
    messageUuid: v.string(),
    gameTimeMs: v.number(),
    scenarioId: v.string(),
  },
  // Explicit `Promise<void>`: this action calls ctx.runQuery on `internal`, and
  // an inferred return type that depends on the generated api makes the api type
  // graph circular, which silently degrades inferred types across the repo.
  handler: async (ctx, args): Promise<void> => {
    const convId = args.conversationId as GameId<'conversations'>;
    const pid = args.playerId as GameId<'players'>;

    let text: string | undefined;
    let nextSpeaker: string | undefined;
    let goalMet = false;
    let focal: FocalTurnResult | undefined;

    try {
      const data = await ctx.runQuery(selfInternal.loadFocalTurnData, {
        worldId: args.worldId,
        scenarioId: args.scenarioId,
        conversationId: args.conversationId,
        playerId: args.playerId,
      });
      if (data && data.options.length >= 2) {
        const outcome = await takeFocalTurn(ctx, args.worldId, convId, pid, data);
        text = outcome.text;
        nextSpeaker = outcome.nextSpeaker;
        goalMet = outcome.goalMet;
        focal = outcome.focal;
      }
    } catch (err) {
      console.error(`runFocalAgentTurn failed for ${args.playerId}:`, err);
    }

    // Any failure above degrades to an ordinary conversational turn rather than
    // to silence: the deliberation stalls for a turn, the conversation does not.
    if (!text) {
      try {
        text = await continueConversationMessage(ctx, args.worldId, convId, pid, args.gameTimeMs);
        const decision = await decideNextSpeaker(ctx, args.worldId, convId, pid);
        nextSpeaker = decision.nextSpeaker;
        goalMet = decision.goalMet;
      } catch (err) {
        console.error(`runFocalAgentTurn fallback failed for ${args.playerId}:`, err);
        // Send something regardless, so agentFinishSendingMessage runs and the
        // operation lock is released instead of being held for ACTION_TIMEOUT.
        text = '...';
      }
    }

    await ctx.runMutation(internal.aiTown.agent.agentSendMessage, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      agentId: args.agentId,
      playerId: args.playerId,
      text,
      messageUuid: args.messageUuid,
      leaveConversation: false,
      scenarioId: args.scenarioId,
      operationId: args.operationId,
      nextSpeaker,
      goalMet,
      focal,
    });
  },
});
