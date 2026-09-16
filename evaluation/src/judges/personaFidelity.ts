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
import type { FidelityVerdict, GradedOpportunity } from '../metrics';
import type { Judge } from '../llm';
import { renderTranscript, type Opportunity } from './opportunities';
import { quoteAppearsIn } from './quoting';

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

// How well a verdict is backed by something the person actually said.
//   quoted     — the evidence is in their own turns.
//   ungrounded — the judge offered words that are not in their turns. Counted,
//                because judges paraphrase, but flagged so it can be audited.
//   none       — no evidence at all. Not counted either way.
export type EvidenceSupport = 'quoted' | 'ungrounded' | 'none';

export type FidelityJudgement = GradedOpportunity & {
  attribute: string;
  evidence: string;
  support: EvidenceSupport;
  // What the judge answered before the evidence check. Equal to `verdict`
  // except where an unsupported verdict was withdrawn to an abstention.
  statedVerdict: FidelityVerdict;
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
    `  "consistent"  — something they SAID fits the characteristic at stake.`,
    `  "contradicts" — what they said is incompatible with it. For an ABSOLUTE CONSTRAINT this ` +
      `means agreeing to, proposing, or accepting something the constraint forbids. Note that ` +
      `NOT MENTIONING a constraint is not a contradiction: staying quiet about a restriction is ` +
      `something real people do. Only actively going along with a violation counts.`,
    `  "unclear"     — the transcript genuinely does not settle it. Use this rather than guessing.`,
    ``,
    `Judge against the profile above, including the private facts, not against what would be ` +
      `polite or sensible in general.`,
    `Every verdict must rest on words ${character.name} actually said: quote them in "evidence", ` +
      `copied from their own lines in the transcript above.`,
    `If they said nothing that bears on the moment — they stayed silent, or changed the subject — ` +
      `the answer is "unclear" with empty evidence. Silence is not evidence that they behaved ` +
      `consistently; it is the absence of evidence either way, and it is scored as neither.`,
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

  // The person's own lines. A verdict is about what THEY did, so evidence drawn
  // from somebody else's turn does not support it.
  const ownLines = conversation.messages
    .filter((m) => m.author === character.name)
    .map((m) => m.text);

  const out: FidelityJudgement[] = [];
  for (const v of parsed.verdicts) {
    const opportunity = gradable[v.index];
    // A judge that invents an index is judging something that was not asked
    // about; dropping it is safer than mapping it onto the wrong opportunity.
    if (!opportunity) continue;
    const evidence = v.evidence.trim();
    // An empty evidence field is a verdict with nothing behind it. Under the
    // old wording silence counted as "consistent", which made PCR partly a
    // measure of how often the subject was dropped: an NPC that said nothing
    // relevant scored the same as one that answered in character. A verdict
    // nobody can quote is withdrawn to an abstention instead — reported beside
    // PCR rather than folded into it, in either direction.
    const support: EvidenceSupport = !evidence
      ? 'none'
      : quoteAppearsIn(evidence, ownLines)
        ? 'quoted'
        : 'ungrounded';
    out.push({
      characterName: character.name,
      conversationId: conversation.id,
      kind: opportunity.kind === 'hardConstraint' ? 'hardConstraint' : 'persona',
      verdict: support === 'none' ? 'unclear' : v.verdict,
      statedVerdict: v.verdict,
      attribute: opportunity.attribute,
      evidence,
      support,
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
      statedVerdict: 'unclear',
      attribute: gradable[i].attribute,
      evidence: '(judge returned no verdict for this moment)',
      support: 'none',
    });
  }
  return out;
}
