// The behavioural dimensions Component 2 tests, and nothing an NPC may see.
//
// Each entry is the framework's four-element definition — profile attribute,
// test scenario, observable behaviour, expected direction — split into two
// halves that must never mix:
//
//   agentFacing   the situation and the options. Safe to put in an NPC prompt.
//   analysisOnly  the hypothesis, the expected direction, the citation, and the
//                 high/low classifier. Structurally unreachable from the probe
//                 runner, and checked by neutrality.ts.
//
// That split is Prompt Neutrality and Experimental Unawareness expressed as a
// type rather than as a warning comment: the runner is handed `agentFacing` and
// never receives the rest, so an expected direction cannot leak into a prompt
// even by accident.
//
// Grouping into high/low is deliberately a deterministic pattern match, not an
// LLM call. A model asked "is this character conflict-avoidant?" while the same
// model is producing the behaviour would be marking its own homework, and the
// grouping needs to be reproducible across runs anyway.
//
// CITATIONS ARE DEDUCED FROM THE ATTRIBUTE, NOT FROM LITERATURE. Every entry
// below carries `citation: 'TODO'`: the directions are the conventional ones,
// but they have not been traced to a specific source. Fill these in before any
// DCR number is reported as a literature-anchored result.
import type { ExpectedDirection } from '../metrics';

export type Group = 'high' | 'low' | 'unclassified';

export type AgentFacing = {
  // The standardized situation, written so the attribute becomes relevant
  // without naming the attribute. "Someone suggests splitting the bill unevenly"
  // is a situation; "you are conflict-avoidant, so object" is an instruction.
  situation: string;
  // What the NPC is being asked to do. Kept identical across the high and low
  // groups — the whole comparison depends on that.
  ask: string;
  // Candidate options, when the probe is a choice. Empty for open response.
  options: { optionId: string; title: string; details: string }[];
};

export type AnalysisOnly = {
  hypothesis: string;
  expected: ExpectedDirection;
  citation: string;
  // Patterns over the raw attribute value. Net hits decide the group; a tie
  // leaves the character unclassified and out of the test entirely.
  highPatterns: RegExp[];
  lowPatterns: RegExp[];
  highLabel: string;
  lowLabel: string;
};

export type Dimension = {
  id: string;
  // The structured profile key this dimension reads (data/characterProfiles.ts
  // vocabulary, carried through to each entry in data/characters.ts).
  attribute: string;
  // The behaviour a coder can mark true or false from a single response.
  observable: string;
  agentFacing: AgentFacing;
  analysisOnly: AnalysisOnly;
};

// Net pattern hits, high minus low. Exported so the classification can be
// printed and audited without running a probe.
export function classify(dimension: Dimension, attributeValue: string | undefined): Group {
  if (!attributeValue?.trim()) return 'unclassified';
  const text = attributeValue.toLowerCase();
  const { highPatterns, lowPatterns } = dimension.analysisOnly;
  const score =
    highPatterns.filter((p) => p.test(text)).length -
    lowPatterns.filter((p) => p.test(text)).length;
  if (score > 0) return 'high';
  if (score < 0) return 'low';
  return 'unclassified';
}

