// Rendering. Three rules, all of them consequences of the framework's own
// instruction to keep evaluation dimensions separate:
//
//   No composite score. There is no line at the bottom that adds these up. The
//   framework is explicit that a single scalar is only worth constructing once
//   an online policy needs a reward, and combining several fairness-flavoured
//   terms double-counts the same concern.
//
//   Every rate shows its denominator. `formatRate` prints n and an interval, so
//   a 100% built on three observations cannot be mistaken for a result.
//
//   Skipped is not zero. A component the input could not support is printed as
//   skipped, with the reason, rather than as a rate over nothing.
import fs from 'fs';
import path from 'path';
import { formatRate, type Rate } from './metrics';
import type { AnalyzeResult } from './analyze';
import type { ProbeReport } from './probe/pipeline';
import type { NeutralityReport } from './neutrality';

const RULE = '─'.repeat(78);

function heading(title: string): string[] {
  return ['', RULE, `  ${title}`, RULE];
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function line(label: string, r: Rate | undefined, note = ''): string {
  const value = r ? formatRate(r) : 'skipped';
  return `  ${label.padEnd(34)} ${value}${note ? `   ${note}` : ''}`;
}

export function renderAnalyze(result: AnalyzeResult): string {
  const out: string[] = [];
  out.push(...heading('Human-simulation fidelity — recorded corpus'));
  out.push(
    `  input: ${result.source}   ` +
      `${result.counts.conversationsJudged}/${result.counts.conversations} conversations judged, ` +
      `${result.counts.charactersSeen} characters, ${result.counts.decisions} decisions, ` +
      `${result.counts.stateEvents} state events`,
  );
  if (result.counts.unknownAuthors.length > 0) {
    out.push(
      `  not scored (no profile in data/characters.ts): ${result.counts.unknownAuthors.join(', ')}`,
    );
  }

  out.push(...heading('1. Persona fidelity'));
  if (result.personaFidelity) {
    out.push(
      line('Persona Consistency Rate (PCR)', result.personaFidelity.pcr, 'higher is better'),
    );
    out.push(line('Hard-Constraint Contradiction', result.personaFidelity.hccr, 'target 0'));
    out.push(line('judge abstention', result.personaFidelity.abstention, 'excluded from both'));
    const worst = [...result.personaFidelity.byCharacter]
      .filter((c) => c.pcr.denominator > 0)
      .sort((a, b) => a.pcr.rate - b.pcr.rate)
      .slice(0, 5);
    if (worst.length > 0) {
      out.push('', '  lowest-scoring characters:');
      for (const c of worst) out.push(`    ${c.name.padEnd(12)} ${formatRate(c.pcr)}`);
    }
    const violators = result.personaFidelity.byCharacter.filter((c) => c.hccr.numerator > 0);
    if (violators.length > 0) {
      out.push('', '  contradicted a hard constraint:');
      for (const c of violators) out.push(`    ${c.name.padEnd(12)} ${formatRate(c.hccr)}`);
    }
  } else {
    out.push('  skipped — no gradable opportunities found in this corpus.');
  }

  out.push(...heading('4. Information-disclosure plausibility'));
  if (result.disclosure) {
    out.push(
      line('Relevant Disclosure Rate', result.disclosure.relevantDisclosure, 'higher is better'),
    );
    out.push(
      line('Premature Disclosure Rate', result.disclosure.prematureDisclosure, 'lower is better'),
    );
    const early = result.disclosure.byCharacter
      .filter((c) => c.prematureDisclosure.numerator > 0)
      .sort((a, b) => b.prematureDisclosure.rate - a.prematureDisclosure.rate)
      .slice(0, 5);
    if (early.length > 0) {
      out.push('', '  volunteered private information early:');
      for (const c of early) {
        out.push(`    ${c.name.padEnd(12)} ${formatRate(c.prematureDisclosure)}`);
        // What they actually volunteered, so the flag can be checked rather
        // than believed. Without it a premature-disclosure rate is a number
        // with nothing behind it.
        const flagged = result.evidence.premature.find(
          (p) => p.characterName === c.name && p.prematureDisclosure,
        );
        if (flagged?.whatWasVolunteered) {
          out.push(`        volunteered: ${truncate(flagged.whatWasVolunteered, 88)}`);
        }
      }
    }
    // The other half of the picture: a constraint that mattered and never got
    // said is what drags Relevant Disclosure down, and naming them turns the
    // rate into something actionable.
    const hidden = result.evidence.disclosure.filter((d) => d.opportunity && !d.disclosed);
    if (hidden.length > 0) {
      out.push('', `  relevant constraints never disclosed (${hidden.length}):`);
      for (const d of hidden.slice(0, 6)) {
        out.push(`    ${d.characterName.padEnd(12)} ${truncate(d.constraint, 60)}`);
      }
      if (hidden.length > 6) out.push(`    (${hidden.length - 6} more in the JSON)`);
    }
  } else {
    out.push('  skipped — no disclosure opportunities found.');
  }
  return out.concat(renderAnalyzeTail(result)).join('\n');
}

function renderAnalyzeTail(result: AnalyzeResult): string[] {
  const out: string[] = [];

  out.push(...heading('3. Population behavioural diversity'));
  if (result.coverage) {
    out.push(line('participants who took a position', result.coverage.endorsementRate));
    out.push('');
    for (const d of result.coverage.perDecision) {
      out.push(
        `    ${d.scenarioName.slice(0, 26).padEnd(28)} coverage ${formatRate(d.result.coverage)}` +
          (Number.isFinite(d.result.topOptionShare)
            ? `   top option ${(d.result.topOptionShare * 100).toFixed(0)}%`
            : ''),
      );
      if (d.result.neverSelected.length > 0) {
        out.push(`      nobody chose: ${d.result.neverSelected.join(', ')}`);
      }
    }
    out.push('');
    out.push(line('Within-Group Diversity (WGDR)', result.coverage.withinGroup.wgdr));
    out.push(
      `    ${result.coverage.withinGroup.eligiblePairs} eligible pairs, ` +
        `${result.coverage.withinGroup.excludedPairs} excluded ` +
        `(${
          Object.entries(result.coverage.withinGroup.exclusions)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}: ${n}`)
            .join(', ') || 'none'
        })`,
    );
  } else {
    out.push('  skipped — this input carries no decisions with candidate options.');
  }

  out.push(...heading('5. Longitudinal and dynamic-state validity'));
  if (result.dynamicState) {
    out.push(line('State-Transition Accuracy', result.dynamicState.stateTransitionAccuracy));
    out.push(line('Unexpected Reset Rate', result.dynamicState.unexpectedResetRate, 'target 0'));
    const v = result.dynamicState.verdicts;
    out.push(
      `    verdicts: ${v.correct} correct, ${v['wrong-direction']} wrong direction, ` +
        `${v['no-movement']} no movement, ${v.clamped} clamped (excluded), ` +
        `${v.unconstrained} unconstrained (excluded)`,
    );
    for (const reset of result.dynamicState.unexpectedResets.slice(0, 5)) {
      out.push(
        `    reset: ${reset.characterName} ${reset.component} ` +
          `${reset.valueBefore} to ${reset.valueAfter} on '${reset.cause}'`,
      );
    }
  } else {
    out.push('  skipped — this input carries no short-term state log.');
  }

  out.push(...heading('Aggregation rules (diagnostic, not a score)'));
  if (result.aggregation) {
    const d = result.aggregation.disagreement;
    out.push(
      `  the winning option changes with the rule in ${d.disagreed}/${d.total} decisions ` +
        `(${Number.isFinite(d.rate) ? (d.rate * 100).toFixed(0) : '--'}%)`,
    );
    for (const c of result.aggregation.comparisons.slice(0, 8)) {
      out.push('', `    ${c.scenarioName}  (chose ${c.selectedOptionId})`);
      for (const o of c.outcomes) {
        out.push(
          `      ${o.rule.padEnd(22)} best ${o.bestOptionTitle.slice(0, 24).padEnd(26)} ` +
            `regret ${String(o.regret).padStart(6)}${o.optimal ? '  optimal' : ''}`,
        );
      }
      if (c.nashZeroed.length > 0) {
        out.push(`      zeroed by a hard constraint: ${c.nashZeroed.join(', ')}`);
      }
    }
  } else {
    out.push('  skipped — needs per-option utilities, which this input does not carry.');
  }

  out.push(...renderNeutrality(result.neutrality));

  if (result.capabilityNotes.length > 0) {
    out.push(...heading('What this input could not support'));
    for (const note of result.capabilityNotes) out.push(`  - ${note}`);
  }
  out.push('');
  return out;
}

function renderNeutrality(neutrality: NeutralityReport): string[] {
  const out = heading('Prompt neutrality and experimental unawareness');
  out.push(
    `  ${neutrality.probeTextsScanned} probe scenarios scanned, ` +
      `${neutrality.sourcesScanned.length} simulation prompt sources scanned`,
  );
  if (neutrality.sourcesMissing.length > 0) {
    out.push(`  NOT scanned (file missing): ${neutrality.sourcesMissing.join(', ')}`);
  }
  for (const w of neutrality.warnings.slice(0, 6)) {
    out.push(`  WARNING [${w.scope}] "${w.term}" in ${w.where}`);
  }
  if (neutrality.passed) {
    out.push('  PASS — no hypothesis or expected-direction term reached an agent-facing prompt.');
    return out;
  }
  out.push(`  FAIL — ${neutrality.findings.length} leaked terms:`);
  for (const f of neutrality.findings.slice(0, 12)) {
    out.push(`    [${f.scope}] ${f.dimensionId} · "${f.term}" in ${f.where}`);
    if (f.excerpt) out.push(`        ...${f.excerpt}...`);
  }
  if (neutrality.findings.length > 12) {
    out.push(`    (${neutrality.findings.length - 12} more)`);
  }
  return out;
}

export function renderProbe(report: ProbeReport): string {
  const out: string[] = [];
  out.push(...heading('Human-simulation fidelity — standardized probes'));

  out.push(...heading('2. Theory-anchored behavioural plausibility'));
  if (report.plausibility) {
    out.push(
      line('Directional Consistency (DCR)', report.plausibility.dcr, '100% is not the goal'),
    );
    out.push('');
    for (const run of report.dimensions) {
      const scored = report.plausibility.tests.find((t) => t.dimensionId === run.dimensionId);
      const inconclusive = report.plausibility.inconclusive.find(
        (t) => t.dimensionId === run.dimensionId,
      );
      const verdict = scored
        ? scored.follows
          ? 'follows'
          : 'AGAINST'
        : `inconclusive (${inconclusive?.inconclusiveReason ?? 'unknown'})`;
      const t = run.test;
      out.push(`    ${run.dimensionId}  —  ${verdict}`);
      out.push(`      observable: ${run.observable}`);
      out.push(
        `      ${run.highLabel.padEnd(26)} ${t.high.hits}/${t.high.n}` +
          `      ${run.lowLabel.padEnd(26)} ${t.low.hits}/${t.low.n}` +
          `      expected ${t.expected}`,
      );
      if (run.groups.unclassified.length > 0) {
        out.push(`      unclassified (excluded): ${run.groups.unclassified.join(', ')}`);
      }
      out.push('');
    }
  } else {
    out.push('  skipped — no theory dimensions were run.');
  }

  out.push(...heading('3. Population behavioural diversity'));
  if (report.choiceProbes.length > 0) {
    for (const probe of report.choiceProbes) {
      out.push(
        `    ${probe.name.slice(0, 26).padEnd(28)} coverage ${formatRate(probe.coverage.coverage)}` +
          (Number.isFinite(probe.coverage.topOptionShare)
            ? `   top option ${(probe.coverage.topOptionShare * 100).toFixed(0)}%`
            : ''),
      );
      if (probe.coverage.neverSelected.length > 0) {
        out.push(`      nobody chose: ${probe.coverage.neverSelected.join(', ')}`);
      }
      if (probe.abstained.length > 0) {
        out.push(`      no commitment: ${probe.abstained.join(', ')}`);
      }
    }
    if (report.withinGroup) {
      out.push('');
      out.push(line('Within-Group Diversity (WGDR)', report.withinGroup.wgdr));
      out.push(
        `    ${report.withinGroup.eligiblePairs} eligible pairs, ` +
          `${report.withinGroup.excludedPairs} excluded ` +
          `(${
            Object.entries(report.withinGroup.exclusions)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k}: ${n}`)
              .join(', ') || 'none'
          })`,
      );
      // Scenario as well as background: the same background appears once per
      // probe, and three unlabelled rows reading "Singapore" tell you nothing.
      for (const g of report.withinGroup.byBackground.slice(0, 12)) {
        const label = `${g.background} · ${g.scenarioId}`;
        out.push(`      ${label.slice(0, 40).padEnd(42)} ${formatRate(g.wgdr)}`);
      }
    }
  } else {
    out.push('  skipped — no choice probes were run.');
  }

  out.push(...renderNeutrality(report.neutrality));
  out.push('');
  return out.join('\n');
}

// Both reports also go to disk: the console view is a summary, and the JSON
// keeps every judgement so a surprising rate can be traced to the utterance that
// produced it without paying for the run again.
export function writeArtifacts(
  outDir: string,
  name: string,
  text: string,
  data: unknown,
): { textFile: string; jsonFile: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const textFile = path.join(outDir, `${name}-${stamp}.txt`);
  const jsonFile = path.join(outDir, `${name}-${stamp}.json`);
  fs.writeFileSync(textFile, text);
  fs.writeFileSync(jsonFile, JSON.stringify(data, null, 2));
  return { textFile, jsonFile };
}
