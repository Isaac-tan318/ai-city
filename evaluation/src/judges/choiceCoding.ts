// Component 3's eligibility filter, and the fallback for reading a choice.
//
// The framework is strict about which pairs may count toward Within-Group
// Diversity: both NPCs must have more than one feasible option, no hard
// constraint may determine the answer, and no profile field may already name a
// preference for one of the candidates. Without that filter WGDR measures
// constraint satisfaction and calls it diversity — three Muslims all declining
// the bar is not a homogeneity finding, it is the constraint working.
//
// Feasibility is judged against ground truth, so this is a judge-only path.
import { z } from 'zod';
import type { CharacterRecord } from '../corpus/profiles';
import { renderSelfView, renderTruthView } from '../corpus/profiles';
import type { Judge } from '../llm';

export const FeasibilitySchema = z.object({
  options: z
    .array(
      z.object({
        optionId: z.string(),
        // False only when an ABSOLUTE constraint rules it out.
        feasible: z.boolean().default(true),
        violates: z.string().default(''),
        // True when a profile field names this option or its category outright,
        // so the choice was written into the persona rather than made.
        namedByProfile: z.boolean().default(false),
      }),
    )
    .default([]),
});

export type OptionFeasibility = {
  optionId: string;
  feasible: boolean;
  violates: string;
  namedByProfile: boolean;
};

export async function assessFeasibility(
  judge: Judge,
  character: CharacterRecord,
  options: { optionId: string; title: string; details: string }[],
): Promise<OptionFeasibility[]> {
  const prompt = [
    `You are working out which of several options one person could actually take, and which of ` +
      `them their written profile already picks out for them.`,
    ``,
    `The person:`,
    renderSelfView(character.self),
    character.truth ? '\nPrivate facts about them:' : '',
    character.truth ? renderTruthView(character.truth) : '',
    ``,
    `The options:`,
    ...options.map((o) => `  ${o.optionId} — ${o.title}: ${o.details}`),
    ``,
    `For each option report two things.`,
    ``,
    `"feasible": false ONLY when an ABSOLUTE constraint rules it out — a religious rule, a ` +
      `medical or allergy limit, a legal restriction, or a physical impossibility for them. ` +
      `Disliking something, finding it expensive, or preferring something else does NOT make it ` +
      `infeasible. Most options are feasible for most people; say so.`,
    `When false, quote the constraint in "violates".`,
    ``,
    `"namedByProfile": true when a field in their profile explicitly names this option or the ` +
      `exact category it belongs to, so that reading the profile tells you what they would ` +
      `choose without any thought. A profile saying "Hobby: cycling" names a cycling option. A ` +
      `profile saying "Personality: sociable" does not name any of these — it is a disposition, ` +
      `not a preference for a candidate. Be strict: when in doubt, false.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"options":[{"optionId":"...","feasible":true,"violates":"","namedByProfile":false}]}`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const parsed = await judge.ask(`feasibility/${character.name}`, prompt, FeasibilitySchema);
  // Without a judgement, assume every option is feasible and none is named.
  // That keeps pairs eligible, which is the direction that cannot manufacture a
  // flattering WGDR: it can only add pairs that may then agree.
  return options.map((o) => {
    const found = parsed?.options.find((p) => p.optionId === o.optionId);
    return {
      optionId: o.optionId,
      feasible: found?.feasible ?? true,
      violates: found?.violates.trim() ?? '',
      namedByProfile: found?.namedByProfile ?? false,
    };
  });
}

export const ChoiceSchema = z.object({
  optionId: z.string().default(''),
  reason: z.string().default(''),
});

// Read an option id out of a free-text reply. The probe asks for JSON and this
// handles it directly; the LLM fallback is only for a reply that ignored the
// format, which is common enough to be worth one extra call rather than a lost
// datapoint.
export function parseChoiceDirect(response: string, optionIds: string[]): string | undefined {
  const trimmed = response.trim();
  try {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
      const parsed = JSON.parse(trimmed.slice(first, last + 1));
      if (typeof parsed.optionId === 'string' && optionIds.includes(parsed.optionId)) {
        return parsed.optionId;
      }
    }
  } catch {
    // Fall through to the plain-text scan.
  }
  // A reply that just says the id, or names it in a sentence.
  const lower = trimmed.toLowerCase();
  const hits = optionIds.filter((id) => lower.includes(id.toLowerCase()));
  return hits.length === 1 ? hits[0] : undefined;
}

export async function extractChoice(
  judge: Judge,
  args: { characterName: string; response: string; options: { optionId: string; title: string }[] },
): Promise<string | undefined> {
  const direct = parseChoiceDirect(
    args.response,
    args.options.map((o) => o.optionId),
  );
  if (direct) return direct;

  const prompt = [
    `Read this reply and say which single option it picks.`,
    ``,
    `The options:`,
    ...args.options.map((o) => `  ${o.optionId} — ${o.title}`),
    ``,
    `The reply:`,
    `"${args.response}"`,
    ``,
    `Return the optionId they chose. If the reply genuinely does not commit to one of them, ` +
      `return an empty string rather than guessing.`,
    ``,
    `Reply with ONLY strict JSON, no prose:`,
    `{"optionId":"...","reason":"..."}`,
  ].join('\n');

  const parsed = await judge.ask(`choice/${args.characterName}`, prompt, ChoiceSchema);
  const id = parsed?.optionId.trim();
  return id && args.options.some((o) => o.optionId === id) ? id : undefined;
}
