# RAG Benchmark — Nimbus Data Systems (synthetic corpus, English)

Evaluation dataset for RAG pipelines over the internal documentation of a fictional tech company.

## Contents

- `docs/` — 6 documents (3 PDF + 3 DOCX, 4–5 pages each, with text, tables, and images):
  - `employee-handbook.pdf` — HR policies, vacation, benefits, org chart
  - `security-policy.pdf` (SEC-001) — data classification, access, encryption, incidents
  - `q1-2026-report.pdf` — financial and commercial results, with charts
  - `api-documentation.docx` — NimbusVault v3 API: auth, rate limits, endpoints, errors
  - `engineering-onboarding-guide.docx` — stack, workflow, on-call
  - `infrastructure-runbook.docx` (OPS-014) — topology, severities, procedures
- `questions.json` — 100 questions with `expected_answer` and `source` (document + section).
  Each question targets a unique fact that appears in only one place in the corpus.
- `run-benchmark.ts` — Playwright runner: sends each question to your UI, captures the
  answer and citations, and checks that the cited document matches the expected one.
  Results are written to `results.json`.

## Running the benchmark

```bash
npm i -D playwright ts-node typescript
npx playwright install chromium
RAG_APP_URL=http://localhost:3000 npx ts-node run-benchmark.ts
```

Adjust the selectors in `SELECTORS` to your interface. The runner validates the *source*
automatically; semantic correctness of the answers is best evaluated with an LLM-as-judge
or manual review over `results.json`.

## Question distribution

| Document | Questions |
|---|---|
| employee-handbook.pdf | 1–17 |
| security-policy.pdf | 18–37 |
| q1-2026-report.pdf | 38–56 |
| api-documentation.docx | 57–73 |
| engineering-onboarding-guide.docx | 74–89 |
| infrastructure-runbook.docx | 90–100 |
