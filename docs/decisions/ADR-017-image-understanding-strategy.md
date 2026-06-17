# ADR-017 — Image Understanding Strategy for Vector DB Ingestion

**Status:** Accepted  
**Deciders:** Engineering team  
**Date:** 2026-06-16

---

## Context

PDF and DOCX documents frequently contain embedded images (charts, diagrams, screenshots,
infographics) that carry information not represented in the extracted text. The existing
ingestion pipeline (ADR-014, ADR-015, ADR-016) extracts only text and silently drops all
image content. This means the knowledge base cannot surface visual information at retrieval
time, degrading answer quality for documents that communicate primarily through visuals.

Three options were considered:

### Option 1 — OCR (Tesseract or cloud OCR service)
Extract image content via optical character recognition. Best for text-heavy images
(screenshots of terminals, PDFs with embedded scanned text). Requires a native binary
(Tesseract) or an external API call with billing. Does not understand charts or diagrams.

### Option 2 — Vision-LLM → text (chosen)
Extract embedded images, send each to a vision-capable LLM (Claude), receive a natural-
language description, store the description as a text chunk in the existing Qdrant
collection alongside the document's text chunks. No new vector space, no retrieval rewrite,
no schema migration.

### Option 3 — Multi-modal embeddings (separate vector space)
Embed images directly using a multi-modal embedding model. Requires a separate Qdrant
collection with a different dimension and a retrieval layer that can merge text and image
results. Significant infrastructure lift and no current retrieval-side support.

---

## Decision

Adopt **Option 2**. The implementation:

1. **Feature gate.** Both `IMAGE_EXTRACTION_ENABLED=true` AND `ANTHROPIC_API_KEY` must be
   set. Either absent → noop adapters are wired; zero behavior change for existing deployments.

2. **New domain ports.**
   - `IDocumentImageExtractor` (token `DOCUMENT_IMAGE_EXTRACTOR`) — extracts raw image bytes
     from PDF/DOCX blobs. Returns `ExtractedImage[]`; never throws (empty array on failure).
   - `IImageDescriber` (token `IMAGE_DESCRIBER`) — produces a natural-language description
     of a single image via a vision-capable LLM.

3. **Infrastructure adapters.**
   - `DocumentImageExtractorAdapter` — PDF images via `unpdf.extractImages()`, encoded to
     PNG using Node.js built-in `zlib` (no native add-ons). DOCX images via mammoth's
     `convertImage` handler. Non-binary types return `[]`.
   - `ClaudeImageDescriberAdapter` — calls `claude-haiku-4-5` (configurable via
     `IMAGE_EXTRACTION_MODEL`). Accepts any `@anthropic-ai/sdk`-supported mime type;
     falls back to `image/jpeg` for unknown types.
   - `NoopImageDescriberAdapter` / `NoopDocumentImageExtractorAdapter` — wired when the
     gate is off; zero overhead in the default path.

4. **Ingestion pipeline integration.** After text chunks are embedded and upserted,
   `VectorDbIngestionService.ingestImages()` runs:
   - Extract images from the document body (same body already in memory).
   - Call `IImageDescriber.describe()` for each via `Promise.allSettled` — a single
     failed description does not abort the job.
   - Embed successful descriptions using the existing `IEmbedder`.
   - Upsert to the existing Qdrant collection using `deterministicImagePointId()` —
     a separate namespace from `deterministicPointId()` so image and text chunks for
     the same document cannot collide.
   - Image chunks carry `{ vectorDbId, s3Key, imageIndex, text }` payloads, consistent
     with text chunk payloads (same retrieval path, no retrieval changes needed).

5. **Idempotency.** Re-ingesting the same document produces the same image point IDs
   (hash of `img:vectorDbId:s3Key:imageIndex`), so retried jobs upsert rather than
   duplicate (ADR-014 §3 idempotency guarantee extended to image chunks).

6. **Scanned PDFs (no-text limitation).** This implementation does NOT relocate
   `assertExtractable()`. A scanned PDF that produces no text will still fail at text
   extraction before the image pipeline runs. Handling scanned PDFs with only images
   (image-only chunks) is a follow-up tracked separately.

---

## Consequences

**Positive:**
- Zero behavior change for deployments without `IMAGE_EXTRACTION_ENABLED=true`.
- No schema migration, no new Qdrant collection, no retrieval-layer changes.
- Additive: image descriptions become first-class searchable chunks alongside text.
- Resilient: per-image failures are logged and skipped; the overall job still succeeds.

**Negative / trade-offs:**
- Ingestion is slower when enabled: one LLM call per image per document.
- `@anthropic-ai/sdk` is now a production dependency (ADR-006 dep gate honored — explicit
  install approval was obtained before adding to `package.json`).
- Scanned PDFs (images only) still fail at text extraction; image-only ingestion is not
  yet supported.

**Neutral:**
- `IMAGE_EXTRACTION_MODEL` defaults to `claude-haiku-4-5` (cheapest Claude vision model).
  Operators can override per environment.
- Max images per document (`IMAGE_EXTRACTION_MAX_IMAGES_PER_DOC`, default 20) and minimum
  image size (`IMAGE_EXTRACTION_MIN_SIZE_BYTES`, default 4096) are configurable.
