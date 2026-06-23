// Builds the standalone public web-chat widget bundle (SPEC-003 Slice 3).
// Vanilla-TS, browser-targeted, emitted as a single self-contained IIFE so a
// customer can embed it with one <script> tag. Kept out of `nest build` (which
// is Node-targeted tsc) — see tsconfig.build.json exclude + tsconfig.widget.json.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(repoRoot, 'src/modules/public-chat/widget/widget.entry.ts');
const outfile = join(repoRoot, 'dist/public-widget/widget.js');

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2019'],
  platform: 'browser',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: '/* Velocity public web-chat widget v1 */' },
});

console.log(`[build:widget] bundled widget → ${outfile}`);
