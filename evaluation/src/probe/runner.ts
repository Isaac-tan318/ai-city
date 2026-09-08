// Puts one NPC in one standardized situation and records what it says.
//
// This is where Experimental Unawareness is enforced rather than promised. The
// function takes an `AgentFacing` — a situation, an ask, and options — and has
// no parameter through which a hypothesis, an expected direction, a metric name
// or a group label could arrive. The Dimension those fields belong to is never
// passed in. An NPC here is given exactly what the simulation gives its agents:
// its own identity, its own structured background, and the situation in front of
// it.
//
// The prompt that was actually sent is returned alongside the response so
// neutrality.ts can check it rather than take this comment's word for it.
import { z } from 'zod';
import type { AgentFacing } from '../theory/registry';
import type { CharacterRecord } from '../corpus/profiles';
import { renderSelfView } from '../corpus/profiles';
import type { Judge } from '../llm';

export const OpenResponseSchema = z.object({ say: z.string().default('') });
export const ChoiceResponseSchema = z.object({
  optionId: z.string().default(''),
  reason: z.string().default(''),
});

export type ProbeResult = {
  characterName: string;
  probeId: string;
  prompt: string;
  response: string;
  chosenOptionId?: string;
};

// Build the NPC-facing prompt. Exported so the neutrality lint can construct one
// for every character and dimension and scan it, without spending a call.
export function buildProbePrompt(character: CharacterRecord, facing: AgentFacing): string {
  const lines = [renderSelfView(character.self), '', 'The situation:', facing.situation];
  if (facing.options.length > 0) {
    lines.push('', 'The options:');
    for (const o of facing.options) lines.push(`  ${o.optionId} — ${o.title}: ${o.details}`);
  }
  lines.push(
    '',
    `Answer as ${character.self.name}, in character, the way you would actually respond in the ` +
      `moment. Do not narrate, explain yourself, or describe your own personality.`,
    facing.ask,
  );
  return lines.join('\n');
}

export async function runProbe(
  judge: Judge,
  character: CharacterRecord,
  probeId: string,
  facing: AgentFacing,
): Promise<ProbeResult | undefined> {
  const prompt = buildProbePrompt(character, facing);

  if (facing.options.length > 0) {
    const parsed = await judge.ask(
      `probe/${probeId}/${character.name}`,
      prompt,
      ChoiceResponseSchema,
    );
    if (!parsed) return undefined;
    const valid = facing.options.some((o) => o.optionId === parsed.optionId);
    return {
      characterName: character.name,
      probeId,
      prompt,
      response: `${parsed.optionId}: ${parsed.reason}`,
      // An id the NPC invented is dropped rather than coerced onto the nearest
      // real option — a fabricated choice would land in the diversity numerator.
      chosenOptionId: valid ? parsed.optionId : undefined,
    };
  }

  const parsed = await judge.ask(`probe/${probeId}/${character.name}`, prompt, OpenResponseSchema);
  if (!parsed || !parsed.say.trim()) return undefined;
  return { characterName: character.name, probeId, prompt, response: parsed.say.trim() };
}
