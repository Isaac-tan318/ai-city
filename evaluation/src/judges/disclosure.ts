// Component 4: did private information come out at a sensible moment?
//
// Two questions, asked separately because they pull in opposite directions and a
// single call would trade one off against the other:
//
//   Relevant disclosure — over the opportunities pass 1 already found, was the
//   constraint ever actually stated? A constraint that stays hidden forever
//   makes the whole group decision worse, so a high rate is wanted.
//
//   Premature disclosure — did they open by reciting private facts nobody asked
//   for? An NPC that front-loads its entire profile is trivially "informative"
//   and completely unlike a person, so a low rate is wanted.
//
// The premature question deliberately looks only at a participant's opening
// turns. Judging the whole transcript would let a perfectly natural late
// disclosure be scored as premature.
import { z } from 'zod';
import type { CharacterRecord } from '../corpus/profiles';
import { renderFullProfile } from '../corpus/profiles';
import type { Conversation } from '../corpus/normalize';
import type { DisclosureRecord, InteractionRecord } from '../metrics';
import type { Judge } from '../llm';
import { renderTranscript, type Opportunity } from './opportunities';

// How many of a participant's own turns count as "the opening".
export const OPENING_TURNS = 2;

export const DisclosureSchema = z.object({
  disclosures: z
    .array(
      z.object({
        index: z.number(),
        disclosed: z.boolean().default(false),
        // The words that conveyed it. Empty when it was never said — which is
        // itself the useful case, since a constraint that stayed hidden is what
        // drags Relevant Disclosure Rate down.
        quote: z.string().default(''),
      }),
    )
    .default([]),
});

// The metric records plus the evidence behind them. Persona fidelity has
// carried its evidence since the start; this brings disclosure into line, so
// every rate in the report can be traced back to an utterance rather than
// leaving one component as a number you have to take on trust.
export type DisclosureJudgement = DisclosureRecord & {
  quote: string;
};

export type PrematureJudgement = InteractionRecord & {
  whatWasVolunteered: string;
  reasoning: string;
};

export const PrematureSchema = z.object({
  premature: z.boolean().default(false),
  whatWasVolunteered: z.string().default(''),
  reasoning: z.string().default(''),
});

export async function gradeDisclosures(
  judge: Judge,
  conversation: Conversation,
  character: CharacterRecord,
  opportunities: Opportunity[],
): Promise<DisclosureJudgement[]> {
  const relevant = opportunities.filter(
    (o) => o.kind === 'disclosure' || o.kind === 'hardConstraint',
  );
  if (relevant.length === 0) return [];

  const listed = relevant
    .map(
      (o, i) =>
        `  ${i}. ${o.attribute || '(unnamed)'} — relevant because ${o.why || 'of the topic'}`,
    )
    .join('\n');

  const prompt = [
    `You are checking whether a person stated certain private facts about themselves during a ` +
      `conversation. You are given a fixed list; answer for exactly these.`,
    ``,
    `The person: ${character.name}`,
    renderFullProfile(character),
    ``,
    `The conversation:`,
    renderTranscript(conversation),
    ``,
    `The private facts to check:`,
    listed,
    ``,
    `For each numbered fact, set "disclosed" true only if ${character.name} actually conveyed it ` +
      `to the others in this conversation. Conveying it counts however it was phrased — ` +
      `"I only eat halal", "I cannot do pork", and "the hawker centre has stalls I can eat at" ` +
      `all convey the same restriction. Someone else mentioning it on their behalf does NOT ` +
      `count; it has to come from ${character.name}.`,
    `Quote the words that conveyed it in "quote", or leave it empty when it was never said.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"disclosures":[{"index":0,"disclosed":true,"quote":"I only eat halal"}]}`,
  ].join('\n');

  const parsed = await judge.ask(
    `disclosure/${conversation.id}/${character.name}`,
    prompt,
    DisclosureSchema,
  );

  return relevant.map((o, i) => {
    const verdict = parsed?.disclosures.find((d) => d.index === i);
    return {
      characterName: character.name,
      conversationId: conversation.id,
      constraint: o.attribute,
      opportunity: true,
      // No answer means not disclosed. That direction is conservative for a rate
      // where high is desirable — it cannot flatter the simulation.
      disclosed: verdict?.disclosed ?? false,
      quote: verdict?.quote.trim() ?? '',
    };
  });
}

export async function gradePremature(
  judge: Judge,
  conversation: Conversation,
  character: CharacterRecord,
): Promise<PrematureJudgement | undefined> {
  const own = conversation.messages.filter((m) => m.author === character.name);
  if (own.length === 0) return undefined;
  const opening = own.slice(0, OPENING_TURNS);
  // Everything said before their last opening turn, so the judge can see
  // whether anybody actually asked.
  const lastOpeningIndex = opening[opening.length - 1].index;
  const before = conversation.messages.filter((m) => m.index <= lastOpeningIndex);

  const prompt = [
    `You are judging whether a person volunteered private information about themselves too ` +
      `early in a conversation.`,
    ``,
    `The person: ${character.name}`,
    renderFullProfile(character),
    ``,
    `The opening of the conversation, up to and including their first turns:`,
    before.map((m) => `[${m.index}] ${m.author}: ${m.text}`).join('\n'),
    ``,
    `Their own opening lines were:`,
    opening.map((m) => `  "${m.text}"`).join('\n'),
    ``,
    `Set "premature" true only if, in those opening lines, ${character.name} volunteered private ` +
      `information — a dietary or religious restriction, a medical condition, a budget limit, an ` +
      `income or a personal circumstance — when ALL of the following hold:`,
    `  - nobody asked them for it, and`,
    `  - the conversation had not yet reached a subject that made it necessary to raise, and`,
    `  - it was not needed to answer a question actually put to them.`,
    ``,
    `Mentioning a restriction because the group had already started choosing a restaurant is ` +
      `NOT premature — that is exactly when a person would say it. Opening with "Hi, I am ` +
      `diabetic and I earn S$3,000 a month" when the group is discussing the weather IS premature.`,
    `Reciting several private facts at once with no prompting is a strong signal.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"premature":false,"whatWasVolunteered":"","reasoning":"one short sentence"}`,
  ].join('\n');

  const parsed = await judge.ask(
    `premature/${conversation.id}/${character.name}`,
    prompt,
    PrematureSchema,
  );
  if (!parsed) return undefined;
  return {
    characterName: character.name,
    conversationId: conversation.id,
    prematureDisclosure: parsed.premature,
    whatWasVolunteered: parsed.whatWasVolunteered.trim(),
    reasoning: parsed.reasoning.trim(),
  };
}