export const DIMENSIONS: Dimension[] = [
  {
    id: 'conflict-avoidance',
    attribute: 'Conflict style',
    observable: 'Objects immediately, in this reply, to the uneven split',
    agentFacing: {
      situation:
        'Six of you have just finished dinner at a hawker centre. The bill comes to S$150. ' +
        'Bernard, who ordered the most and had two beers, says brightly: "Let us just split it ' +
        'six ways, easiest that way — S$25 each." Two people at the table ate only rice and ' +
        'vegetables and drank water. Nobody has said anything yet. Everyone is looking at the bill.',
      ask: 'What do you say next? Reply with ONLY strict JSON: {"say":"the single line you would actually speak"}',
      options: [],
    },
    analysisOnly: {
      hypothesis:
        'Characters described as conflict-avoidant object less readily to an unfair arrangement ' +
        'in front of a group than characters described as direct.',
      expected: 'high<low',
      citation: 'TODO',
      highPatterns: [
        /avoid/,
        /harmony/,
        /smooth/,
        /mediat/,
        /defus/,
        /rarely confrontational/,
        /reconcil/,
        /restorative/,
        /keeps? the peace/,
        /defer/,
        /diplomac/,
        /reciprocity/,
      ],
      lowPatterns: [
        /openly/,
        /directly/,
        /\bdirect\b/,
        /stands (his|her|their) ground/,
        /argues/,
        /challenges/,
        /\bfirm\b/,
        /stern/,
        /defends/,
        /criticise/,
        /comfortable stating/,
        /negotiates logically/,
        /disagreement/,
      ],
      highLabel: 'conflict-avoidant',
      lowLabel: 'direct',
    },
  },
  {
    id: 'payment-norm',
    attribute: 'Payment/gift norm',
    observable: 'Accepts being treated rather than insisting on paying their share',
    agentFacing: {
      situation:
        'The meal is over and the bill is on the table. Clara, who earns considerably more than ' +
        'most of the group, picks it up and says: "Put your wallets away, this one is on me. ' +
        'Really — I insist."',
      ask: 'What do you say next? Reply with ONLY strict JSON: {"say":"the single line you would actually speak"}',
      options: [],
    },
    analysisOnly: {
      hypothesis:
        'Characters whose payment norm is strict bill-splitting accept being treated less ' +
        'readily than characters whose norm is hosting, treating, or communal sharing.',
      expected: 'high<low',
      citation: 'TODO',
      highPatterns: [
        /\baa\b/,
        /split/,
        /transparent/,
        /clean payment/,
        /fair cost/,
        /avoids owing/,
        /price-sensitive/,
        /careful with money/,
        /budget/,
        /low-cost/,
        /affordable/,
      ],
      lowPatterns: [
        /treat/,
        /\bhost\b/,
        /wants to host/,
        /generous/,
        /communal/,
        /community contribution/,
        /reciprocal/,
        /reciprocity/,
        /enjoys treating/,
        /offer tea/,
      ],
      highLabel: 'splits strictly',
      lowLabel: 'hosts / treats',
    },
  },
  {
    id: 'privacy-norm',
    attribute: 'Privacy/modesty norm',
    observable: 'Answers the personal question with a substantive detail on the first ask',
    agentFacing: {
      situation:
        'You are in a group of five having coffee. The conversation turns to money and living ' +
        'arrangements. Someone you have met twice before turns to you and asks, cheerfully and in ' +
        'front of everyone: "So how much are you actually paying for your place? And who do you ' +
        'live with?"',
      ask: 'What do you say next? Reply with ONLY strict JSON: {"say":"the single line you would actually speak"}',
      options: [],
    },
    analysisOnly: {
      hypothesis:
        'Characters with a high stated privacy or modesty norm answer an unsolicited personal ' +
        'question in a group with less substantive detail than characters with a low one.',
      expected: 'high<low',
      citation: 'TODO',
      highPatterns: [/high privacy/, /reserved/, /\bprivate\b/, /modest/, /discreet/, /guarded/],
      lowPatterns: [/^low/, /low-to-moderate/, /low privacy/, /\bopen\b/, /comfortable sharing/],
      highLabel: 'high privacy',
      lowLabel: 'low privacy',
    },
  },
  {
    id: 'alcohol-attitude',
    attribute: 'Alcohol attitude',
    observable: 'Endorses the bar as their choice',
    agentFacing: {
      situation:
        'The group is picking somewhere to spend Friday evening together. Three places are on ' +
        'the table and everyone is saying which they would go for.',
      ask: 'Which do you pick? Reply with ONLY strict JSON: {"optionId":"...","reason":"one short sentence"}',
      options: [
        {
          optionId: 'bar',
          title: 'Craft beer bar',
          details: 'A lively bar in Chinatown. Good beer list, loud, drinks-focused, S$25 a head.',
        },
        {
          optionId: 'kopitiam',
          title: 'Late-night kopitiam',
          details: 'Open-air coffee shop, toast and noodles, no alcohol served, S$8 a head.',
        },
        {
          optionId: 'cinema',
          title: 'Cinema',
          details: 'The new release at a mall cinema, nothing served but popcorn, S$14 a head.',
        },
      ],
    },
    analysisOnly: {
      hypothesis:
        'Characters who avoid or limit alcohol endorse an explicitly drinks-centred venue less ' +
        'often than characters comfortable with alcohol socially.',
      expected: 'high<low',
      citation: 'TODO',
      highPatterns: [
        /avoid/,
        /limited/,
        /rarely/,
        /not central/,
        /no alcohol/,
        /abstain/,
        /fasting/,
      ],
      lowPatterns: [
        /comfortable/,
        /enjoys/,
        /drinks socially/,
        /nightlife/,
        /\bwine\b/,
        /craft beer/,
      ],
      highLabel: 'avoids alcohol',
      lowLabel: 'comfortable with alcohol',
    },
  },
  {
    id: 'social-power',
    attribute: 'Social power',
    observable: 'Proposes a concrete resolution rather than deferring or waiting',
    agentFacing: {
      situation:
        'The group has been going back and forth about the weekend plan for twenty minutes and ' +
        'is completely stuck: three people want the beach, three want a museum, and the same ' +
        'arguments keep coming round again. There is a long, slightly awkward silence.',
      ask: 'What do you say next? Reply with ONLY strict JSON: {"say":"the single line you would actually speak"}',
      options: [],
    },
    analysisOnly: {
      hypothesis:
        'Characters described as influential, senior or trusted step in to resolve a deadlocked ' +
        'group more readily than characters described as newcomers or low-power.',
      expected: 'high>low',
      citation: 'TODO',
      highPatterns: [
        /influential/,
        /high-status/,
        /respected/,
        /leader/,
        /mediator/,
        /trusted/,
        /wealthy/,
        /\belder\b/,
        /long-time resident/,
        /business owner/,
      ],
      lowPatterns: [
        /\blow\b/,
        /low-income/,
        /lower-income/,
        /newcomer/,
        /isolated/,
        /migrant worker/,
        /quiet minority/,
        /unstable/,
        /working-class/,
        /\byoung\b/,
      ],
      highLabel: 'socially influential',
      lowLabel: 'low social power',
    },
  },
  {
    id: 'directness',
    attribute: 'Communication style',
    observable: 'States the objection plainly rather than hedging or going along with it',
    agentFacing: {
      situation:
        'The group has settled on a plan that genuinely does not work for you — it is on the one ' +
        'evening you are not free, and nobody has asked whether the date suits everyone. ' +
        'Someone says: "Right, that is settled then. Thursday it is."',
      ask: 'What do you say next? Reply with ONLY strict JSON: {"say":"the single line you would actually speak"}',
      options: [],
    },
    analysisOnly: {
      hypothesis:
        'Characters with a direct communication style raise an objection plainly, where ' +
        'characters with an indirect style hedge, soften, or say nothing.',
      expected: 'high>low',
      citation: 'TODO',
      highPatterns: [
        /\bdirect\b/,
        /blunt/,
        /concise/,
        /\bclear\b/,
        /task-focused/,
        /precise/,
        /frank/,
      ],
      lowPatterns: [
        /indirect/,
        /polite/,
        /gentle/,
        /soft-spoken/,
        /\bwarm\b/,
        /diplomatic/,
        /careful/,
        /measured/,
        /reserved/,
        /smiles when uncomfortable/,
        /\bquiet\b/,
      ],
      highLabel: 'direct',
      lowLabel: 'indirect',
    },
  },
  {
    id: 'observance',
    attribute: 'Observance level',
    observable: 'Raises the clash with their observance rather than letting the time stand',
    agentFacing: {
      situation:
        'The group is fixing a time for a long lunch this Friday. Someone proposes 12:30 to 3pm, ' +
        'across town, and says: "That works for everyone, yes?"',
      ask: 'What do you say next? Reply with ONLY strict JSON: {"say":"the single line you would actually speak"}',
      options: [],
    },
    analysisOnly: {
      hypothesis:
        'Characters with a high stated observance level raise a scheduling clash with religious ' +
        'obligation more readily than characters with a low or nominal one.',
      expected: 'high>low',
      citation: 'TODO',
      highPatterns: [/\bhigh\b/, /practicing/, /practising/, /strict/, /devout/, /observant/],
      lowPatterns: [
        /^low/,
        /\blow\b/,
        /nominal/,
        /secular/,
        /culturally respectful/,
        /non-practising/,
      ],
      highLabel: 'high observance',
      lowLabel: 'low observance',
    },
  },
];

export function dimensionById(id: string): Dimension | undefined {
  return DIMENSIONS.find((d) => d.id === id);
}
