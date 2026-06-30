// Post-build guard: assert every runtime-loaded artifact that has NO fallback
// landed where the running container expects it. A stray .ts file outside `src/`
// silently moves the TypeScript rootDir to the repo root, nesting output under
// `dist/src/...` — the build still "succeeds" but the image crash-loops at boot
// with `Cannot find module '/app/dist/main'`. The widget bundle has the same
// failure class at request time (503, no fallback). Fail loud here, in the
// builder stage, so a broken artifact never ships.
//
// Scope is deliberately limited to NO-FALLBACK artifacts:
//   - dist/main.js               → Docker `CMD ["node", "dist/main"]`; missing = boot crash-loop.
//   - dist/public-widget/widget.js → served by PublicWidgetController with no
//     fallback; missing = 503 on GET /api/public/widget/v1/widget.js.
// Chat prompts (dist/modules/chat/prompts/*.md) are intentionally NOT gated:
// the loader degrades to a built-in fallback, so a miss lowers quality, not uptime.
//
// The dist root is overridable via VERIFY_BUILD_DIST for fixture-based testing.
import { accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distEnv = process.env.VERIFY_BUILD_DIST;
const distRoot = distEnv
  ? isAbsolute(distEnv)
    ? distEnv
    : join(repoRoot, distEnv)
  : join(repoRoot, 'dist');

// Each entry: [relative path, the runtime contract it satisfies].
const requiredArtifacts = [
  ['main.js', 'Docker CMD ["node", "dist/main"] — missing entrypoint crash-loops at boot'],
  [
    'public-widget/widget.js',
    'served by PublicWidgetController (no fallback) — missing returns 503',
  ],
];

const missing = requiredArtifacts.filter(([rel]) => {
  try {
    accessSync(join(distRoot, rel), constants.F_OK);
    return false;
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  console.error(
    `[verify-build] FATAL: missing ${missing.length} required build artifact(s) under ${distRoot}:`,
  );
  for (const [rel, contract] of missing) {
    console.error(`  - ${rel}  (${contract})`);
  }
  console.error(
    `Likely cause: a .ts file outside src/ was pulled into the build, shifting the output root,\n` +
      `or a build step (build:widget / copy:assets) failed silently.\n` +
      `Ensure tsconfig.build.json pins the build to src/ (include: ["src/**/*"]).`,
  );
  process.exit(1);
}

console.log(
  `[verify-build] all ${requiredArtifacts.length} required artifacts present under ${distRoot}`,
);
