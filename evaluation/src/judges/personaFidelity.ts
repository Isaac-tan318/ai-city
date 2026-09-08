// Pass 2: given an opportunity, did the person behave like their profile?
//
// Receives the opportunity list from pass 1 as a fixed input. It may grade each
// one, and it may abstain, but it cannot add or remove opportunities — the
// denominator was settled before this judge saw the question, which is the whole
// arrangement that keeps PCR and HCCR honest.
//
// Abstention is a first-class verdict rather than a failure. Some moments are
// genuinely ambiguous, and a judge forced to guess produces noise that reads as
// signal. The abstention rate is reported beside PCR so a high one is visible.
import { z } from 'zod';
import type { CharacterRecord } from '../corpus/profiles';
import { renderFullProfile } from '../corpus/profiles';
import type { Conversation } from '../corpus/normalize';
import type { GradedOpportunity } from '../metrics';
import type { Judge } from '../llm';
import { renderTranscript, type Opportunity } from './opportunities';

export const FidelitySchema = z.object({
  verdicts: z
    .array(
      z.object({
        index: z.number(),
        verdict: z.enum(['consistent', 'contradicts', 'unclear']).default('unclear'),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
});

export type FidelityJudgement = GradedOpportunity & {
  attribute: string;
  evidence: string;
};

export async function gradeOpportunities(
  judge: Judge,
  conversation: Conversation,
  character: CharacterRecord,
  opportunities: Opportunity[],
): Promise<FidelityJudgement[]> {
  // Disclosure opportunities are graded by judges/disclosure.ts, on a different
  // question. Grading them here too would double-count them in PCR.
  const gradable = opportunities.filter((o) => o.kind !== 'disclosure');
  if (gradable.length === 0) return [];

  const listed = gradable
    .map(
      (o, i) =>
        `  ${i}. [${o.kind === 'hardConstraint' ? 'ABSOLUTE CONSTRAINT' : 'trait'}] ` +
        `${o.attribute || '(unnamed)'} — became relevant because ${o.why || 'of the topic'}` +
        (o.messageIndex >= 0 ? ` (around line ${o.messageIndex})` : ''),
    )
    .join('\n');

  const prompt = [
    `You are judging whether one person in a conversation behaved consistently with what is ` +
      `known about them. You are given a fixed list of moments to judge. Judge exactly these ` +
      `moments — do not add any, do not skip any.`,
    ``,
    `The person: ${character.name}`,
    renderFullProfile(character),
    ``,
    `The conversation:`,
    renderTranscript(conversation),
    ``,
    `The moments to judge:`,
    listed,
    ``,
    `For each numbered moment, decide how ${character.name} actually behaved:`,
    `  "consistent"  — what they said (or their silence) fits the characteristic at stake.`,
    `  "contradicts" — what they said is incompatible with it. For an ABSOLUTE CONSTRAINT this ` +
      `means agreeing to, proposing, or accepting something the constraint forbids. Note that ` +
      `NOT MENTIONING a constraint is not a contradiction: staying quiet about a restriction is ` +
      `something real people do. Only actively going along with a violation counts.`,
    `  "unclear"     — the transcript genuinely does not settle it. Use this rather than guessing.`,
    ``,
    `Judge against the profile above, including the private facts, not against what would be ` +
      `polite or sensible in general.`,
    `Quote the words you relied on in "evidence", or leave it empty for a silence.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"verdicts":[{"index":0,"verdict":"consistent","evidence":"I only eat halal"}]}`,
  ].join('\n');

  const parsed = await judge.ask(
    `fidelity/${conversation.id}/${character.name}`,
    prompt,
    FidelitySchema,
  );
  if (!parsed) return [];

  const out: FidelityJudgement[] = [];
  for (const v of parsed.verdicts) {
    const opportunity = gradable[v.index];
    // A judge that invents an index is judging something that was not asked
    // about; dropping it is safer than mapping it onto the wrong opportunity.
    if (!opportunity) continue;
    out.push({
      characterName: character.name,
      conversationId: conversation.id,
      kind: opportunity.kind === 'hardConstraint' ? 'hardConstraint' : 'persona',
      verdict: v.verdict,
      attribute: opportunity.attribute,
      evidence: v.evidence.trim(),
    });
  }
  // Anything the judge silently skipped is an abstention, not a free pass.
  for (let i = 0; i < gradable.length; i++) {
    if (parsed.verdicts.some((v) => v.index === i)) continue;
    out.push({
      characterName: character.name,
      conversationId: conversation.id,
      kind: gradable[i].kind === 'hardConstraint' ? 'hardConstraint' : 'persona',
      verdict: 'unclear',
      attribute: gradable[i].attribute,
      evidence: '(judge returned no verdict for this moment)',
    });
  }
  return out;
}
