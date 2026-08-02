// End-to-end dry run of the Decider-Focal-Evaluator pipeline.
//
//   npx convex run dryRun:runDryRunScenario
//   npx convex run dryRun:runDryRunScenario '{"scenarioDefId":"movie_night_pick"}'
//
// Runs the whole engine against the default world's real characters and their
// real hidden ground truth, but entirely OUTSIDE the game engine: it calls the
// exported functions directly, takes no operation locks, inserts no engine
// inputs, and applies no affinity changes. It cannot perturb a running sim, and
// it works whether or not the sim is running at all.
//
// The transcript is scripted so the run is reproducible and so the interesting
// case is guaranteed to occur: Rahman's halal constraint is not mentioned until
// round two. A correct pipeline should therefore be blocked on `stability` in
// round one (no prior estimate to compare against), notice a taboo risk in round
// two, and be free to commit by round three.

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import { ActionCtx, internalAction, internalQuery } from './_generated/server';
import { DeliberationContext, generateOptionsFor } from './decider';
import { evaluateDecision } from './evaluator';
import { FocalTurnData, takeFocalTurn } from './focal';
import { checkStoppingCriteria, describeBlockers } from './scoring';
import { scenarioById } from '../data/scenarios';
import { MAX_FOCAL_QUESTIONS } from './constants';

const selfInternal = internal.dryRun;

// Who is in the room, resolved from the live world so the ids and names match
// the real playerDescriptions (and therefore the real groundTruthProfiles).
export const loadDryRunCast = internalQuery({
  args: { worldId: v.optional(v.id('worlds')) },
  handler: async (ctx, args) => {
    let worldId = args.worldId;
    if (!worldId) {
      const status = await ctx.db
        .query('worldStatus')
        .filter((q) => q.eq(q.field('isDefault'), true))
        .unique();
      if (!status) return null;
      worldId = status.worldId;
    }
    const descriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId!))
      .collect();
    return {
      worldId,
      cast: descriptions.map((d) => ({ playerId: d.playerId, name: d.name })),
    };
  },
});

// A scripted conversation, in rounds. Round 2 is where Rahman first says
// anything about halal — before that the focal agent has no way to know.
const SCRIPT: { authorName: string; text: string }[][] = [
  [
    { authorName: 'Cedric', text: "Okay lah, we're all hungry. Where are we actually eating?" },
    { authorName: 'Xavier', text: 'Anywhere cheap please, I am so broke this month.' },
    { authorName: 'Clara', text: 'I could be persuaded to treat, if we go somewhere decent.' },
    { authorName: 'Rahman', text: 'Ha, I am easy. Whatever everyone wants.' },
  ],
  [
    { authorName: 'Rahman', text: 'Ah — one thing, I only eat halal. No pork, and no alcohol for me.' },
    { authorName: 'Xavier', text: 'Oh right, forgot about that.' },
    { authorName: 'Clara', text: 'Noted. That rules out a couple of my suggestions then.' },
  ],
  [
    { authorName: 'Xavier', text: 'Honestly anything under fifteen bucks and I am there.' },
    { authorName: 'Cedric', text: 'Somewhere with a bit of life to it, please. Not a morgue.' },
    { authorName: 'Rahman', text: 'The hawker centre has halal stalls, that one confirm works for me.' },
  ],
  [
    { authorName: 'Cedric', text: "I'm not fussed on price, I just don't want to sit in silence." },
    { authorName: 'Clara', text: "Then somewhere lively and halal-friendly it is. I'll still get the drinks." },
  ],
  [
    { authorName: 'Xavier', text: 'Can we just decide already, I am wasting away here.' },
    { authorName: 'Rahman', text: 'Whatever you pick lah, as long as I can eat it.' },
  ],
];

export type DryRunResult = {
  scenarioId: string;
  options: { optionId: string; title: string; details: string }[];
  resolvedOptionId?: string;
  evaluated: boolean;
  focal?: string;
  questionsAsked?: number;
  forcedDecision?: boolean;
  selected?: string;
  groupUtility?: number;
  best?: string;
  regret?: number;
  tabooViolations?: string[];
};

