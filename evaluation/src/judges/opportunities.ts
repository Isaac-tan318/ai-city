// Pass 1: where in this conversation did the person's profile become relevant?
//
// This judge produces the DENOMINATOR for Persona Fidelity and Relevant
// Disclosure, and it is deliberately kept ignorant of the verdict it is feeding.
// It is asked only "did this topic come up, and was this constraint or trait
// live at that point" — never "did they behave correctly". Ask one call to both
// find opportunities and grade them and it will quietly stop finding the ones it
// would have to fail, which inflates every rate downstream while looking
// perfectly reasonable in the output.
//
// The split costs one extra call per (conversation x participant). That is the
// price of a denominator that means something.
import { z } from 'zod';
import type { CharacterRecord } from '../corpus/profiles';
import { renderFullProfile } from '../corpus/profiles';
import type { Conversation } from '../corpus/normalize';
import type { Judge } from '../llm';

export const OpportunitySchema = z.object({
  opportunities: z
    .array(
      z.object({
        // Which line of the transcript made it live. -1 when the whole
        // conversation was about it rather than one line.
        messageIndex: z.number().default(-1),
        // 'persona' for an authored trait or preference, 'hardConstraint' for an
        // absolute religious / medical / legal restriction, 'disclosure' for a
        // private fact that a reasonable person would have mentioned by now.
        kind: z.enum(['persona', 'hardConstraint', 'disclosure']).default('persona'),
        // The specific trait or constraint at stake, quoted from the profile.
        attribute: z.string().default(''),
        why: z.string().default(''),
      }),
    )
    .default([]),
});

export type Opportunity = {
  characterName: string;
  conversationId: string;
  messageIndex: number;
  kind: 'persona' | 'hardConstraint' | 'disclosure';
  attribute: string;
  why: string;
};

export function renderTranscript(conversation: Conversation): string {
  return conversation.messages.map((m) => `[${m.index}] ${m.author}: ${m.text}`).join('\n');
}

export async function findOpportunities(
  judge: Judge,
  conversation: Conversation,
  character: CharacterRecord,
): Promise<Opportunity[]> {
  const prompt = [
    `You are reading a transcript of a conversation and identifying the moments where one ` +
      `particular person's known characteristics became RELEVANT to what was being discussed.`,
    ``,
    `The person: ${character.name}`,
    renderFullProfile(character),
    ``,
    `The conversation:`,
    renderTranscript(conversation),
    ``,
    `List every point at which something in ${character.name}'s profile became relevant to the ` +
      `topic on the table. A characteristic is relevant when the conversation reached a subject ` +
      `it bears on — food came up and they have a dietary rule, cost came up and they have a ` +
      `budget ceiling, a plan was proposed and they need it fixed in advance.`,
    ``,
    `Classify each one:`,
    `  "hardConstraint" — an absolute restriction was at stake: a religious rule, a medical or ` +
      `allergy limit, a legal restriction. Only the ABSOLUTE constraints listed above count. A ` +
      `strong dislike or an over-budget option is NOT a hard constraint.`,
    `  "disclosure" — a private fact about them was relevant and a reasonable person in their ` +
      `position would have had a natural opening to mention it.`,
    `  "persona" — an authored trait, preference or communication style was relevant.`,
    ``,
    `An opportunity exists whether or not ${character.name} said anything at that point. Silence ` +
      `where the subject was clearly on the table is still an opportunity. Report the moment, ` +
      `not what they did with it.`,
    `Use "messageIndex" to cite the line that made it relevant, or -1 if the whole conversation did.`,
    `If nothing in their profile was ever relevant, return an empty list.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"opportunities":[{"messageIndex":3,"kind":"hardConstraint","attribute":"only eats halal","why":"the group started choosing between restaurants"}]}`,
  ].join('\n');

  const parsed = await judge.ask(
    `opportunities/${conversation.id}/${character.name}`,
    prompt,
    OpportunitySchema,
  );
  if (!parsed) return [];
  return parsed.opportunities.map((o) => ({
    characterName: character.name,
    conversationId: conversation.id,
    messageIndex: o.messageIndex,
    kind: o.kind,
    attribute: o.attribute.trim(),
    why: o.why.trim(),
  }));
}
