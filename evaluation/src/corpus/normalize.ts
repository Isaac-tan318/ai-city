// Both accepted inputs, flattened into one shape the judges and metrics read.
//
// The point of normalizing rather than branching everywhere downstream is that
// exactly one place has to know what the chat-history export is missing. That
// place records the gap on `capabilities`, and the report prints which
// components the input could not support instead of quietly reporting a rate
// over an empty denominator.
import fs from 'fs';
import { bundleExport, chatHistoryExport, type BundleExport } from './schema';

export type Utterance = {
  // Position within the conversation, 0-based. The opportunity judge cites this
  // so a verdict can be traced back to a specific line.
  index: number;
  author: string;
  text: string;
  at: number;
};

export type Conversation = {
  id: string;
  scenarioIds: string[];
  participants: string[];
  messages: Utterance[];
  startedAt: number;
  endedAt: number;
};

export type Decision = {
  scenarioId: string;
  scenarioName: string;
  focalName: string;
  selectedOptionId: string;
  regret: number;
  questionsAsked: number;
  forcedDecision: boolean;
  options: { optionId: string; title: string; details: string }[];
  optionScores: { optionId: string; title: string; groupUtility: number }[];
  agentScores: { name: string; totalIndividualUtility: number; hardTabooViolated: boolean }[];
  perOptionUtilities: { optionId: string; utilities: { name: string; utility: number }[] }[];
  at: number;
};

export type StateEvent = {
  at: number;
  characterName: string;
  component: string;
  delta: number;
  valueBefore: number;
  valueAfter: number;
  cause: string;
  scenarioId?: string;
  conversationId?: string;
  goalMet?: boolean;
};

export type GroundTruthRow = {
  name: string;
  culturalBackground: string;
  religion: string;
  hardTaboos: string[];
  essentialNeeds: string[];
  preferences: string[];
  budgetLimit: number;
  communicationStyle: string;
};

// Which framework components this particular input can actually support. The
// report reads these; nothing else branches on the source format.
export type Capabilities = {
  personaFidelity: boolean;
  disclosure: boolean;
  optionCoverage: boolean;
  dynamicState: boolean;
  aggregation: boolean;
  notes: string[];
};

export type Corpus = {
  source: 'chat-history' | 'bundle';
  conversations: Conversation[];
  decisions: Decision[];
  stateEvents: StateEvent[];
  // Ground truth from the bundle, when present. Otherwise the profile index
  // falls back to data/groundTruth.ts in the repo, which is the same data.
  groundTruth: GroundTruthRow[];
  capabilities: Capabilities;
};

const toMillis = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

