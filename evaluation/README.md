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

## What counts as one observation

Four rules decide what goes in a denominator, and all four exist because the naive reading of
"an opportunity" inflates one.

**One constraint, one conversation, one case.** A transcript where grilled meat is proposed on six
consecutive turns puts Ratna's halal rule on the table _once_. `collapseDisclosureEpisodes` folds
repeats of the same constraint, for the same person, in the same conversation into a single episode
anchored at the first opportunity; it counts as disclosed if she stated it anywhere in the
conversation. Counting each mention separately does not measure her six times — it counts one
behaviour six times and then reports a Wilson interval as though six independent observations had
been made. The report prints how many repeats were folded.

**A conditional constraint is only live when its condition is.** Irina avoids animal products
_during Orthodox fasting periods_; Yvonne is vegetarian _on Buddhist observance days_. Nothing in
the simulation models a fasting calendar, so `corpus/conditions.ts` classifies these rules from
their own wording and the opportunity judge must quote the words in the transcript that establish
the occasion is now. An activation it cannot quote is one it inferred from the profile, and the
opportunity is discarded with reason `condition-not-active` — named in the report, not just
counted. A rule with an unconditional half (`Avoids beef; vegetarian on prayer days`) stays ungated:
hiding a rule that binds every day is the worse error.

**A disclosure has to be actionable.** The disclosure judge codes how clearly the constraint came
across — `explicit`, `actionable`, `preference-only`, `not-stated` — and only the first two count.
"I'd prefer soto or tempeh" tells a group what someone would enjoy and leaves them free to book the
place where she cannot eat; scoring it as a successful disclosure of a halal requirement measures
politeness, not information flow. Downgraded cases are listed in the report with what was actually
said.

**A verdict with nothing quoted behind it is an abstention.** Persona fidelity used to accept
silence as evidence of consistency, which made part of PCR a measure of how often the subject was
dropped. A verdict whose evidence field is empty is now withdrawn to `unclear` — excluded from both
PCR and HCCR, in either direction — and the withdrawal is reported beside the abstention rate.
Quotes are checked against the speaker's own turns (`judges/quoting.ts`); one that cannot be found
there is still counted but flagged as unverifiable, because judges paraphrase and a false rejection
would throw away a real verdict.

## Tracing a number back to an utterance

The console output is a summary. Every run also writes `evaluation/out/<mode>-<timestamp>.json`,
which holds what each rate was computed from, so a surprising figure can be checked without paying
for the run again.

| Console line         | Where the detail lives                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PCR / HCCR           | `evidence.opportunities[]` — every counted moment, with `conversationId`, `messageIndex` and `why` it counted (the itemised denominator); `evidence.rejectedOpportunities[]` — every moment a gate threw out, and why; `evidence.fidelity[]` — the verdict for each, with its quote, `support` and the `statedVerdict` before any withdrawal |
| Relevant Disclosure  | `disclosure.episodes[]` — the collapsed cases the rate is over, with `occurrences`; `evidence.disclosure[]` — per mention, `conveys`, the quote, and any `downgradedBecause`                          |
| Premature Disclosure | `evidence.premature[]` — what was volunteered, and the judge's reasoning                                                                                                                             |
| DCR                  | `dimensions[].responses[]` — the verbatim line each NPC gave, its group, and the blind coder's boolean                                                                                               |
| WGDR                 | `choiceProbes[].choices[]` — per character, `feasibleOptionIds` and `choiceDetermined`, so an excluded pair is explicable                                                                            |
| Coverage             | `coverage.perDecision[]` and `withinGroup.exclusions`                                                                                                                                                |
| STA / URR            | `dynamicState.incorrectTransitions[]` — every transition counted against accuracy, with cause, component, both values, scenario and conversation; `dynamicState.unexpectedResets[]`                   |
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

## Designing a probe that can actually discriminate

Three failure modes cost this framework four of its seven dimensions on the first real run, and all
three are easy to walk back into.

**A scenario that compels the behaviour measures the scenario.** The first conflict-avoidance probe
put a blatant injustice on the table with everyone looking at you and asked "what do you say next?".
All ten characters objected, and the test tied at 100% against 100%. A probe only discriminates if
_not_ doing the behaviour is socially available: keep the stakes low, let someone else have already
spoken, and make letting it go cost nothing. Every open probe also permits an empty reply, because
silence is the conflict-avoidant answer and a prompt that demands a line makes it unobservable.

**A binary coder collapses the signal.** "Objects: yes/no" scored _"I appreciate the suggestion, but
perhaps we could consider..."_ and _"it's only fair we pay for what we ordered"_ identically.
Responses are coded `absent | hedged | explicit`, and each dimension declares the `threshold` that
counts. Pick `explicit` where the theory is about owning a position outright, `hedged` where any
form of the behaviour is what was predicted.

**Grade the behaviour, not the eloquence.** On the payment-norm probe every character firmly
_declined_ to be treated, and every one was coded `explicit` against an observable reading "accepts
being treated" — a confident refusal scored as a strong instance of accepting. The coder now names
this case explicitly. It is worth re-reading the level definitions whenever a dimension saturates.

The report distinguishes these outcomes: `ceiling` and `floor` mean the probe drew the behaviour
from nearly everyone or nearly nobody and cannot discriminate, which is a broken instrument rather
than a null result. Both stay out of the DCR denominator.

## DCR is not the only number that matters

DCR counts a test as following the prediction if the rates differ in the right direction _by any
amount_. At the group sizes a 25-character cast supports, 3/6 against 2/5 clears that bar and is
indistinguishable from chance. The report prints **of which groups separate** beside it — the share
of tests whose Wilson intervals do not overlap — and marks the others _direction only_. Since the
thresholds and scenarios are tunable until everything passes, a DCR of 7/7 with a separation rate
near zero should be read as a warning, not a result.

## Sizing a choice probe

`--per-group` caps characters per _attribute group_ and applies to the theory dimensions. `--cast`
caps the choice probes, and the two are deliberately separate: sharing one flag silently wrecked
Component 3, because capping the cast at four took the four alphabetically-first characters, and
four deciders cannot cover a four-option menu (2/4 coverage looked like polarization but was
arithmetic) while four different nationalities produced zero comparable pairs for within-group
diversity.

`--cast` fills the largest background groups first rather than spreading across them. Within-group
diversity needs people who _share_ a background, so breadth is the wrong instinct here. Coverage
computed on fewer than two deciders per option is labelled NOT INTERPRETABLE.

Watch for **dominated options**. An option that is the most expensive, the longest and the least
comfortable will never be chosen by anyone, and it puts a ceiling on Option Coverage that no amount
of population diversity can lift — the gap then measures the menu, not the town.

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
src/judges/quoting.ts PURE: is a judge's quote really in the speaker's turns. Tested.
src/theory/           the dimension registry, choice probes, state update rules
src/corpus/           input schemas, normalization, the profile index
src/corpus/conditions.ts  PURE: which constraints only bind at certain times. Tested.
src/neutrality.ts     the prompt-neutrality lint
src/report.ts         console + JSON artifacts under evaluation/out
```
