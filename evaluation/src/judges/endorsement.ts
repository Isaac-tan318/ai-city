// Which option did each participant actually come out in favour of?
//
// Component 3 needs one choice per NPC, but a live decision scenario records
// only the focal agent's final commitment — everybody else's position exists
// solely in what they said. Reading those positions out of the transcript is
// what turns one recorded decision into N choices, which is the difference
// between Option Coverage over a sample of one and Option Coverage as the
// framework defines it ("options selected by at least one NPC").
//
// One call per decision, not per participant: the whole point is to compare
// people against each other over the same menu, and a single call sees the
// disagreements between them.
import { z } from 'zod';
import type { Judge } from '../llm';

export const EndorsementSchema = z.object({
  endorsements: z
    .array(
      z.object({
        name: z.string(),
        // Empty string when they never came out for anything in particular.
        optionId: z.string().default(''),
        quote: z.string().default(''),
      }),
    )
    .default([]),
});

export type Endorsement = {
  name: string;
  optionId?: string;
  quote: string;
};

export async function codeEndorsements(
  judge: Judge,
  args: {
    scenarioId: string;
    scenarioName: string;
    participants: string[];
    options: { optionId: string; title: string; details: string }[];
    transcript: { author: string; text: string }[];
  },
): Promise<Endorsement[]> {
  if (args.options.length === 0 || args.participants.length === 0) return [];

  const prompt = [
    `A group discussed several options and you are recording where each person came down.`,
    ``,
    `The decision: ${args.scenarioName}`,
    ``,
    `The options that were on the table:`,
    ...args.options.map((o) => `  ${o.optionId} — ${o.title}: ${o.details}`),
    ``,
    `What they said to each other:`,
    ...args.transcript.map((m) => `${m.author}: ${m.text}`),
    ``,
    `For each of these people — ${args.participants.join(', ')} — report which option they came ` +
      `out in favour of.`,
    ``,
    `Count an endorsement when they argued for it, named it as their preference, or agreed to ` +
      `it in a way that showed it suited them. Do NOT count merely going along with the group, ` +
      `staying silent, or saying "whatever everyone wants" — leave "optionId" empty for those. ` +
      `Someone who was talked into an option they clearly did not want has not endorsed it.`,
    `Where a person shifted during the conversation, record where they ended up.`,
    `Include every person listed, using their EXACT name, even if their optionId is empty.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"endorsements":[{"name":"...","optionId":"...","quote":"the words that showed it"}]}`,
  ].join('\n');

  const parsed = await judge.ask(`endorsement/${args.scenarioId}`, prompt, EndorsementSchema);
  if (!parsed) return [];

  const valid = new Set(args.options.map((o) => o.optionId));
  const byName = new Map(args.participants.map((p) => [p.toLowerCase(), p]));
  const out: Endorsement[] = [];
  for (const e of parsed.endorsements) {
    const name = byName.get(e.name.trim().toLowerCase());
    if (!name) continue;
    out.push({
      name,
      optionId: valid.has(e.optionId) ? e.optionId : undefined,
      quote: e.quote.trim(),
    });
  }
  return out;
}
