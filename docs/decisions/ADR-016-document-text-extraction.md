# ADR-016: Document text extraction — PDF/DOCX via a domain port, with non-retryable failure handling

**Status:** Accepted
**Date:** 2026-06-04
**Deciders:** engineering team

## Context

ADR-015 shipped the ingestion pipeline (read S3 blob → chunk → embed → upsert) but
recorded a known MVP limitation: file bodies were decoded as **UTF-8 text**
(`body.toString('utf-8')`) before chunking, with "no PDF/DOCX text extraction." The
upload endpoint already accepts `application/pdf` and the DOCX MIME type
(`VECTOR_DB_ALLOWED_MIME_TYPES`), so a user could upload a PDF, see the job succeed,
and get a knowledge base full of **garbage vectors** — the binary bytes chunked as
mojibake. The KB looked searchable but returned nonsense. This ADR closes that gap:
extract real text from PDFs and DOCX before chunking.

Two forces shape the design:
1. **Layering (ADR-009):** parsing SDKs must not leak into the application/domain layers.
2. **Failure semantics (ADR-015 §5):** the worker retries thrown errors up to
   `MAX_INGESTION_ATTEMPTS`. Some extraction failures are *permanent* — an unsupported
   type, a corrupt/mislabelled file, or a scanned/image-only PDF that yields no text.
   Retrying those three times wastes an S3 download + parse per attempt and leaves the
   UI showing a misleading "processing" state across the backoff window.

## Decision

1. **A new `IDocumentExtractor` domain port** (`domain/document-extractor.port.ts`):
   `extract(body: Buffer, contentType: string): Promise<string>`. This is the right seam
   — extraction is a distinct concern from chunking (folding it into `ITextChunker` would
   give the chunker two reasons to change) and from byte I/O (decorating
   `IVectorDbFileUploader.get()` would hide a bytes→text transform behind a read). One
   adapter implements it today; the port still earns its keep via SDK isolation (ADR-009)
   and as the worker's test seam.

2. **`unpdf` (PDF) + `mammoth` (DOCX), isolated in one adapter** (ADR-006 approved).
   `infrastructure/extractor/document-extractor.adapter.ts` is the only file importing
   either SDK. The pure routing/guard logic (`extract.ts`: `isUtf8TextType`,
   `isBinaryDocType`, `assertExtractable`) is SDK-free and unit-tested without fixtures —
   mirroring the existing `chunker.ts` (pure) + `recursive-text-chunker.adapter.ts` split.

3. **Dispatch on `jobRow.content_type`, not the S3 `get()` content type.** The DB value
   is set from `file.mimetype` at upload; the S3 value falls back to
   `application/octet-stream`, which would route every file to the unsupported-type
   failure. Neither source is a *security* signal (both are client-influenced), so the
   declared type is used only for **routing**. Correctness is enforced by the parser: a
   file declared `application/pdf` that is not a valid PDF makes `unpdf` throw, which the
   adapter maps to a permanent failure (decision 5).

4. **UTF-8 text types keep their direct-decode path; the allow-list is explicit.**
   `text/plain`, `text/markdown`, `text/csv`, `application/json` decode via
   `body.toString('utf-8')`. The text-type set is an explicit allow-list rather than
   "anything not binary," so an unrecognised type fails fast instead of being silently
   chunked as garbage. A genuinely empty text file still yields `""` → 0 chunks → a
   validly ingested empty document (unchanged from ADR-015).

5. **A `NonRetryableIngestionError` taxonomy makes permanent failures terminal in one
   attempt** (`domain/ingestion-errors.ts`), refining ADR-015 §5. The adapter throws it
   for: unsupported content type, a blob over the extraction size ceiling
   (`VECTOR_DB_MAX_UPLOAD_SIZE`), a parser rejection (corrupt/mislabelled file), or a
   binary document that parses to whitespace-only (scanned PDF, no OCR). The worker's
   `handleFailure` honours it by routing into the **existing** terminal-write block
   (`setJobStatus 'failed'` + `updateStatus 'error'`) — there remains exactly one
   terminal-write site (ADR-015 §5 invariant preserved). Such a failure does **not**
   increment the attempts counter: it was never a transient attempt, and the budget is
   reserved for failures a retry could fix (OpenAI/Qdrant blips), which stay plain
   `Error`s on the existing retry path.

