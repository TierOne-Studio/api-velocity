---
id: SPEC-002
title: "SPEC-002: Vector DB image extraction and description pipeline"
status: Implemented
layer: contract
owner: Maxi Schvindt
created: 2026-06-17
updated: 2026-06-17
feature_paths:
  - src/modules/vector-db/application/services/vector-db-ingestion.service.ts
  - src/modules/vector-db/domain/document-image-extractor.port.ts
  - src/modules/vector-db/domain/image-describer.port.ts
  - src/modules/vector-db/domain/point-id.ts
  - src/modules/vector-db/infrastructure/anthropic/
  - src/modules/vector-db/infrastructure/extractor/
  - src/modules/vector-db/vector-db.module.ts
  - src/shared/config/config.service.ts
related_adrs: [ADR-017]
related_specs: [SPEC-001]
counterpart_spec: "standalone"
coordination_doc: ""
---

# SPEC-002: Vector DB image extraction and description pipeline

## 1. Summary (intended behavior)

After ingesting text from a document, the pipeline extracts embedded images
(PDF/DOCX), sends each to Claude Vision, and upserts the resulting natural-language
description as an additional text chunk in Qdrant. The feature is **opt-in**: both
`IMAGE_EXTRACTION_ENABLED=true` and `ANTHROPIC_API_KEY` must be set; if either is
absent the pipeline falls back to noop adapters and behaves identically to SPEC-001.
A single failed image description does not abort the job — the remaining images and
all text chunks are still committed.

## 2. Context & problem

The existing ingestion pipeline (SPEC-001) extracts only text and silently drops all
image content. Documents with charts, diagrams, or infographics lose their visual
information at ingestion time; the knowledge base cannot surface it at retrieval time.
ADR-017 records the decision to use Vision-LLM over OCR or multi-modal embeddings.

## 3. Scope

**In scope:**

- Extracting embedded images from PDF and DOCX buffers.
- Describing each image via `ClaudeImageDescriberAdapter` (claude-haiku-4-5 by default).
- Upserting description chunks into the same Qdrant collection as text chunks.
- Collision-free point IDs via `deterministicImagePointId` (`img:` prefix namespace).
- Partial-failure resilience: `Promise.allSettled` over all image descriptions.
- Config gate: `isImageExtractionEnabled()` requires both flag and API key.
- Noop fallback adapters when the feature is disabled.
- Config accessors: model, max images per doc, min image size in bytes.

**Out of scope / non-goals:**

- Changes to the retrieval or RAG surface (chat agent is unaffected).
- New REST endpoints or DTO changes.
- Multi-modal embeddings (separate vector space) — see ADR-017 Option 3.
- OCR for text-heavy images.
- SPA changes.

## 4. Assumptions

1. [Confirmed] The existing Qdrant collection schema accepts image description points
   without schema migration — the payload is freeform JSON alongside text chunks.
2. [Confirmed] `deterministicImagePointId` with an `img:` prefix guarantees no
   collision with `deterministicPointId` for the same `(vectorDbId, s3Key, index)` triple.
3. [Confirmed] `Promise.allSettled` is sufficient; there is no requirement to surface
   partial-failure counts in the job status or response body.
4. [Confirmed] claude-haiku-4-5 is the cheapest vision-capable model and the
   appropriate default (ADR-017).

## 5. Affected areas

- `src/modules/vector-db/application/services/vector-db-ingestion.service.ts` —
  new `ingestImages()` private method; calls `imageExtractor` and `imageDescriber`
  ports injected via DI tokens.
- `src/modules/vector-db/domain/document-image-extractor.port.ts` — new port
  `IDocumentImageExtractor` + DI token `DOCUMENT_IMAGE_EXTRACTOR`.
- `src/modules/vector-db/domain/image-describer.port.ts` — new port `IImageDescriber`
  + DI token `IMAGE_DESCRIBER`.
- `src/modules/vector-db/domain/point-id.ts` — new export `deterministicImagePointId`.
- `src/modules/vector-db/infrastructure/anthropic/` — `ClaudeImageDescriberAdapter`
  (live) + `NoopImageDescriberAdapter` (fallback).
- `src/modules/vector-db/infrastructure/extractor/` — `DocumentImageExtractorAdapter`
  (live, PDF/DOCX via pdfjs-dist + mammoth) + `NoopDocumentImageExtractorAdapter`
  (fallback).
- `src/modules/vector-db/vector-db.module.ts` — factory providers wiring both ports
  to live or noop adapters based on `ConfigService.isImageExtractionEnabled()`.
- `src/shared/config/config.service.ts` — `isImageExtractionEnabled()`,
  `getAnthropicApiKey()`, `getImageExtractionModel()`,
  `getImageExtractionMaxImagesPerDoc()`, `getImageExtractionMinSizeBytes()`.

## 6. Acceptance criteria (falsifiable; each maps to a test)

