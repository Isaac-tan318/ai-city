// Runner for the human-simulation fidelity evaluator.
//
//   npm run eval -- analyze --input evaluation/fixtures/sample-chat-history.json
//   npm run eval -- probe --dimension conflict-avoidance
//
// The program is TypeScript so it can import the repo's own modules directly —
// convex/util/llm.ts (zero imports, raw fetch + process.env), convex/scoring.ts,
// data/groundTruth.ts — rather than reimplementing them. Nothing in the repo can
// currently *run* a .ts entrypoint: there is no tsx, and ts-node's ESM loader is
// broken on Node >= 20.6. So this bundles the CLI with esbuild (already present
// via vite) and imports the result. Bundling is ~50ms and needs no new package.
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, '.build', 'cli.mjs');

await build({
  entryPoints: [path.join(here, 'src', 'cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Keep node_modules external: zod and dotenv resolve fine at runtime and
  // bundling them would slow every start for no benefit.
  packages: 'external',
  sourcemap: 'inline',
  logLevel: 'warning',
});

const mod = await import(`file://${outfile}`);
await mod.main(process.argv.slice(2));

// 4 things current sys sleep, increase test metrics
// test if person a and b can make a plan to go to place c 
// new sys do before fri , see if is customisable