export const runDryRunScenario = internalAction({
  args: {
    worldId: v.optional(v.id('worlds')),
    scenarioDefId: v.optional(v.string()),
    // Skip the evaluator's LLM calls (one per option) when you only want to see
    // the deliberation behaviour.
    skipEvaluation: v.optional(v.boolean()),
  },
  // Explicit return type: this action calls ctx.runQuery on `internal`, and an
  // inferred one that depends on the generated api makes the api type graph
  // circular, which silently degrades inferred types across the repo.
  handler: async (ctx, args): Promise<DryRunResult> => {
    const defId = args.scenarioDefId ?? 'dinner_decision';
    const def = scenarioById(defId);
    if (!def) throw new Error(`No scenario definition '${defId}' in data/scenarios.ts`);
    if ((def.outcome ?? (def.scope === 'local' ? 'tasks' : 'decision')) !== 'decision') {
      throw new Error(`Scenario '${defId}' is not a decision scenario.`);
    }

    const loaded = await ctx.runQuery(selfInternal.loadDryRunCast, { worldId: args.worldId });
    if (!loaded) throw new Error('No default world. Run `npx convex run init` first.');
    const { worldId } = loaded;

    await ctx.runMutation(internal.groundTruth.ensureGroundTruth, { worldId });

    // Cast the people the script actually names, so the transcript and the
    // participants agree. Anyone missing from the world is skipped.
    const scripted = new Set(SCRIPT.flat().map((m) => m.authorName));
    const cast = loaded.cast.filter((c) => scripted.has(c.name));
    if (cast.length < 3) {
      throw new Error(
        `Only found ${cast.length} of the scripted characters in this world ` +
          `(need Cedric, Xavier, Clara, Rahman). Has the world been initialised?`,
      );
    }

    const scenarioId = `dryrun-${defId}-${Date.now()}`;
    const focal = [...cast].sort((a, b) => a.playerId.localeCompare(b.playerId))[0];
    const line = (s: string) => console.log(s);

    line('');
    line('════════════════════════════════════════════════════════════════');
    line(`  DRY RUN — ${def.name}   (scenario ${scenarioId})`);
    line(`  Cast:  ${cast.map((c) => `${c.name}(${c.playerId})`).join(', ')}`);
    line(`  Focal: ${focal.name} — lowest-sorting participant id`);
    line('════════════════════════════════════════════════════════════════');

    const context: DeliberationContext = {
      scenarioId,
      name: def.name,
      instruction: def.instruction,
      context: `${def.context} Present: ${cast.map((c) => c.name).join(', ')}.`,
      goals: def.goals,
      conflict: def.conflict,
      topics: def.topics,
      completionGoal: def.completionGoal,
      participants: cast.map((c) => ({ playerId: c.playerId, name: c.name })),
    };

    // 1. The Decider proposes the menu.
    line('');
    line('── 1. Decider: candidate options ───────────────────────────────');
    const { reasoning, options } = await generateOptionsFor(ctx, context);
    if (options.length < 2) throw new Error('Option generation produced nothing usable.');
    if (reasoning) line(`   why this set: ${reasoning}`);
    for (const o of options) {
      line(`   ${o.optionId}  ${o.title} — ${o.details}`);
      if (o.rationale) line(`         why: ${o.rationale}`);
      if (o.riskNote) line(`         suspects it won't suit: ${o.riskNote}`);
    }

    // 2-3. Focal turns over an accumulating transcript. State is threaded by hand
    // here; in the live engine it lives on the scenario's deliberation block and
    // is applied by the agentFinishSendingMessage input handler.
    const data: FocalTurnData = {
      scenarioId,
      scenarioName: def.name,
      instruction: def.instruction,
      context: context.context,
      completionGoal: def.completionGoal,
      conflict: def.conflict,
      // Far enough out that the expiry safety valve never fires during the run.
      endTime: Date.now() + 60 * 60_000,
      options,
      previousEstimates: [],
      topScoreHistory: [],
      questionsAsked: 0,
      participants: cast.map((c) => ({ playerId: c.playerId, name: c.name, present: true })),
      selfName: focal.name,
      numMessages: 0,
    };

    const transcript: { authorName: string; text: string }[] = [];
    let resolvedOptionId: string | undefined;
    let forcedDecision = false;

    for (let round = 0; round < SCRIPT.length && !resolvedOptionId; round++) {
      transcript.push(...SCRIPT[round]);
      data.numMessages = transcript.length;

      line('');
      line(`── ${round + 2}. Focal turn ${round + 1} ─────────────────────────────────────`);
      for (const m of SCRIPT[round]) line(`   ${m.authorName}: ${m.text}`);

      const outcome = await takeFocalTurn(ctx, worldId, undefined, focal.playerId, data, transcript);
      if (!outcome.focal) {
        line('   !! focal turn produced nothing (LLM failure) — see the error above');
        continue;
      }
      const check = checkStoppingCriteria(outcome.focal.estimates, data.topScoreHistory);
      line('');
      line(`   estimates: ${outcome.focal.estimates
        .map((e) => `${e.optionId}=${e.estimatedScore}${e.tabooRisk ? '⚠' : ''}`)
        .join('  ')}`);
      line(`   criteria:  ${describeBlockers(check)}`);
      line(`   -> ${focal.name}: "${outcome.text}"`);

      // Mirror what applyFocalTurn does in the engine.
      data.previousEstimates = outcome.focal.estimates;
      if (outcome.focal.topScore) data.topScoreHistory.push(outcome.focal.topScore);
      if (outcome.focal.askedQuestion) data.questionsAsked++;
      if (outcome.focal.resolvedOptionId) {
        resolvedOptionId = outcome.focal.resolvedOptionId;
        forcedDecision = !!outcome.focal.forcedDecision;
      }
      transcript.push({ authorName: focal.name, text: outcome.text ?? '' });
    }

    if (!resolvedOptionId) {
      // Same fallback the engine uses when a scenario expires mid-deliberation.
      const ranked = [...data.previousEstimates].sort(
        (a, b) => b.estimatedScore - a.estimatedScore,
      );
      resolvedOptionId = ranked[0]?.optionId;
      forcedDecision = true;
      line('');
      line(`   (never met the criteria in ${SCRIPT.length} rounds — defaulting to the leader)`);
    }
    if (!resolvedOptionId) throw new Error('No option was ever scored; nothing to evaluate.');

    line('');
    line(`   decided: ${options.find((o) => o.optionId === resolvedOptionId)?.title}` +
      `${forcedDecision ? '  [forced]' : ''}  after ${data.questionsAsked}/${MAX_FOCAL_QUESTIONS} questions`);

    if (args.skipEvaluation) {
      line('');
      line('── Evaluation skipped (skipEvaluation: true) ───────────────────');
      return { scenarioId, options, resolvedOptionId, evaluated: false };
    }

    // 4. The Evaluator scores every option against the hidden ground truth.
    line('');
    line('── 5. Evaluator: ground truth ──────────────────────────────────');
    const row = await evaluateDecision(ctx, {
      worldId,
      scenarioId,
      scenarioName: def.name,
      focalPlayerId: focal.playerId,
      focalName: focal.name,
      options,
      selectedOptionId: resolvedOptionId,
      participantIds: cast.map((c) => c.playerId),
      questionsAsked: data.questionsAsked,
      forcedDecision,
      transcriptOverride: transcript,
      // A diagnostic must not nudge a live world's relationships.
      applyFeedback: false,
    });
    if (!row) {
      line('   !! evaluation failed — see the error above');
      return { scenarioId, options, resolvedOptionId, evaluated: false };
    }

    line('');
    for (const o of row.optionScores) {
      const mark = o.optionId === row.selectedOptionId ? '←chosen' : '';
      const best = o.optionId === row.bestOptionId ? '★best' : '';
      line(`   ${String(o.groupUtility).padStart(6)}  ${o.title} ${mark}${best}`);
    }
    line('');
    line(`   Per-person, for "${row.selectedOptionTitle}":`);
    for (const s of row.agentScores) {
      const f = s.dimensionFactors;
      line(
        `   ${s.name.padEnd(8)} U=${String(s.totalIndividualUtility).padStart(6)}  ` +
          `need=${f.essentialNeeds} pref=${f.preferenceMatch} cost=${f.costTimeBurden} ` +
          `fair=${f.fairness} comfort=${f.socialComfort} rel=${f.relationshipImpact}` +
          (s.hardTabooViolated ? `   ⛔ ${s.violatedTaboo ?? 'hard constraint violated'}` : ''),
      );
    }
    line('');
    line(`   group utility ${row.aggregatedGroupUtility}/100`);
    line(`   best available ${row.bestGroupUtility} (${row.bestOptionTitle})`);
    line(`   REGRET ${row.regret}`);
    line('════════════════════════════════════════════════════════════════');
    line('');

    return {
      scenarioId,
      options,
      resolvedOptionId,
      focal: focal.name,
      questionsAsked: data.questionsAsked,
      forcedDecision,
      selected: row.selectedOptionTitle,
      groupUtility: row.aggregatedGroupUtility,
      best: row.bestOptionTitle,
      regret: row.regret,
      tabooViolations: row.agentScores.filter((s) => s.hardTabooViolated).map((s) => s.name),
      evaluated: true,
    };
  },
});

// Keep the ActionCtx / Id imports honest for editors that prune unused types.
export type DryRunCtx = ActionCtx;
export type DryRunWorldId = Id<'worlds'>;
