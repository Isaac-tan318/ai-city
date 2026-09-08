# Human-simulation fidelity evaluator

A standalone program that scores recorded simulation data against the human-simulation fidelity
framework. It lives outside the simulation: it never writes to a world, and apart from
`convex/evaluator.ts` it is the only thing allowed to read the hidden ground truth in
`data/groundTruth.ts`.

It reuses the town's own LLM credentials — `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` from
`.env.keys`, resolved through the repo's `getLLMConfig()` so it can never drift from the model the
simulation itself used.

```bash
node evaluation/run.mjs help
```

> **Invoke it directly, not through `npm run eval -- ...`.** PowerShell strips a bare `--`
> separator, so npm never sees it, treats the following `--flags` as its own config, and hands the
> program a bare value with no flag in front of it. The npm script works from bash, and from
> PowerShell if you quote the separator (`npm run eval '--' analyze ...`), but
> `node evaluation/run.mjs` behaves the same in every shell.

## The two modes

**`analyze`** scores a recorded corpus. It accepts either input:

- **Chat-history JSON** — what the "Export JSON" button in the chat history viewer already
  downloads. Zero setup. Supports Components 1 and 4.
- **Bundle JSON** — the admin export (`convex/evaluationExport.ts`). Adds `scenarioId` per message,
  the full candidate menu, evaluations, and the short-term state log, which is what Components 3 and
  5 need.

```bash
node evaluation/run.mjs analyze --input evaluation/fixtures/sample-chat-history.json
node evaluation/run.mjs analyze --from-convex --limit 20
```

**`probe`** generates the controlled data Components 2 and 3 need. Organic town chat cannot support
either: a directional test requires the same situation put to characters who differ on one
attribute, and within-group diversity requires the same option set put to characters who share a
background. Neither happens by chance.

```bash
node evaluation/run.mjs probe --dimension conflict-avoidance --per-group 4 --skip-choice
node evaluation/run.mjs probe --skip-theory                 # just the choice probes
```

Two commands make **no LLM calls at all** and are worth running first, because the two things most
likely to be wrong are both checkable for free:

```bash
node evaluation/run.mjs classify      # which characters landed in which group
node evaluation/run.mjs neutrality    # did a hypothesis leak into an agent-facing prompt
```

## What each metric means

| Component                      | Metric                    | Direction | Where it comes from                              |
| ------------------------------ | ------------------------- | --------- | ------------------------------------------------ |
| 1 Persona fidelity             | PCR                       | higher    | graded opportunities from a transcript           |
|                                | HCCR                      | **0**     | the subset where an absolute constraint was live |
| 2 Theory-anchored plausibility | DCR                       | not 100%  | probe responses, coded blind                     |
| 3 Population diversity         | Option Coverage           | higher    | options endorsed by at least one NPC             |
|                                | WGDR                      | not ~0    | eligible same-background pairs                   |
| 4 Disclosure plausibility      | Relevant Disclosure       | higher    | constraints stated when relevant                 |
|                                | Premature Disclosure      | lower     | private facts volunteered unprompted             |
| 5 Dynamic-state validity       | State-Transition Accuracy | higher    | `shortTermEvents` vs the update rules            |
|                                | Unexpected Reset Rate     | **0**     | large jumps to baseline with no valid cause      |

There is deliberately **no composite score**. The framework's own assessment says to keep the
dimensions separate until an online policy needs a reward, and combining several fairness-flavoured
terms double-counts the same concern.

Every rate prints its denominator and a Wilson 95% interval, so a 100% built on three observations
cannot be mistaken for a result. A component the input cannot support prints as _skipped_, with the
reason — never as a rate over nothing.

## Tracing a number back to an utterance

The console output is a summary. Every run also writes `evaluation/out/<mode>-<timestamp>.json`,
which holds what each rate was computed from, so a surprising figure can be checked without paying
for the run again.

