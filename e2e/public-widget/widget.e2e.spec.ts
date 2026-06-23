import { expect, test } from '@playwright/test';

const ALLOWED = 'http://localhost:4173/';
const BLOCKED = 'http://localhost:4199/';

// Playwright pierces open shadow DOM for CSS/test-id locators, so these select
// across the widget's shadow boundary.
const launcher = '[data-testid="vw-launcher"]';
const panel = '[data-testid="vw-panel"]';
const input = '[data-testid="vw-input"]';
const answer = '[data-testid="vw-answer"]';
const sources = '[data-testid="vw-sources"]';
const errorBox = '[data-testid="vw-error"]';

test.describe('public web-chat widget', () => {
  test('renders, asks, streams an answer with source chips and applied theme from an allowlisted origin', async ({
    page,
  }) => {
    await page.goto(ALLOWED);

    // The widget mounts after fetching /config. data-launcher-label="Ask"
    // overrides the default ("Chat") — proves the data-* override path.
    await expect(page.locator(launcher)).toHaveText('Ask');

    // Server theme from GET /config reaches the shadow host as a CSS custom
    // property (the only channel theme values take — trust boundary).
    const primary = await page
      .locator('[data-velocity-widget]')
      .evaluate((el) =>
        getComputedStyle(el as HTMLElement).getPropertyValue('--vw-primary').trim(),
      );
    expect(primary).toBe('rgb(10, 125, 85)');

    await page.locator(launcher).click();
    await expect(page.locator(panel)).toBeVisible();
    // Header title comes from the server theme.
    await expect(page.locator(panel)).toContainText('E2E Assistant');

    await page.locator(input).fill('What is the answer?');
    await page.locator(input).press('Enter');

    // The streamed chunk renders.
    await expect(page.locator(answer)).toHaveText('The answer is 42.');

    // Terminal `done` renders a deduped source chip linking to the safe url.
    const chip = page.locator(`${sources} a`);
    await expect(chip).toHaveText('Pricing Guide · Confluence');
    await expect(chip).toHaveAttribute('href', 'https://example.com/pricing');
  });

  test('renders the streamed answer as formatted markdown (heading + list + bold)', async ({
    page,
  }) => {
    await page.goto(ALLOWED);
    await page.locator(launcher).click();
    await page.locator(input).fill('Give me the MARKDOWN summary');
    await page.locator(input).press('Enter');

    // Markdown is rendered to real DOM nodes (createElement), not printed raw.
    await expect(page.locator(`${answer} h2`)).toHaveText('Quarterly results');
    await expect(page.locator(`${answer} li`)).toHaveCount(2);
    await expect(page.locator(`${answer} li strong`).first()).toHaveText('Revenue:');
    // The raw markdown markers must NOT leak through as literal text.
    await expect(page.locator(answer)).not.toContainText('##');
    await expect(page.locator(answer)).not.toContainText('**');

    // Trust boundary: a safe http(s) link renders as an anchor; an unsafe
    // javascript: link renders as plain text with NO anchor (no XSS sink).
    await expect(page.locator(`${answer} a[href="https://example.com/r"]`)).toHaveText('report');
    await expect(page.locator(`${answer} a`)).toHaveCount(1);
    await expect(page.locator(`${answer}`)).toContainText('evil');
  });

  test('shows the partial answer then a connection-closed error when the stream drops before done', async ({
    page,
  }) => {
    await page.goto(ALLOWED);
    await page.locator(launcher).click();

    // "DROP" makes the harness agent end the stream without a terminal `done`.
    await page.locator(input).fill('Please DROP this');
    await page.locator(input).press('Enter');

    await expect(page.locator(answer)).toHaveText('The answer is 42.');
    await expect(page.locator(errorBox)).toContainText(
      'Connection closed before the answer completed.',
    );
  });

  test('still mounts with data-* theming when /config fails, and an ask from a non-allowlisted origin errors with no answer', async ({
    page,
  }) => {
    await page.goto(BLOCKED);

    // /config is CORS-blocked from this origin, so server theme never loads —
    // the widget must still mount, applying the data-launcher-label override
    // (proves the best-effort /config fallback path).
    await expect(page.locator(launcher)).toBeVisible();
    await expect(page.locator(launcher)).toHaveText('Ask');
    await page.locator(launcher).click();

    await page.locator(input).fill('What is the answer?');
    await page.locator(input).press('Enter');

    // The real PublicEmbedGuard 403s this origin (no matching CORS grant), so
    // the browser blocks the response and the widget shows an error — never the
    // answer.
    await expect(page.locator(errorBox)).toBeVisible();
    await expect(page.locator(answer)).not.toContainText('The answer is 42.');
  });
});