| # | Criterion (observable behavior) | Proving test (file:line) |
|---|---|---|
| AC1 | When `IMAGE_EXTRACTION_ENABLED` is unset, `isImageExtractionEnabled()` returns `false` even if `ANTHROPIC_API_KEY` is set | `src/shared/config/config.service.spec.ts` — "returns false when IMAGE_EXTRACTION_ENABLED is unset" |
| AC2 | When `ANTHROPIC_API_KEY` is unset, `isImageExtractionEnabled()` returns `false` even if the flag is `true` | `src/shared/config/config.service.spec.ts` — "returns false when ANTHROPIC_API_KEY is unset even with flag enabled" |
| AC3 | With noop adapters (feature disabled), `imageExtractor.extract` is called but returns `[]`; `imageDescriber.describe` is never called; only text chunks are upserted; job status is `done` | `src/modules/vector-db/application/services/vector-db-ingestion.service.spec.ts` — "with noop image extractor: existing text-only behavior is unchanged" |
| AC4 | When an image is extracted and described, the description is embedded and upserted under `deterministicImagePointId` with payload `{ vectorDbId, s3Key, imageIndex, text }` | `vector-db-ingestion.service.spec.ts` — "embeds image descriptions and upserts with deterministicImagePointId" |
| AC5 | Images whose description resolves to an empty string are not embedded or upserted | `vector-db-ingestion.service.spec.ts` — "skips images whose description is empty" |
| AC6 | A rejected image description does not abort the job; the job completes as `done`; the other successful image descriptions are upserted | `vector-db-ingestion.service.spec.ts` — "a failed image description does not abort the job (allSettled behavior)" |
| AC7 | `deterministicImagePointId` is deterministic, varies by `vectorDbId`/`s3Key`/`imageIndex`, and never collides with `deterministicPointId` for the same inputs | `src/modules/vector-db/domain/point-id.spec.ts` — `deterministicImagePointId` describe block (6 cases) |
| AC8 | `DocumentImageExtractorAdapter` extracts at least one image from a real PDF with embedded images and returns `[]` for an empty PDF | `src/modules/vector-db/infrastructure/extractor/document-image-extractor.adapter.spec.ts` |

## 7. Implementation plan

Already implemented in PR #35. Steps were:

1. **Domain ports** — `document-image-extractor.port.ts`, `image-describer.port.ts` (no infrastructure imports in domain layer, ADR-009).
2. **`deterministicImagePointId`** — `img:` prefix in SHA-256 digest input ensures namespace separation from text point IDs.
3. **Infrastructure adapters** — `DocumentImageExtractorAdapter` (pdfjs-dist + mammoth), `ClaudeImageDescriberAdapter` (@anthropic-ai/sdk), plus noop counterparts.
4. **Config** — `isImageExtractionEnabled()` dual-gate (flag + API key); bounded-int accessors for model/max-images/min-size.
5. **Module wiring** — factory providers in `vector-db.module.ts` select live vs noop based on config at bootstrap.
6. **Ingestion service** — `ingestImages()` runs after text chunks; `Promise.allSettled` for partial-failure resilience.

## 8. Testing plan

| Layer | File | ACs covered |
|---|---|---|
| Unit | `src/shared/config/config.service.spec.ts` | AC1, AC2 |
| Unit | `src/modules/vector-db/domain/point-id.spec.ts` | AC7 |
| Unit | `src/modules/vector-db/application/services/vector-db-ingestion.service.spec.ts` | AC3, AC4, AC5, AC6 |
| Integration | `src/modules/vector-db/infrastructure/extractor/document-image-extractor.adapter.spec.ts` | AC8 |
| Unit | `src/modules/vector-db/infrastructure/anthropic/claude-image-describer.adapter.spec.ts` | adapter wiring (mocked SDK) |

## 9. Risks & failure modes

| Risk | Mitigation |
|---|---|
| Claude API rate limit or timeout on large documents | `Promise.allSettled` skips failed images without aborting the job; warning logged per failure |
| Image count blows up cost / latency for large PDFs | `IMAGE_EXTRACTION_MAX_IMAGES_PER_DOC` caps at 20 by default (configurable 1–200) |
| Tiny icons / pixel artifacts inflate noise in the vector store | `IMAGE_EXTRACTION_MIN_SIZE_BYTES` filters images below 4 KB by default |
| ID collision between image and text chunks | `img:` prefix in `deterministicImagePointId` makes the input to SHA-256 structurally different; AC7 asserts no collision |
| Feature accidentally enabled in envs without `ANTHROPIC_API_KEY` | `isImageExtractionEnabled()` requires both conditions; single-condition true returns `false` |

## 10. Open questions

None — feature is shipped and verified.

## Change Log

- 2026-06-17 · PR #35 · Initial implementation — image extraction and description pipeline (ADR-017)
