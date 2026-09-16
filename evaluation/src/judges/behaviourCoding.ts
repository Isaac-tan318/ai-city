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

// Three levels, not a boolean.
//
// The binary version collapsed the entire signal. Asked to split a bill
// unfairly, every character objected — but the conflict-avoidant ones objected
// as "I appreciate the suggestion, but perhaps we could consider what each of us
// had", and the direct ones as "it's only fair we pay for what we ordered".
// Both are "an objection"; they are not the same behaviour, and coding them
// alike produced a 100%-vs-100% tie that said nothing.
//
// So the coder grades intensity and the dimension declares which level counts.
export const BEHAVIOUR_LEVELS = ['absent', 'hedged', 'explicit'] as const;
export type BehaviourLevel = (typeof BEHAVIOUR_LEVELS)[number];

export const BehaviourSchema = z.object({
  level: z.enum(BEHAVIOUR_LEVELS).default('absent'),
  quote: z.string().default(''),
  reasoning: z.string().default(''),
});

export type BehaviourCoding = {
  characterName: string;
  dimensionId: string;
  level: BehaviourLevel;
  // Whether the level met the dimension's threshold. This is what DCR counts.
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
    // The lowest level that counts as the behaviour being present. 'explicit'
    // for dimensions where hedging is the interesting contrast; 'hedged' where
    // any form of the behaviour is what the theory predicts.
    threshold: BehaviourLevel;
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
    `First decide whether the behaviour named above happened AT ALL, then how strongly:`,
    `  "absent"   — the behaviour did not occur. This INCLUDES a reply that does the OPPOSITE of ` +
      `it, however firmly or eloquently that opposite is expressed: a confident, well-argued ` +
      `refusal is an absent instance of accepting. Grade the behaviour named above, not how ` +
      `articulate the speaker was. Also absent: going along with it, changing the subject, saying ` +
      `nothing of substance, or an empty reply.`,
    `  "hedged"   — the behaviour occurred, but softened: wrapped in apology or appreciation, put as a ` +
      `question, deflected onto the group or a process ("could we check with everyone?"), or ` +
      `stated so indirectly that someone could miss it. The speaker is not quite owning it.`,
    `  "explicit" — the behaviour occurred plainly and in their own voice, unmistakable to ` +
      `everyone present.`,
    `Check before answering that you are not grading the force of the reply in place of the ` +
      `presence of the behaviour. Those come apart constantly.`,
    `The difference between "hedged" and "explicit" is the whole point of this coding, so weigh it ` +
      `carefully. "I appreciate the suggestion, but perhaps we could consider..." is hedged. ` +
      `"It's only fair we pay for what we ordered" is explicit.`,
    `Do not reason about what sort of person would or would not do this — you know nothing about ` +
      `the speaker beyond the line quoted above. Code only what the words on the page show.`,
    `Quote the specific words that decided it, or leave "quote" empty when the behaviour is absent.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"level":"explicit","quote":"...","reasoning":"one short sentence"}`,
  ].join('\n');

  const parsed = await judge.ask(
    `behaviour/${args.dimensionId}/${args.characterName}`,
    prompt,
    BehaviourSchema,
  );
  if (!parsed) return undefined;
  const rank = (l: BehaviourLevel) => BEHAVIOUR_LEVELS.indexOf(l);
  return {
    characterName: args.characterName,
    dimensionId: args.dimensionId,
    level: parsed.level,
    present: rank(parsed.level) >= rank(args.threshold),
    quote: parsed.quote.trim(),
  };
}
