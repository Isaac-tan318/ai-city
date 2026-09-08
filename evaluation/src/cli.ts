// Command line for the evaluator.
//
//   node evaluation/run.mjs analyze --input <file.json>   score a recorded corpus
//   node evaluation/run.mjs analyze --from-convex         pull a bundle first
//   node evaluation/run.mjs probe [--dimension <id>]      run standardized probes
//   node evaluation/run.mjs classify                      show the high/low split
//   node evaluation/run.mjs neutrality                    prompt-neutrality lint only
//
// Invoked directly rather than through "npm run eval --". PowerShell strips a
// bare -- separator, so npm never sees it, treats the following --flags as its
// own config, and hands the program a bare value with no flag in front of it —
// which is a confusing way to be told your shell ate the arguments. The npm
// script still works from bash, and from PowerShell if the separator is quoted
// as '--', but the direct form behaves identically everywhere.
//
// `classify` and `neutrality` make no LLM calls at all. They exist because the
// two things most likely to be wrong in a run — which characters landed in which
// group, and whether a hypothesis leaked into a prompt — are both checkable for
// free, and finding out after paying for four hundred judgements is the wrong
// order.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { analyze } from './analyze';
import { DEFAULT_AGGREGATION_OPTIONS } from './aggregation';
import { loadCorpus } from './corpus/normalize';
import { BACKGROUND_AXES, ProfileIndex, type BackgroundAxis } from './corpus/profiles';
import { describeLLM, repoRoot, resolveLLM } from './env';
import { DEFAULT_JUDGE_OPTIONS, Judge, quiet } from './llm';
import { checkNeutrality } from './neutrality';
import { runProbes } from './probe/pipeline';
import { renderAnalyze, renderProbe, writeArtifacts } from './report';
import { classify, DIMENSIONS } from './theory/registry';

