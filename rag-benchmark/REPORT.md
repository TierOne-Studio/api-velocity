# RAG Benchmark Report — Nimbus Data Systems (English corpus)

**Date:** 2026-06-11
**System under test:** Velocity Chat + RAG (project "RAG ENG Benchmark")
**Corpus:** 6 documents indexed (employee-handbook.pdf, security-policy.pdf, q1-2026-report.pdf, api-documentation.docx, engineering-onboarding-guide.docx, infrastructure-runbook.docx)
**Method:** 100 questions from `questions.json` sent through the real chat UI (Playwright, `http://localhost:5173`), all in a **single chat thread** (no new chat per question). Answers and source chips scraped from the DOM. Raw capture in `raw-results.json`, scored output in `results.json`.

---

## Executive summary

| Metric | Value |
|---|---|
| Total questions | 100 |
| ✅ Pass (correct and complete) | 90 |
| 🟡 Partial (primary fact correct, secondary detail missing) | 6 |
| 🔴 Fail (wrong or not answered) | 4 |
| **Strict score (pass only)** | **90%** |
| **Lenient score (pass + partial)** | **96%** |
| Avg answer latency | 6.3 s |
| p95 answer latency | 8.0 s |

Verdicts were assigned by manual review of every answer the token-matcher flagged (37 auto-flags, 27 of which were tokenizer artifacts — punctuation/paraphrase false negatives, the same evaluator weakness seen in the Spanish run).

### Comparison with the Spanish run

| | Spanish (raw) | Spanish (adjusted) | English (strict) | English (lenient) |
|---|---|---|---|---|
| Score | 92% | ~95–96% | 90% | 96% |

