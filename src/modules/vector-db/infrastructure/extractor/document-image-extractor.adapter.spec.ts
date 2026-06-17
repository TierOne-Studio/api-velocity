import { jest } from '@jest/globals';

const mockGetDocumentProxy = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockExtractImages = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.mock('unpdf', () => ({
  __esModule: true,
  getDocumentProxy: mockGetDocumentProxy,
  extractImages: mockExtractImages,
}));

const mockMammothConvertToHtml = jest.fn<(...a: unknown[]) => Promise<unknown>>();

jest.mock('mammoth', () => ({
  __esModule: true,
  default: {
    convertToHtml: mockMammothConvertToHtml,
    images: {
      imgElement: (handler: (img: unknown) => unknown) => handler,
    },
  },
}));

import { DocumentImageExtractorAdapter } from './document-image-extractor.adapter';

const PDF_CT = 'application/pdf';
const DOCX_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('DocumentImageExtractorAdapter', () => {
  const adapter = new DocumentImageExtractorAdapter();

  beforeEach(() => {
    mockGetDocumentProxy.mockReset();
    mockExtractImages.mockReset();
    mockMammothConvertToHtml.mockReset();
  });

  describe('non-binary content types', () => {
    it('returns [] for text/plain without calling any parser', async () => {
      const result = await adapter.extract(Buffer.from('hello'), 'text/plain');
      expect(result).toEqual([]);
      expect(mockGetDocumentProxy).not.toHaveBeenCalled();
    });

    it('returns [] for application/json', async () => {
      const result = await adapter.extract(Buffer.from('{}'), 'application/json');
      expect(result).toEqual([]);
    });

    it('returns [] for unknown content types without throwing', async () => {
      const result = await adapter.extract(Buffer.from('x'), 'image/bmp');
      expect(result).toEqual([]);
    });
  });

  describe('PDF extraction', () => {
    it('returns [] when the PDF has no embedded images', async () => {
      const fakePdf = {
        numPages: 2,
      };
      mockGetDocumentProxy.mockResolvedValue(fakePdf);
      mockExtractImages.mockResolvedValue([]); // no images on any page

      const result = await adapter.extract(Buffer.from('%PDF'), PDF_CT);

      expect(result).toEqual([]);
      expect(mockExtractImages).toHaveBeenCalledTimes(2); // called per page
    });

    it('returns PNG buffers for each embedded image, tagged with sequential index', async () => {
      const fakePdf = { numPages: 1 };
      mockGetDocumentProxy.mockResolvedValue(fakePdf);
      // 2x2 pixel RGBA image
      const rawPixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
      mockExtractImages.mockResolvedValue([
        { data: rawPixels, width: 2, height: 2, channels: 4, key: 'img0' },
      ]);

      const result = await adapter.extract(Buffer.from('%PDF'), PDF_CT);

      expect(result).toHaveLength(1);
      expect(result[0].mimeType).toBe('image/png');
      expect(result[0].index).toBe(0);
      expect(result[0].data).toBeInstanceOf(Buffer);
      // Verify it looks like a PNG (magic bytes: 89 50 4E 47)
      expect(result[0].data[0]).toBe(0x89);
      expect(result[0].data[1]).toBe(0x50);
      expect(result[0].data[2]).toBe(0x4e);
      expect(result[0].data[3]).toBe(0x47);
    });

    it('returns [] and does not throw when the PDF parser fails', async () => {
      mockGetDocumentProxy.mockRejectedValue(new Error('corrupt PDF'));

      const result = await adapter.extract(Buffer.from('garbage'), PDF_CT);

      expect(result).toEqual([]);
    });
  });

  describe('DOCX extraction', () => {
    it('returns [] when the DOCX has no embedded images', async () => {
      mockMammothConvertToHtml.mockResolvedValue({ value: '<p>text only</p>', messages: [] });

      const result = await adapter.extract(Buffer.from('PK'), DOCX_CT);

      expect(result).toEqual([]);
    });

    it('returns [] and does not throw when the DOCX parser fails', async () => {
      mockMammothConvertToHtml.mockRejectedValue(new Error('corrupt DOCX'));

      const result = await adapter.extract(Buffer.from('garbage'), DOCX_CT);

      expect(result).toEqual([]);
    });
  });
});
