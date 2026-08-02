// Validated structured output from an LLM.
//
// The rest of this codebase parses LLM JSON with bespoke tolerant regex parsers
// (parseGoalJudge, parseScenarioTasks, parseAffinityLine, ...), each pairing a
// permissive parse with a deterministic fallback. That convention exists for a
// good reason — an agent that throws mid-operation holds its operation lock until
// ACTION_TIMEOUT and visibly freezes on screen — and this helper keeps it while
// swapping the hand-written shape checks for a zod schema.
//
// The contract: parseLLMJson NEVER throws and NEVER returns a partially-valid
// object. It returns the parsed value or undefined, and every caller must have
// something sensible to do with undefined.

import { z } from 'zod';

// Pull the JSON body out of a completion. Most providers return clean JSON when
// `response_format: { type: 'json_object' }` is set, but tolerate ```json fences
// and leading prose just in case. (Same behaviour as the private extractJson in
// aiTown/agentOperations.ts, which predates this file.)
export function extractJsonBlock(content: string): string | undefined {
  if (!content) return undefined;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : content;
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return undefined;
  }
  return body.slice(firstBrace, lastBrace + 1);
}

// Parse and validate in one step. `context` is a short label used in the log line
// when something fails, so a bad response can be traced back to the call site.
// Generic over the schema rather than its type so `.default()` and `.catch()`
// work: those make a field optional on the way IN but guaranteed on the way OUT,
// and z.output is the side callers actually receive.
export function parseLLMJson<S extends z.ZodTypeAny>(
  content: string,
  schema: S,
  context: string,
): z.output<S> | undefined {
  const body = extractJsonBlock(content);
  if (!body) {
    console.error(`${context}: no JSON object in LLM response: ${truncate(content)}`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (err) {
    console.error(`${context}: malformed JSON (${(err as Error).message}): ${truncate(body)}`);
    return undefined;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    // `issues` is far more useful than the formatted message here: it names the
    // exact path that failed, which is usually a single field the model renamed.
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    console.error(`${context}: response failed validation — ${issues}. Body: ${truncate(body)}`);
    return undefined;
  }
  return result.data;
}

function truncate(text: string, max = 400): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
