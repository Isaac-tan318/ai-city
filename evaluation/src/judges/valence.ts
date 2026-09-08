// Was this conversation a good one or a bad one?
//
// The only judgement Component 5 needs. Every other expected direction in
// theory/stateRules.ts can be read straight off the event log — work raises
// fatigue, a meal lowers hunger — but the Feelings line at the end of a
// conversation is supposed to move mood and stress according to how the
// conversation went, and "how it went" is not in the log.
//
// Judged from the transcript alone, with no reference to the gauges that
// followed. Showing the judge the mood delta it is about to validate would make
// the check circular.
import { z } from 'zod';
import type { Conversation } from '../corpus/normalize';
import type { Judge } from '../llm';

export const ValenceSchema = z.object({
  valence: z.enum(['positive', 'negative', 'neutral']).default('neutral'),
  reasoning: z.string().default(''),
});

export type Valence = 'positive' | 'negative' | 'neutral';

export async function judgeValence(
  judge: Judge,
  conversation: Conversation,
  forCharacter: string,
): Promise<Valence | undefined> {
  const prompt = [
    `Read this conversation and say how it is likely to have left ONE particular participant ` +
      `feeling.`,
    ``,
    `The participant: ${forCharacter}`,
    ``,
    `The conversation:`,
    conversation.messages.map((m) => `${m.author}: ${m.text}`).join('\n'),
    ``,
    `Answer with one of:`,
    `  "positive" — they are likely to come away in better spirits: warmth, agreement, ` +
      `being listened to, something settled in their favour.`,
    `  "negative" — worse spirits: friction, being overruled or ignored, an unwelcome outcome, ` +
      `an awkward exchange.`,
    `  "neutral"  — ordinary, transactional, or too short to tell. Use this freely; most ` +
      `passing exchanges are neutral.`,
    ``,
    `Judge from ${forCharacter}'s point of view, not the group's.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"valence":"neutral","reasoning":"one short sentence"}`,
  ].join('\n');

  const parsed = await judge.ask(
    `valence/${conversation.id}/${forCharacter}`,
    prompt,
    ValenceSchema,
  );
  return parsed?.valence;
}
