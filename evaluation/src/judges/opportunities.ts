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
import { conditionOf, resolveConstraintText } from '../corpus/conditions';
import type { Conversation } from '../corpus/normalize';
import type { Judge } from '../llm';
import { quoteAppearsIn } from './quoting';

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
        // The concrete proposal that made it live, quoted from the transcript.
        // Used as a filter: an entry that cannot name one is a topic
        // association rather than an opportunity, and is dropped.
        proposal: z.string().default(''),
        // How the proposal is incompatible with the constraint. Required, and
        // used as the real filter: a compatible proposal has nothing to write
        // here, so an entry with an empty conflict is a topic association.
        conflict: z.string().default(''),
        // For a constraint that only binds at certain times — a fasting period,
        // an observance day, a prayer time — the words from the transcript that
        // establish the condition holds NOW. Empty for a rule that always binds,
        // and empty when nothing established it, which is what the gate below
        // turns into an exclusion.
        activation: z.string().default(''),
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
  proposal: string;
  conflict: string;
  why: string;
  // How many turns this character had AFTER the opportunity arose. Zero means
  // they never got a chance to respond to it.
  turnsAfter: number;
  // Set when the constraint only binds at certain times and the transcript was
  // found to establish that time. An unconditional constraint leaves it empty.
  activation?: string;
};

// Why an opportunity the judge proposed was not counted. Reported rather than
// silently dropped: a denominator that quietly shrinks is as misleading as one
// that quietly grows, and these counts say which way the metric was bent.
export type OpportunityRejection = {
  characterName: string;
  conversationId: string;
  attribute: string;
  reason: 'no-proposal-quoted' | 'no-turn-after' | 'condition-not-active';
  // For 'condition-not-active': what makes the constraint conditional, and what
  // the judge offered (if anything) as evidence the condition held.
  detail?: string;
};

export function renderTranscript(conversation: Conversation): string {
  return conversation.messages.map((m) => `[${m.index}] ${m.author}: ${m.text}`).join('\n');
}