| Console line         | Where the detail lives                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PCR / HCCR           | `evidence.opportunities[]` — every counted moment, with `conversationId`, `messageIndex` and `why` it counted (the itemised denominator); `evidence.fidelity[]` — the verdict for each, with a quote |
| Relevant Disclosure  | `evidence.disclosure[]` — per constraint, whether it was said and the words that said it                                                                                                             |
| Premature Disclosure | `evidence.premature[]` — what was volunteered, and the judge's reasoning                                                                                                                             |
| DCR                  | `dimensions[].responses[]` — the verbatim line each NPC gave, its group, and the blind coder's boolean                                                                                               |
| WGDR                 | `choiceProbes[].choices[]` — per character, `feasibleOptionIds` and `choiceDetermined`, so an excluded pair is explicable                                                                            |
| Coverage             | `coverage.perDecision[]` and `withinGroup.exclusions`                                                                                                                                                |
| STA / URR            | `dynamicState.unexpectedResets[]`, with before/after values and cause                                                                                                                                |
| Aggregation          | `aggregation.comparisons[]` — each rule's winner and regret, per scenario                                                                                                                            |

The probe JSON is the most useful of these: a tied DCR is readable directly, by looking at what the
NPCs in each group actually said.

## How the honesty is enforced

**The LLM judges; TypeScript counts.** Same division of labour as `convex/evaluator.ts` and
`convex/scoring.ts`. Judges return categorical verdicts; every rate is computed in `src/metrics.ts`,
which is dependency-free and covered by `metrics.test.ts`. A model asked to compute its own rate
returns a number that disagrees with the verdicts it just gave.

**The denominator is set by a judge that does not know it is grading.** `judges/opportunities.ts`
finds the moments where a profile became relevant. Only then does `judges/personaFidelity.ts` see
that fixed list and grade it. One call doing both would quietly stop finding the moments it would
have to fail, which inflates PCR while looking perfectly reasonable.

**Grouping is deterministic, and happens before any response exists.** `theory/registry.ts`
classifies characters by pattern-matching the raw attribute value. No LLM is involved, so the
grouping is reproducible and cannot be influenced by the behaviour it is about to be compared
against. Run `node evaluation/run.mjs classify` to audit it.

**The behaviour coder is blind.** `judges/behaviourCoding.ts` sees the situation, the response, and
the behaviour to look for — never the profile, the group, or the hypothesis.

**Experimental unawareness is a type, not a promise.** Each dimension splits into `agentFacing`
(situation, ask, options) and `analysisOnly` (hypothesis, expected direction, citation, classifier).
`probe/runner.ts` takes an `AgentFacing` and has no parameter through which the rest could arrive.
`neutrality.ts` then checks the built prompts anyway, and fails if a group label, the observable, or
experimental vocabulary appears in experimenter-authored text. It deliberately does _not_ scan the
persona block: stating a profile attribute is allowed; stating the expected outcome is not.

## Adding a theory dimension

Append to `DIMENSIONS` in `src/theory/registry.ts`:

- `attribute` — a key that exists in `data/characters.ts` `profile` maps. Check coverage first; a
  key only half the cast carries gives thin groups.
- `observable` — a single-response act ("objects immediately, in this reply"), not a disposition
  ("is conflict-avoidant"). A disposition cannot be coded blind.
- `agentFacing.situation` — makes the attribute relevant without naming it.
- `analysisOnly.highPatterns` / `lowPatterns` — net hits decide the group; a tie leaves the
  character unclassified and out of the test.

Then run `classify` and `neutrality` before spending anything on a probe.

**Every entry currently carries `citation: 'TODO'`.** The directions are the conventional ones but
have not been traced to a source. Fill these in before reporting any DCR as a literature-anchored
result.

## Cost

Every judgement is cached under `evaluation/.cache`, keyed by a hash of model and prompt, so
re-running an unchanged corpus is free. `--limit` caps conversations, `--per-group` caps characters
per group, `--no-cache` forces fresh judgements, and `--concurrency` bounds parallel calls.

Rough shape: `analyze` costs about four calls per (conversation × speaker); a full seven-dimension
`probe` is about two calls per character per dimension.

## Layout

```
src/metrics.ts        PURE: every rate, Wilson intervals. Tested.
src/aggregation.ts    PURE: utilitarian / max-min / average-without-misery / Nash. Tested.
src/analyze.ts        the recorded-corpus pipeline
src/probe/            standardized-probe generation and pipeline
src/judges/           one LLM judgement each, all zod-validated
src/theory/           the dimension registry, choice probes, state update rules
src/corpus/           input schemas, normalization, the profile index
src/neutrality.ts     the prompt-neutrality lint
src/report.ts         console + JSON artifacts under evaluation/out
```
