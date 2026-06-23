import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e for the public web-chat widget (SPEC-003 Slice 3). Drives the
 * REAL built widget bundle in a real browser against the REAL public-chat HTTP
 * surface (booted by e2e/support/test-server.ts with a faked agent + in-memory
 * embed repo). The server also serves two static host pages on distinct origins
 * — one allowlisted, one not — so the origin allow/deny is the real guard's
 * decision, not a mock's.
 */
export default defineConfig({
  testDir: './public-widget',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list']],
  use: { headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/support/tsnode-bootstrap.cjs',
    // Run from the api-velocity root so ts-node resolves tsconfig.json and the
    // bootstrap path correctly (Playwright otherwise runs it from the config dir).
    cwd: process.cwd(),
    url: 'http://localhost:4199/',
    timeout: 90_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