type Flags = {
  command: string;
  input?: string;
  out: string;
  limit?: number;
  perGroup?: number;
  dimension?: string;
  concurrency: number;
  miseryThreshold: number;
  fromConvex: boolean;
  cache: boolean;
  verbose: boolean;
  skipChoice: boolean;
  skipTheory: boolean;
  backgroundAxis: BackgroundAxis;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    command: argv[0] ?? 'help',
    out: 'evaluation/out',
    concurrency: DEFAULT_JUDGE_OPTIONS.concurrency,
    miseryThreshold: DEFAULT_AGGREGATION_OPTIONS.miseryThreshold,
    fromConvex: false,
    cache: true,
    verbose: false,
    skipChoice: false,
    skipTheory: false,
    // Nationality by default because it is the only axis on this cast that
    // yields a group large enough for within-group diversity to mean anything;
    // nationality-subgroup leaves one group of two.
    backgroundAxis: 'nationality',
  };
  for (let i = 1; i < argv.length; i++) {
    const raw = argv[i];
    // Support --flag=value as well as --flag value. Shells and wrappers mangle
    // one form or the other, and accepting both costs nothing.
    const eq = raw.indexOf('=');
    const inline = raw.startsWith('--') && eq > 2 ? raw.slice(eq + 1) : undefined;
    const arg = inline === undefined ? raw : raw.slice(0, eq);
    const next = () => (inline === undefined ? argv[++i] : inline);
    switch (arg) {
      case '--input':
        flags.input = next();
        break;
      case '--out':
        flags.out = next();
        break;
      case '--limit':
        flags.limit = Number(next());
        break;
      case '--per-group':
        flags.perGroup = Number(next());
        break;
      case '--dimension':
        flags.dimension = next();
        break;
      case '--concurrency':
        flags.concurrency = Number(next());
        break;
      case '--misery-threshold':
        flags.miseryThreshold = Number(next());
        break;
      case '--from-convex':
        flags.fromConvex = true;
        break;
      case '--no-cache':
        flags.cache = false;
        break;
      case '--verbose':
        flags.verbose = true;
        break;
      case '--skip-choice':
        flags.skipChoice = true;
        break;
      case '--skip-theory':
        flags.skipTheory = true;
        break;
      case '--background': {
        const value = next() as BackgroundAxis;
        if (!BACKGROUND_AXES.includes(value)) {
          throw new Error(`--background must be one of: ${BACKGROUND_AXES.join(', ')}`);
        }
        flags.backgroundAxis = value;
        break;
      }
      default:
        // A bare value arriving where a flag belongs almost always means the
        // flag before it was eaten upstream. That is what happens with
        // "npm run eval -- ..." in PowerShell: PowerShell strips the bare --
        // separator, so npm never sees it and swallows the --flags as its own
        // config. Naming the cause here saves the next person the same hour.
        if (!arg.startsWith('-')) {
          throw new Error(
            `Unexpected value '${arg}' where a flag was expected.` +
              `
  If you ran this via "npm run eval -- ..." in PowerShell, npm ate the flags:
  PowerShell strips the bare -- separator, so npm never sees it and treats the
  --flags as its own config. Run the program directly instead, which behaves
  identically in every shell:

    node evaluation/run.mjs ${argv.join(' ')}
`,
          );
        }
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

const USAGE = `
Human-simulation fidelity evaluator

  node evaluation/run.mjs analyze --input <file.json> [--limit N] [--out DIR]
  node evaluation/run.mjs analyze --from-convex [--limit N]
  node evaluation/run.mjs probe [--dimension <id>] [--per-group N] [--skip-choice]
  node evaluation/run.mjs classify
  node evaluation/run.mjs neutrality

  ("npm run eval -- ..." works too, but NOT from PowerShell: it strips the bare
   -- separator and npm swallows the flags. Quote it as '--' there, or use the
   form above, which behaves the same in every shell.)

Flags
  --input <file>          chat-history JSON, or an evaluation bundle
  --from-convex           run the admin bundle query first, then analyze it
  --limit N               cap conversations judged (analyze)
  --per-group N           cap characters per group (probe)
  --dimension <id>        run one theory dimension: ${DIMENSIONS.map((d) => d.id).join(', ')}
  --background <axis>     what counts as the same background for WGDR:
                          ${BACKGROUND_AXES.join(', ')} (default nationality)
  --misery-threshold N    average-without-misery cutoff (default 40)
  --concurrency N         parallel LLM calls (default 4)
  --no-cache              ignore evaluation/.cache and re-judge everything
  --verbose               let the underlying LLM client log every request
`;

// Pull a bundle from the running deployment. The query is internal — it returns
// ground truth, which must never be reachable from the browser — so it goes
// through the Convex CLI's admin path, the same way convex/dryRun.ts is driven.
// `shell: true` on win32 mirrors scripts/sync-convex-env.mjs: npx is a .cmd
// there and will not spawn otherwise.
function pullBundle(limit?: number): string {
  const root = repoRoot();
  const target = path.join(root, 'evaluation', 'data', 'bundle.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const args = ['convex', 'run', 'evaluationExport:bundle'];
  if (limit) args.push(JSON.stringify({ limit }));
  console.log(`  running: npx ${args.join(' ')}`);
  const result = spawnSync('npx', args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(
      `convex run failed (exit ${result.status}).\n${result.stderr || result.stdout || ''}`,
    );
  }
  // The CLI prints log lines before the return value, so take the JSON object
  // rather than assuming stdout is clean.
  const stdout = result.stdout ?? '';
  const first = stdout.indexOf('{');
  const last = stdout.lastIndexOf('}');
  if (first === -1 || last <= first) {
    throw new Error(`convex run returned no JSON object.\n${stdout.slice(0, 500)}`);
  }
  fs.writeFileSync(target, stdout.slice(first, last + 1));
  console.log(`  wrote ${target}`);
  return target;
}

export async function main(argv: string[]): Promise<void> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (err) {
    console.error((err as Error).message);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  switch (flags.command) {
    case 'classify':
      return commandClassify();
    case 'neutrality':
      return commandNeutrality();
    case 'analyze':
      return commandAnalyze(flags);
    case 'probe':
      return commandProbe(flags);
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command: ${flags.command}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

// No LLM. Shows how every character was grouped, so a strange DCR can be traced
// to the classifier before anyone blames the simulation.
function commandClassify(): void {
  const profiles = new ProfileIndex();
  for (const dimension of DIMENSIONS) {
    const groups = { high: [] as string[], low: [] as string[], unclassified: [] as string[] };
    for (const character of profiles.withAttribute(dimension.attribute)) {
      groups[classify(dimension, character.self.profile[dimension.attribute])].push(character.name);
    }
    const missing = profiles
      .all()
      .filter((c) => !c.self.profile[dimension.attribute]?.trim())
      .map((c) => c.name);
    console.log(`\n${dimension.id}   (${dimension.attribute})`);
    console.log(
      `  ${dimension.analysisOnly.highLabel} (${groups.high.length}): ${groups.high.join(', ') || '-'}`,
    );
    console.log(
      `  ${dimension.analysisOnly.lowLabel} (${groups.low.length}): ${groups.low.join(', ') || '-'}`,
    );
    console.log(
      `  ambiguous, excluded (${groups.unclassified.length}): ${groups.unclassified.join(', ') || '-'}`,
    );
    if (missing.length > 0)
      console.log(`  no value for this attribute (${missing.length}): ${missing.join(', ')}`);
  }
  console.log('');
}

function commandNeutrality(): void {
  const report = checkNeutrality();
  console.log(
    `\n${report.probeTextsScanned} probe scenarios and ${report.sourcesScanned.length} ` +
      `simulation prompt sources scanned.`,
  );
  if (report.sourcesMissing.length > 0) {
    console.log(`NOT scanned (missing): ${report.sourcesMissing.join(', ')}`);
  }
  for (const w of report.warnings) {
    console.log(`  WARNING [${w.scope}] "${w.term}" in ${w.where}`);
    if (w.excerpt) console.log(`      ...${w.excerpt}...`);
  }
  if (report.passed) {
    console.log('PASS — no hypothesis term reached an agent-facing prompt.\n');
    return;
  }
  console.log(`FAIL — ${report.findings.length} leaked terms:`);
  for (const f of report.findings) {
    console.log(`  [${f.scope}] ${f.dimensionId} · "${f.term}" in ${f.where}`);
    if (f.excerpt) console.log(`      ...${f.excerpt}...`);
  }
  console.log('');
  process.exitCode = 1;
}

async function commandAnalyze(flags: Flags): Promise<void> {
  const llm = resolveLLM();
  const input = flags.fromConvex ? pullBundle(flags.limit) : flags.input;
  if (!input) {
    console.error('analyze needs --input <file.json> or --from-convex');
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const corpus = loadCorpus(input);
  console.log(`\n  model: ${describeLLM(llm)}`);
  console.log(
    `  corpus: ${path.relative(repoRoot(), input)} — ${corpus.source}, ` +
      `${corpus.conversations.length} conversations, ${corpus.decisions.length} decisions, ` +
      `${corpus.stateEvents.length} state events`,
  );
  if (flags.limit) console.log(`  limit: ${flags.limit} conversations`);

  const judge = new Judge({
    ...DEFAULT_JUDGE_OPTIONS,
    cache: flags.cache,
    concurrency: flags.concurrency,
    verbose: flags.verbose,
  });

  const result = await quiet(flags.verbose, () =>
    analyze(judge, corpus, {
      limit: flags.limit,
      aggregation: { miseryThreshold: flags.miseryThreshold },
      backgroundAxis: flags.backgroundAxis,
    }),
  );

  const text = renderAnalyze(result);
  console.log(text);
  console.log(`  ${judge.summary()}`);
  const files = writeArtifacts(flags.out, 'analyze', text, result);
  console.log(`  written: ${path.relative(repoRoot(), files.jsonFile)}\n`);
}

async function commandProbe(flags: Flags): Promise<void> {
  const llm = resolveLLM();
  console.log(`\n  model: ${describeLLM(llm)}`);

  const profiles = new ProfileIndex();
  const judge = new Judge({
    ...DEFAULT_JUDGE_OPTIONS,
    cache: flags.cache,
    concurrency: flags.concurrency,
    verbose: flags.verbose,
  });

  const report = await quiet(flags.verbose, () =>
    runProbes(judge, profiles, {
      dimensionId: flags.dimension,
      perGroup: flags.perGroup,
      skipChoice: flags.skipChoice,
      skipTheory: flags.skipTheory,
      backgroundAxis: flags.backgroundAxis,
    }),
  );

  const text = renderProbe(report);
  console.log(text);
  console.log(`  ${judge.summary()}`);
  const files = writeArtifacts(flags.out, 'probe', text, report);
  console.log(`  written: ${path.relative(repoRoot(), files.jsonFile)}\n`);
}
