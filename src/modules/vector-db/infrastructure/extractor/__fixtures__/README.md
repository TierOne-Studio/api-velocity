# Extractor test fixtures

Tiny documents used by `document-extractor.adapter.integration.spec.ts` to prove
real PDF/DOCX text extraction (ADR-015). All are generated, not authored by hand,
so they are deterministic and minimal.

| File | Purpose | Contents |
|---|---|---|
| `sample.pdf` | PDF happy path | text "Velocity ingestion smoke test" |
| `empty.pdf`  | scanned/image-only PDF (no extractable text) → non-retryable failure | a valid page with no text operators |
| `sample.docx`| DOCX happy path | text "Velocity DOCX ingestion smoke test" |

## Non-vacuity invariant (important)

The fixtures are **compressed** so the marker text is **absent from the raw file
bytes**: `sample.pdf` uses a `FlateDecode` content stream, `sample.docx` stores
`word/document.xml` `DEFLATE`-compressed. This is deliberate — a raw-UTF-8 decode
(the exact bug ADR-015 fixes) therefore cannot contain the marker, so the
extraction tests can only pass if real parsing ran. The adapter integration spec
asserts this directly ("does not contain the marker in raw bytes"). **If you
regenerate these, keep them compressed**, or the extraction tests become vacuous.

## How they were generated

- **PDFs**: hand-built minimal PDF (catalog → pages → page → content stream →
  Helvetica font) with a correct `xref` table; the content stream is
  `zlib.deflateSync`-compressed and tagged `/Filter /FlateDecode`. `sample.pdf`
  has a `BT … Tj ET` text object; `empty.pdf` has only a `q Q` (no text),
  simulating a scan.
- **DOCX**: a minimal OOXML package (`[Content_Types].xml`, `_rels/.rels`,
  `word/document.xml`) zipped with `jszip` using `compression: 'DEFLATE'`.

The generator is not committed (it was a one-off). To regenerate, recreate a
script that emits the three files above; verify with:

```js
import { getDocumentProxy, extractText } from 'unpdf';
import mammoth from 'mammoth';
// sample.pdf → "Velocity ingestion smoke test"
// empty.pdf  → ""
// sample.docx → "Velocity DOCX ingestion smoke test"
```
