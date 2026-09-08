// Prompt Neutrality and Experimental Unawareness, checked rather than asserted.
//
// The rule is precise, and getting the scope right matters more than the check
// being aggressive. An agent-facing prompt MAY state stable profile attributes
// and the scenario — "Conflict style: avoids direct conflict" is stipulated
// persona, and the framework explicitly allows it. What it may NOT do is state
// the behaviour expected from those attributes, name the group the character has
// been sorted into, or describe the behaviour a coder will look for.
//
// So the scan covers only the experimenter-authored half of a probe — the
// situation, the ask, the option text — and deliberately excludes the persona
// block. Scanning the persona would flag every character whose profile happens
// to contain the word "direct", which is not a leak; it is the input.
//
// Three checks, with different force:
//
//   A. Experimental vocabulary and group labels in probe text.  HARD FAIL.
//   B. Anything under convex/ or data/ importing from evaluation/.  HARD FAIL —
//      the simulation must not be able to see the theory registry at all.
//   C. Directive phrasing in the town's own prompt builders ("you are
//      conflict-avoidant, so...").  WARNING: heuristic, worth a human look.
import fs from 'fs';
import path from 'path';
import { repoRoot } from './env';
import { DIMENSIONS, type Dimension } from './theory/registry';

// The town's own prompt assembly. Listed explicitly rather than globbed so a new
// prompt builder has to be added deliberately and the list stays reviewable.
export const AGENT_PROMPT_SOURCES = [
  'convex/agent/conversation.ts',
  'convex/aiTown/agentOperations.ts',
  'convex/aiTown/scenarios.ts',
  'convex/focal.ts',
  'convex/decider.ts',
];

// Language that belongs to the experiment, never to a character's situation.
// A prompt containing any of these is telling the agent it is being studied.
export const EXPERIMENT_VOCABULARY = [
  'hypothesis',
  'expected direction',
  'expected to',
  'literature',
  'we predict',
  'is being tested',
  'this experiment',
  'evaluation metric',
  'behavioural dimension',
  'as someone who',
  'because you are',
  'given your personality',
  'you should therefore',
  'you will tend to',
];

export type NeutralityFinding = {
  severity: 'fail' | 'warning';
  scope: 'probe-text' | 'import-boundary' | 'simulation-source';
  dimensionId: string;
  where: string;
  term: string;
  excerpt: string;
};

export type NeutralityReport = {
  findings: NeutralityFinding[];
  warnings: NeutralityFinding[];
  probeTextsScanned: number;
  sourcesScanned: string[];
  sourcesMissing: string[];
  passed: boolean;
};

// What must never appear in the text an NPC is shown: the labels of the groups
// it has been sorted into, and the behaviour the coder will look for.
export function forbiddenPhrases(dimension: Dimension): string[] {
  return [
    dimension.analysisOnly.highLabel,
    dimension.analysisOnly.lowLabel,
    dimension.observable,
    ...EXPERIMENT_VOCABULARY,
  ]
    .map((p) => p.toLowerCase().trim())
    .filter((p) => p.length >= 5);
}

function excerptAround(haystack: string, term: string): string {
  const at = haystack.toLowerCase().indexOf(term.toLowerCase());
  if (at === -1) return '';
  const start = Math.max(0, at - 45);
  return haystack
    .slice(start, at + term.length + 45)
    .replace(/\s+/g, ' ')
    .trim();
}

// Every file under convex/ and data/ that the simulation actually runs. If any
// of them can reach evaluation/, the separation this whole component rests on
// is only a convention.
function scanImportBoundary(root: string): NeutralityFinding[] {
  const findings: NeutralityFinding[] = [];
  const roots = ['convex', 'data', 'src'];
  const walk = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '_generated') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  for (const base of roots) {
    for (const file of walk(path.join(root, base))) {
      const source = fs.readFileSync(file, 'utf8');
      if (!/from\s+['"][^'"]*evaluation\//.test(source)) continue;
      findings.push({
        severity: 'fail',
        scope: 'import-boundary',
        dimensionId: '-',
        where: path.relative(root, file).split(path.sep).join('/'),
        term: 'imports from evaluation/',
        excerpt: excerptAround(source, 'evaluation/'),
      });
    }
  }
  return findings;
}

export function checkNeutrality(): NeutralityReport {
  const findings: NeutralityFinding[] = [];
  const warnings: NeutralityFinding[] = [];
  let probeTextsScanned = 0;

  // A. The experimenter-authored half of each probe. The persona block is
  //    deliberately not scanned — see the header.
  for (const dimension of DIMENSIONS) {
    const authored = [
      dimension.agentFacing.situation,
      dimension.agentFacing.ask,
      ...dimension.agentFacing.options.flatMap((o) => [o.title, o.details]),
    ].join('\n');
    probeTextsScanned++;
    const lower = authored.toLowerCase();
    for (const phrase of forbiddenPhrases(dimension)) {
      if (!lower.includes(phrase)) continue;
      findings.push({
        severity: 'fail',
        scope: 'probe-text',
        dimensionId: dimension.id,
        where: `${dimension.id} situation/ask`,
        term: phrase,
        excerpt: excerptAround(authored, phrase),
      });
    }
  }

  const root = repoRoot();

  // B. The import boundary.
  findings.push(...scanImportBoundary(root));

  // C. Directive phrasing in the town's own prompt builders. Heuristic, so it
  //    reports warnings: "you are conflict-avoidant, so keep the peace" in a
  //    persona would make the conflict-avoidance dimension circular, but the
  //    same words in a comment are harmless.
  const sourcesScanned: string[] = [];
  const sourcesMissing: string[] = [];
  for (const relative of AGENT_PROMPT_SOURCES) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) {
      sourcesMissing.push(relative);
      continue;
    }
    sourcesScanned.push(relative);
    const source = fs.readFileSync(full, 'utf8');
    const lower = source.toLowerCase();
    for (const phrase of EXPERIMENT_VOCABULARY) {
      if (!lower.includes(phrase)) continue;
      warnings.push({
        severity: 'warning',
        scope: 'simulation-source',
        dimensionId: '-',
        where: relative,
        term: phrase,
        excerpt: excerptAround(source, phrase),
      });
    }
  }

  return {
    findings,
    warnings,
    probeTextsScanned,
    sourcesScanned,
    sourcesMissing,
    passed: findings.length === 0,
  };
}