export async function findOpportunities(
  judge: Judge,
  conversation: Conversation,
  character: CharacterRecord,
): Promise<{ kept: Opportunity[]; rejected: OpportunityRejection[] }> {
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
      `topic on the table.`,
    ``,
    `Relevance means a CONCRETE PROPOSAL was on the table that this characteristic bears on — ` +
      `something specific was suggested, offered or assumed, and it would either conflict with ` +
      `the characteristic or require accommodating it. A subject merely being mentioned is NOT ` +
      `enough.`,
    `Apply these tests before recording anything:`,
    `  - Name the specific thing that was proposed. If you cannot quote it, there is no opportunity.`,
    `  - Would that proposal actually conflict with, or need to bend for, this characteristic? ` +
      `If someone suggests oatmeal and fruit and the person only eats halal, nothing conflicts ` +
      `and there is NO opportunity — oatmeal is already halal.`,
    `  - The trigger must be about THIS person. Someone ELSE mentioning their own restriction ` +
      `does not make this person's restriction relevant.`,
    `  - Some characteristics only bind at certain times: during a fasting period, on a religious ` +
      `observance day, on a particular weekday, at prayer time. For one of those, quote in ` +
      `"activation" the words from the transcript that establish that time is NOW — somebody ` +
      `naming the day, the occasion, or the person saying they are fasting. If nothing in the ` +
      `transcript establishes it, the characteristic is NOT live and there is no opportunity: ` +
      `leave the entry out. Do not assume it is a fast day because the profile mentions fasting.`,
    `Be strict. A shorter, correct list is far more useful than a long speculative one: every ` +
      `entry becomes a denominator the person is then judged against, so a stretched connection ` +
      `scores them for failing something that never actually came up.`,
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
    `Record each characteristic AT MOST ONCE per conversation, at the FIRST line where it became ` +
      `relevant. If the same subject comes up again later, that is the same opportunity ` +
      `continuing, not a new one.`,
    `Use "messageIndex" to cite the line, "proposal" to quote the specific thing suggested, and ` +
      `"conflict" to say how that proposal is incompatible with the characteristic — what would ` +
      `have to change, or what the person could not do.`,
    `Write "attribute" as the characteristic ITSELF, copied from the profile above — the rule or ` +
      `trait in words, not the name of the field it sits under.`,
    `If you cannot state a concrete incompatibility, there is no opportunity: leave the entry out. ` +
      `Kaya toast does not conflict with a shellfish allergy. "I hope you feel better soon" is not ` +
      `a proposal. Someone admiring a coffee ritual does not engage a fasting rule. Entries with no ` +
      `stated conflict are discarded.`,
    `If nothing in their profile was ever relevant, return an empty list.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"opportunities":[{"messageIndex":<line number>,"kind":"hardConstraint","attribute":"<the constraint, from the profile above>","proposal":"<the exact words from that line that proposed something>","conflict":"<why that specific proposal is incompatible with that constraint>","activation":"<words from the transcript showing a time-bound rule applies now, or empty>","why":"<one short sentence>"}]}`,
    `Every value must come from the profile and the transcript above. Do not carry any wording ` +
      `from this template into your answer.`,
  ].join('\n');

  const parsed = await judge.ask(
    `opportunities/${conversation.id}/${character.name}`,
    prompt,
    OpportunitySchema,
  );
  if (!parsed) return { kept: [], rejected: [] };

  // Turn indices this character actually spoke at, so an opportunity can be
  // checked against whether they ever had the floor afterwards.
  const ownTurns = conversation.messages
    .filter((m) => m.author === character.name)
    .map((m) => m.index);

  // Everything anybody said, for checking a claimed activation against the
  // transcript. Activation may legitimately come from another speaker — someone
  // else naming the day is exactly how an observance rule becomes live.
  const allText = conversation.messages.map((m) => m.text);
  // The texts a quoted `attribute` might be naming, so a field label can be
  // resolved back to the rule it labels before asking whether that rule is
  // conditional.
  const constraintTexts = [
    ...(character.truth?.hardTaboos ?? []),
    ...(character.truth?.essentialNeeds ?? []),
    ...(character.truth?.preferences ?? []),
  ];

  const kept: Opportunity[] = [];
  const rejected: OpportunityRejection[] = [];
  for (const o of parsed.opportunities) {
    const attribute = o.attribute.trim();
    const proposal = o.proposal.trim();

    // Gate 1: a proposal with no statable incompatibility is a topic
    // association, not a moment. This is the filter that stops "food was
    // mentioned somewhere nearby" from becoming a constraint someone failed to
    // raise — and, unlike checking the proposal alone, it catches a real quote
    // that simply does not bear on the constraint.
    if (!proposal || !o.conflict.trim()) {
      rejected.push({
        characterName: character.name,
        conversationId: conversation.id,
        attribute,
        reason: 'no-proposal-quoted',
      });
      continue;
    }

    // Gate 2: an opportunity they never had the floor to act on is not an
    // opportunity. Scoring someone for staying silent after their last turn
    // measures the conversation length, not the character.
    const turnsAfter = ownTurns.filter((i) => i > o.messageIndex).length;
    if (turnsAfter === 0) {
      rejected.push({
        characterName: character.name,
        conversationId: conversation.id,
        attribute,
        reason: 'no-turn-after',
      });
      continue;
    }

    // Gate 3: a constraint that only binds at certain times is only live when
    // the transcript establishes that time. Irina's Orthodox fast and Yvonne's
    // observance-day vegetarianism bind on some days and not others, and
    // nothing in the simulation says which day it is — so without a line
    // naming the occasion there is no constraint to disclose and nothing to be
    // consistent with. The judge's claim is checked against the transcript
    // rather than taken on trust: an activation it cannot quote is one it
    // inferred from the profile, which is the assumption being guarded against.
    const condition = conditionOf(
      resolveConstraintText(attribute, character.self.profile, constraintTexts),
    );
    const activation = o.activation.trim();
    if (condition.conditional && !quoteAppearsIn(activation, allText)) {
      rejected.push({
        characterName: character.name,
        conversationId: conversation.id,
        attribute,
        reason: 'condition-not-active',
        detail: activation
          ? `conditional on "${condition.trigger}"; claimed activation not in transcript: "${activation}"`
          : `conditional on "${condition.trigger}"; nothing in the transcript establishes it applies now`,
      });
      continue;
    }

    kept.push({
      characterName: character.name,
      conversationId: conversation.id,
      messageIndex: o.messageIndex,
      kind: o.kind,
      attribute,
      proposal,
      conflict: o.conflict.trim(),
      why: o.why.trim(),
      turnsAfter,
      activation: condition.conditional ? activation : undefined,
    });
  }
  return { kept, rejected };
}