export function loadCorpus(file: string): Corpus {
  if (!fs.existsSync(file)) {
    throw new Error(`No such input file: ${file}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  return normalize(raw, file);
}

export function normalize(raw: unknown, label = '<input>'): Corpus {
  // The bundle is an object with a `kind` tag; the chat-history export is a bare
  // array. Discriminating on shape rather than on filename means a renamed file
  // still works.
  if (Array.isArray(raw)) {
    const parsed = chatHistoryExport.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${label} looks like a chat-history export but did not validate: ` + issues(parsed.error),
      );
    }
    return fromChatHistory(parsed.data);
  }

  const parsed = bundleExport.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${label} is neither a chat-history export (an array) nor an evaluation bundle: ` +
        issues(parsed.error),
    );
  }
  return fromBundle(parsed.data);
}

function issues(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}

function fromChatHistory(data: ReturnType<typeof chatHistoryExport.parse>): Corpus {
  const conversations: Conversation[] = data.map((c) => ({
    id: c.id,
    scenarioIds: [...new Set(c.messages.map((m) => m.scenarioId).filter((s): s is string => !!s))],
    participants: c.participants.map((p) => p.name),
    messages: c.messages.map((m, index) => ({
      index,
      author: m.author,
      text: m.text,
      at: toMillis(m.timestamp),
    })),
    startedAt: toMillis(c.created),
    endedAt: toMillis(c.ended),
  }));

  const anyScenario = conversations.some((c) => c.scenarioIds.length > 0);
  return {
    source: 'chat-history',
    conversations,
    decisions: [],
    stateEvents: [],
    groundTruth: [],
    capabilities: {
      personaFidelity: conversations.length > 0,
      disclosure: conversations.length > 0,
      optionCoverage: false,
      dynamicState: false,
      aggregation: false,
      notes: [
        'Chat-history input carries no candidate options or evaluations: Option Coverage and the aggregation comparison are skipped.',
        'Chat-history input carries no short-term state log: Component 5 is skipped.',
        anyScenario
          ? 'Messages carry scenarioId, so opportunities can be attributed to scenarios.'
          : 'Messages carry no scenarioId, so transcripts cannot be joined to the decisions they produced.',
      ],
    },
  };
}

function fromBundle(data: BundleExport): Corpus {
  const nameByPlayer = new Map(data.players.map((p) => [p.playerId, p.name]));

  const conversations: Conversation[] = data.conversations.map((c) => ({
    id: c.id,
    scenarioIds:
      c.scenarioIds.length > 0
        ? c.scenarioIds
        : [...new Set(c.messages.map((m) => m.scenarioId).filter((s): s is string => !!s))],
    participants: c.participants.map((p) => p.name),
    messages: c.messages.map((m, index) => ({
      index,
      author: m.author,
      text: m.text,
      at: toMillis(m.timestamp),
    })),
    startedAt: toMillis(c.created),
    endedAt: toMillis(c.ended),
  }));

  const decisions: Decision[] = data.decisions.map((d) => ({
    scenarioId: d.scenarioId,
    scenarioName: d.scenarioName,
    focalName: d.focalName,
    selectedOptionId: d.selectedOptionId,
    regret: d.regret,
    questionsAsked: d.questionsAsked,
    forcedDecision: d.forcedDecision,
    // deciderTraces is the only source of the full menu; fall back to the
    // scored options so the option list is never empty when scores exist.
    options:
      d.options.length > 0
        ? d.options.map((o) => ({ optionId: o.optionId, title: o.title, details: o.details }))
        : d.optionScores.map((o) => ({ optionId: o.optionId, title: o.title, details: '' })),
    optionScores: d.optionScores,
    agentScores: d.agentScores.map((a) => ({
      name: a.name,
      totalIndividualUtility: a.totalIndividualUtility,
      hardTabooViolated: a.hardTabooViolated,
    })),
    perOptionUtilities: d.perOptionUtilities,
    at: d.at,
  }));

  const stateEvents: StateEvent[] = data.shortTermEvents.map((e) => ({
    at: e.at,
    characterName: e.name ?? nameByPlayer.get(e.playerId) ?? e.playerId,
    component: e.component,
    delta: e.delta,
    valueBefore: e.valueBefore,
    valueAfter: e.valueAfter,
    cause: e.cause,
    scenarioId: e.scenarioId,
    conversationId: e.conversationId,
    goalMet: e.goalMet,
  }));

  const notes: string[] = [];
  if (decisions.length === 0) {
    notes.push(
      'Bundle contains no evaluated decisions: Option Coverage and aggregation are skipped.',
    );
  }
  if (stateEvents.length === 0) {
    notes.push(
      'Bundle contains no shortTermEvents. Either the sim has not run since the log was added, or this world predates it: Component 5 is skipped.',
    );
  }
  const withPerOption = decisions.filter((d) => d.perOptionUtilities.length > 0).length;
  if (decisions.length > 0 && withPerOption === 0) {
    notes.push(
      'No per-option utilities were exported, so the aggregation comparison cannot re-rank the menu.',
    );
  }

  return {
    source: 'bundle',
    conversations,
    decisions,
    stateEvents,
    groundTruth: data.groundTruth,
    capabilities: {
      personaFidelity: conversations.length > 0,
      disclosure: conversations.length > 0,
      optionCoverage: decisions.length > 0,
      dynamicState: stateEvents.length > 0,
      aggregation: withPerOption > 0,
      notes,
    },
  };
}
