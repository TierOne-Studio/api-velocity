import {
  isUtf8TextType,
  isBinaryDocType,
  assertExtractable,
  assertWithinOutputLimit,
  withTimeout,
  MAX_EXTRACTED_TEXT_CHARS,
  PDF_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
} from './extract';
import { NonRetryableIngestionError } from '../../domain/ingestion-errors';

describe('extract (content-type routing predicates)', () => {
  describe('isUtf8TextType', () => {
    it.each(['text/plain', 'text/markdown', 'text/csv', 'application/json'])(
      'is true for the UTF-8 text type %s',
      (ct) => {
        expect(isUtf8TextType(ct)).toBe(true);
      },
    );

    it.each([
      PDF_CONTENT_TYPE,
      DOCX_CONTENT_TYPE,
      'application/octet-stream',
      '',
    ])('is false for the non-text type %s', (ct) => {
      expect(isUtf8TextType(ct)).toBe(false);
    });
  });

  describe('isBinaryDocType', () => {
    it.each([PDF_CONTENT_TYPE, DOCX_CONTENT_TYPE])(
      'is true for the binary document type %s',
      (ct) => {
        expect(isBinaryDocType(ct)).toBe(true);
      },
    );

    it.each(['text/plain', 'application/json', 'application/octet-stream', ''])(
      'is false for the non-binary-doc type %s',
      (ct) => {
        expect(isBinaryDocType(ct)).toBe(false);
      },
    );
  });

  describe('assertExtractable', () => {
    it('throws NonRetryableIngestionError when a binary doc parses to whitespace-only', () => {
      expect(() => assertExtractable('   \n\t ', PDF_CONTENT_TYPE)).toThrow(
        NonRetryableIngestionError,
      );
      expect(() => assertExtractable('', DOCX_CONTENT_TYPE)).toThrow(
        NonRetryableIngestionError,
      );
    });

    it('does not throw when a binary doc has real text', () => {
      expect(() =>
        assertExtractable('hello world', PDF_CONTENT_TYPE),
      ).not.toThrow();
    });

    it('never throws for UTF-8 text types, even when empty (ADR-014 empty = valid)', () => {
      expect(() => assertExtractable('', 'text/plain')).not.toThrow();
      expect(() => assertExtractable('   ', 'application/json')).not.toThrow();
    });
  });

  describe('assertWithinOutputLimit (decompression-bomb guard)', () => {
    it('allows output at the limit', () => {
      expect(() =>
        assertWithinOutputLimit('x'.repeat(MAX_EXTRACTED_TEXT_CHARS)),
      ).not.toThrow();
    });

    it('throws NonRetryableIngestionError just past the limit', () => {
      expect(() =>
        assertWithinOutputLimit('x'.repeat(MAX_EXTRACTED_TEXT_CHARS + 1)),
      ).toThrow(NonRetryableIngestionError);
    });
  });

  describe('withTimeout (parse DoS guard)', () => {
    it('resolves when the work settles before the timeout', async () => {
      await expect(
        withTimeout(Promise.resolve('done'), 1000, 'pdf extraction'),
      ).resolves.toBe('done');
    });

    it('rejects with NonRetryableIngestionError when the work exceeds the timeout', async () => {
      const slow = new Promise<string>((resolve) =>
        setTimeout(() => resolve('too late'), 1000),
      );
      await expect(
        withTimeout(slow, 5, 'pdf extraction'),
      ).rejects.toBeInstanceOf(NonRetryableIngestionError);
    });
  });
});
