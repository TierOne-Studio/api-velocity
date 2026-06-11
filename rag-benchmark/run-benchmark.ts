/**
 * RAG benchmark runner with Playwright (English dataset).
 *
 * Iterates over the 100 questions in questions.json, sends them to your
 * RAG chat UI, and saves the answers to results.json for later evaluation.
 *
 * Adjust the selectors (SELECTORS) and the URL to match your application.
 *
 * Usage:
 *   npm i -D playwright
 *   npx playwright install chromium
 *   npx ts-node run-benchmark.ts   (or compile with tsc)
 */
import { chromium, Page } from "playwright";
import * as fs from "fs";

const APP_URL = process.env.RAG_APP_URL ?? "http://localhost:3000";

// Adapt these selectors to your UI
const SELECTORS = {
  input: 'textarea[data-testid="chat-input"]',
  sendButton: 'button[data-testid="send-button"]',
  // Each assistant answer. :last-of-type grabs the most recent one.
  lastAnswer: '[data-testid="assistant-message"]:last-of-type',
  // Element indicating the assistant finished responding (spinner gone)
  loadingIndicator: '[data-testid="loading"]',
  // Citations / sources your UI shows next to the answer (optional)
  sources: '[data-testid="assistant-message"]:last-of-type [data-testid="source"]',
};

interface Question {
  id: number;
  question: string;
  expected_answer: string;
  source: { document: string; section: string };
}

interface Result extends Question {
  actual_answer: string;
  actual_sources: string[];
  source_correct: boolean;
  duration_ms: number;
  error?: string;
}

async function ask(page: Page, text: string): Promise<{ answer: string; sources: string[] }> {
  await page.fill(SELECTORS.input, text);
  await page.click(SELECTORS.sendButton);

  // Wait for the loading indicator to appear and then disappear
  await page.waitForSelector(SELECTORS.loadingIndicator, { state: "visible", timeout: 10_000 }).catch(() => {});
  await page.waitForSelector(SELECTORS.loadingIndicator, { state: "hidden", timeout: 120_000 });

  const answer = (await page.textContent(SELECTORS.lastAnswer))?.trim() ?? "";
  const sources = await page.$$eval(SELECTORS.sources, (els) =>
    els.map((e) => e.textContent?.trim() ?? "")
  ).catch(() => [] as string[]);

  return { answer, sources };
}

async function main() {
  const dataset = JSON.parse(fs.readFileSync("questions.json", "utf-8"));
  const questions: Question[] = dataset.questions;
  const results: Result[] = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(APP_URL);

  for (const q of questions) {
    const start = Date.now();
    try {
      const { answer, sources } = await ask(page, q.question);

      // Simple source check: the expected document appears among the citations.
      // Answer quality is better evaluated separately (LLM-as-judge or manual review).
      const sourceCorrect = sources.some((s) =>
        s.toLowerCase().includes(q.source.document.toLowerCase())
      );

      results.push({
        ...q,
        actual_answer: answer,
        actual_sources: sources,
        source_correct: sourceCorrect,
        duration_ms: Date.now() - start,
      });
      console.log(`[${q.id}/100] source ${sourceCorrect ? "OK" : "FAIL"} (${Date.now() - start} ms)`);
    } catch (err) {
      results.push({
        ...q,
        actual_answer: "",
        actual_sources: [],
        source_correct: false,
        duration_ms: Date.now() - start,
        error: String(err),
      });
      console.error(`[${q.id}/100] ERROR: ${err}`);
    }
  }

  await browser.close();

  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));

  const ok = results.filter((r) => r.source_correct).length;
  const errors = results.filter((r) => r.error).length;
  console.log(`\nSummary: ${ok}/${results.length} with correct source, ${errors} errors.`);
  console.log("Details saved to results.json");
}

main();