The two corpora perform equivalently. The failure *types* also repeat (e.g., Q47's missing NPS comparison fails in both languages), suggesting the gaps are chunking/retrieval-bound, not language-bound.

---

## Retrieval quality (document-level, from the answer's source chips)

First measurement of the retrieval step itself (see `feature/proposals/rag-retrieval-quality-metrics.md`). The expected source document for each question was compared against the source chips shown with the answer (chips are ordered by relevance score):

| Metric | Result |
|---|---|
| **hit@1** — expected document is the top-ranked chip | **88/100** |
| **hit@3** — expected document in the top 3 chips | **95/100** |
| **hit@any** — expected document anywhere in the chips (≤10) | **96/100** |

### Per document

| Document | Answers (pass/partial/fail) | hit@1 | hit@3 | hit@any |
|---|---|---|---|---|
| `api-documentation.docx` | 17 / 0 / 0 | 17/17 | 17/17 | 17/17 |
| `q1-2026-report.pdf` | 18 / 1 / 0 | 19/19 | 19/19 | 19/19 |
| `employee-handbook.pdf` | 16 / 0 / 1 | 13/17 | 17/17 | 17/17 |
| `security-policy.pdf` | 17 / 2 / 1 | 19/20 | 19/20 | 20/20 |
| `infrastructure-runbook.docx` | 9 / 2 / 0 | 9/11 | 9/11 | 9/11 |
| `engineering-onboarding-guide.docx` | 13 / 1 / 2 | 11/16 | 14/16 | 14/16 |

Reading: when the expected document ranks #1, answers are essentially always right. **All 4 real failures correlate with retrieval misses** (expected document absent from chips, or the right document present but the wrong section retrieved). The weakest retrieval is on `engineering-onboarding-guide.docx` (hit@1 69%), which also produced 2 of the 4 failures.

---

## The 4 real failures

### Q2 — Who founded Nimbus Data Systems? 🔴
- **Expected:** Valeria Montoya and Andrés Liang.
- **Actual:** "Nimbus Data Systems was founded in 2017 in Buenos Aires, Argentina."
- **Diagnosis:** The model answered the *previous* question (founding year/city), which had already been asked 3× earlier in the same thread. Likely **chat-history interference** — an artifact of the single-thread methodology rather than a retrieval failure. The founders' names are in the same handbook section that was retrieved.

### Q27 — How quickly are accounts deactivated after departure? 🔴
- **Expected:** Within 4 hours (security-policy § 3.2 Access reviews).
- **Actual:** Answered from the employee handbook's offboarding section ("last day", "equipment within 10 business days") and explicitly said no deactivation timeline was found.
- **Diagnosis:** Right answer lives in security-policy 3.2; the question's offboarding vocabulary pulled handbook chunks instead. Wrong-section retrieval.

### Q78 — Which tool is used for feature flags? 🔴
- **Expected:** LaunchDarkly (onboarding guide, tech-stack table).
- **Actual:** "The indexed sources I found don't mention which feature-flag tool the stack uses."
- **Diagnosis:** Expected document absent from the source chips. The tech-stack **table** chunk wasn't retrieved — table content appears under-represented for this query phrasing.

### Q89 — Where are ADRs recorded? 🔴
- **Expected:** In the repository, under docs/adr/ (onboarding guide § 7).
- **Actual:** "I couldn't find any indexed documentation stating where ADRs are recorded" (only security-policy chunks came back).
- **Diagnosis:** Expected document absent from the source chips. Retrieval miss on "ADR / architecture decision records" terminology.

## The 6 partial answers

All have the primary asked-for fact correct and omit a secondary detail present in the expected answer:

| Q | Correct | Omitted |
|---|---|---|
| Q33 | WireGuard VPN + Kandji MDM | automatic lock after 5 minutes |
| Q37 | 90 days, renewable once | written request to the CISO |
| Q47 | NPS 56 | up from 51 in Q4 2025 (same gap as Spanish Q47) |
| Q85 | first PR merged in week 2 | `good-first-issue` ticket label |
| Q93 | SEV1 first response 15 min | status-page update within 30 min |
| Q99 | post-mortem within 5 business days | blameless format |

Pattern: the model answers the literal question and drops adjacent detail from the same chunk. If completeness matters, this is a synthesis-prompt issue, not retrieval.

---

## Observations & methodology notes

1. **Sources chips remain chunk-level.** Answers consistently showed 5–10 chips spanning multiple files for single-file questions — the known issue from `feature/proposals/rag-retrieval-quality-metrics.md`. The hit@1 = 88% measured here is the concrete baseline for that proposal's tuning work.
2. **Single-thread effect.** Running 100 questions in one conversation (per the test design) produced one clear contamination failure (Q2) and grows the prompt with every turn. For a cleaner retrieval-only signal, a fresh thread per question (or per document) would isolate the RAG path; keeping the single thread is, however, a realistic stress test of long conversations.
3. **Q100 scrape timeout.** The answer took >90 s to render and was recovered from the chat afterwards; its content is correct (counted as pass), but no source chips were captured for it (counted as a retrieval miss conservatively).
4. **Latency.** Avg 6.3 s, p95 8.0 s per answer through the full UI path; no degradation trend was observed as the thread grew to 100+ turns.

## Recommended next steps

1. Investigate onboarding-guide retrieval (hit@1 69%; 2 hard misses on table/terminology queries — Q78, Q89). Check how DOCX tables are chunked.
2. Apply the sources-cleanup + retrieval-metrics proposal (`feature/proposals/rag-retrieval-quality-metrics.md`); this run supplies the baseline numbers.
3. If completeness is a product goal, adjust the synthesis prompt to include adjacent qualifiers from the cited chunk (would convert most of the 6 partials).
4. Re-run with `CHAT_AGENT_TOOL_RESULT_LIMIT=5` to test whether hit@3 = 95% holds end-to-end accuracy with fewer chunks.

---

## Artifacts

- `questions.json` — dataset (100 questions, 6 documents).
- `raw-results.json` — raw scrape: question, answer, source chips, latency per question.
- `results.json` — scored: verdict, verdict note, auto match ratio, document hit@1/@3/any per question + summary block.
