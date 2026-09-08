// Component 2's coder: did this response show the observable behaviour?
//
// The judge is shown the situation, the response, and a description of the
// behaviour to look for — and nothing else. It is NOT told which group the
// character is in, what the profile says, or what the hypothesis predicts. A
// coder who knows the character is "conflict-avoidant" and is looking for an
// objection will find fewer objections, and the resulting DCR would measure the
// coder's expectations rather than the simulation's behaviour.
//
// This is the reason the observable in each registry entry is phrased as a
// concrete, single-response act ("objects immediately, in this reply") rather
// than a disposition ("is conflict-avoidant"). A disposition cannot be coded
// blind; an act can.
import { z } from 'zod';
import type { Judge } from '../llm';

export const BehaviourSchema = z.object({
  present: z.boolean(),
  quote: z.string().default(''),
  reasoning: z.string().default(''),
});

export type BehaviourCoding = {
  characterName: string;
  dimensionId: string;
  present: boolean;
  quote: string;
};

export async function codeBehaviour(
  judge: Judge,
  args: {
    dimensionId: string;
    characterName: string;
    situation: string;
    observable: string;
    response: string;
  },
): Promise<BehaviourCoding | undefined> {
  const prompt = [
    `You are coding one response from a transcript against one specific behaviour. Answer only ` +
      `about what is present in the response itself.`,
    ``,
    `The situation the speaker was in:`,
    args.situation,
    ``,
    `What they said:`,
    `"${args.response}"`,
    ``,
    `The behaviour to code for:`,
    `  ${args.observable}`,
    ``,
    `Set "present" true only if the response clearly shows that behaviour. Hedging, changing the ` +
      `subject, asking a question instead, agreeing, or saying nothing of substance all mean the ` +
      `behaviour is absent. Do not reason about what sort of person would or would not do this — ` +
      `you know nothing about the speaker beyond the line quoted above. Code only what the words ` +
      `on the page show.`,
    `Quote the specific words that decided it, or leave "quote" empty when the behaviour is absent.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"present":true,"quote":"...","reasoning":"one short sentence"}`,
  ].join('\n');

  const parsed = await judge.ask(
    `behaviour/${args.dimensionId}/${args.characterName}`,
    prompt,
    BehaviourSchema,
  );
  if (!parsed) return undefined;
  return {
    characterName: args.characterName,
    dimensionId: args.dimensionId,
    present: parsed.present,
    quote: parsed.quote.trim(),
  };
}