## Alternatives considered

- **Fold extraction into `ITextChunker`.** Rejected: SRP — the chunker would change both
  when splitting strategy changes and when a new file format is added.
- **Decorate `IVectorDbFileUploader.get()` to return text.** Rejected: the uploader's job
  is byte I/O; a `get()` that silently returns parsed text is a hidden side effect.
- **`pdf-parse` / langchain `PDFLoader` for PDF.** Rejected: `pdf-parse` is lightly
  maintained with an import-time quirk; `PDFLoader` drags in the large
  `@langchain/community` package to wrap `pdf-parse` anyway. `unpdf` is lean, maintained,
  ships a dual CJS/ESM build (works under our CommonJS runtime *and* the ESM jest config),
  and needs no native binaries.
- **Throw a plain `Error` for permanent failures and let it retry 3×.** Rejected: same
  terminal end-state but wasteful (3× S3 download + parse) and shows a misleading
  "processing" state across the backoff window.

## Consequences

- **Positive:** uploaded PDFs and DOCX become genuinely searchable; the advertised
  allow-list is now honest. SDKs stay confined to one adapter. Permanent failures surface
  immediately with an actionable message ("no extractable text … scanned PDF? OCR is not
  supported") instead of a silent `ready` KB or retry churn. The adapter integration test
  parses real fixtures with no external service, so it runs in every CI lane.
- **Negative / residual risk:** PDF/DOCX parsers process untrusted uploads — a DoS surface
  (CPU-heavy pathological PDF, decompression-bomb DOCX). Mitigations **in this PR**:
  (1) 50MB input cap (upload + re-checked pre-parse); (2) a per-parse **wall-clock timeout**
  (`EXTRACTION_TIMEOUT_MS`) mapping to a permanent failure; (3) an **extracted-output ceiling**
  (`MAX_EXTRACTED_TEXT_CHARS`) bounding downstream memory/embedding spend; (4) raw parser
  error text is logged server-side only — the persisted/user-visible failure carries a fixed,
  non-leaking message.
  **Accepted residual (MVP):** the timeout stops the worker *waiting* but does not abort the
  SDK work (pdf.js/mammoth expose no cancellation), and a fast decompression bomb can still
  spike memory before the output ceiling is reached. These are bounded operationally by a
  **worker process memory limit + restart** (the reconcile sweep recovers in-flight jobs).
  Risk accepted for MVP given upload is authenticated and the blast radius is a recoverable
  queue stall (no data exposure — XXE/SSRF ruled out: `@xmldom/xmldom` resolves no external
  entities). **Tracked follow-ups:** (a) a terminable **worker-thread sandbox** for true
  parse cancellation + hard per-job memory cap; (b) a pre-inflation uncompressed-size check
  for DOCX.
- **Known limitations (MVP):** no OCR — scanned/image-only PDFs fail fast rather than
  being indexed. No re-extraction of files ingested before this change (they remain
  garbage until re-uploaded). Extraction quality is whatever `unpdf`/`mammoth` produce
  (no layout/table reconstruction).

## References

- ADR-015 (ingestion pipeline; §5 terminal-failure single code path — refined here).
- ADR-009 (clean-architecture layering — port in `domain/`, SDK in `infrastructure/`).
- ADR-006 (asks-first dependency gate — `unpdf`, `mammoth` adoption).
- `src/modules/vector-db/domain/{document-extractor.port.ts, ingestion-errors.ts}`.
- `src/modules/vector-db/infrastructure/extractor/{extract.ts, document-extractor.adapter.ts}`.
- `src/modules/vector-db/application/services/vector-db-ingestion.service.ts` — `ingest()` extract step, `handleFailure` non-retryable branch.
