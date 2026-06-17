import { jest } from '@jest/globals';
import {
  VectorDbIngestionService,
  MAX_INGESTION_ATTEMPTS,
  type IngestionJobPayload,
} from './vector-db-ingestion.service';
import { deterministicPointId, deterministicImagePointId } from '../../domain/point-id';
import { chunkText } from '../../infrastructure/textsplitter/chunker';
import { NonRetryableIngestionError } from '../../domain/ingestion-errors';

const PAYLOAD: IngestionJobPayload = { jobId: 'job-1', vectorDbId: 'kb-1' };
const S3_KEY = 'vector-dbs/org-1/kb-1/abc';
const REF = 'vdb_abc';

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    vector_db_id: 'kb-1',
    s3_key: S3_KEY,
    original_filename: 'doc.txt',
    file_size_bytes: '11',
    content_type: 'text/plain',
    status: 'pending',
    attempts: 0,
    locked_until: null,
    last_error: null,
    created_at: 'now',
    updated_at: 'now',
    ...overrides,
  };
}

function vdbRow(overrides: Record<string, unknown> = {}) {
  return { id: 'kb-1', vector_store_ref: REF, status: 'empty', ...overrides };
}

function buildMocks() {
  const repository = {
    findIngestionJobById: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    findById: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    setJobStatus: jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    updateStatus: jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    incrementJobAttempts: jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    setVectorDbReadyIfIdle: jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const vectorStore = {
    ensureCollection: jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    upsert: jest
      .fn<(...a: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const embedder = {
    embed: jest.fn<(...a: unknown[]) => Promise<number[][]>>(),
    dimensions: jest.fn(() => 1536),
  };
  const files = {
    get: jest.fn<
      (...a: unknown[]) => Promise<{ body: Buffer; contentType: string }>
    >(),
  };
  // Delegate to the real splitter so chunk-count expectations are realistic.
  const chunker = {
    chunk: jest.fn((text: string) => chunkText(text)),
  };
  // Default extractor: decode UTF-8, mirroring the real adapter's text path so
  // the existing text/plain cases behave as before. Overridden per test for
  // routing / failure cases.
  const extractor = {
    extract: jest
      .fn<(...a: unknown[]) => Promise<string>>()
      .mockImplementation((body: unknown) =>
        Promise.resolve((body as Buffer).toString('utf-8')),
      ),
  };
  const queue = {
    start: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    stop: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ensureQueue: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    work: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  // Noop by default: no images extracted, no descriptions produced.
  const imageExtractor = {
    extract: jest
      .fn<(...a: unknown[]) => Promise<unknown>>()
      .mockResolvedValue([]),
  };
  const imageDescriber = {
    describe: jest
      .fn<(...a: unknown[]) => Promise<string>>()
      .mockResolvedValue(''),
  };
  const service = new VectorDbIngestionService(
    queue as never,
    repository as never,
    vectorStore as never,
    embedder as never,
    files as never,
    chunker as never,
    extractor as never,
    imageExtractor as never,
    imageDescriber as never,
  );
  return {
    service,
    repository,
    vectorStore,
    embedder,
    files,
    chunker,
    extractor,
    queue,
    imageExtractor,
    imageDescriber,
  };
}

describe('VectorDbIngestionService.ingest', () => {
  it('embeds and upserts chunks with deterministic ids, then marks the job done', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({
      body: Buffer.from('a short document'),
      contentType: 'text/plain',
    });
    m.embedder.embed.mockResolvedValue([[0.1, 0.2]]);

    await m.service.ingest(PAYLOAD);

    expect(m.vectorStore.ensureCollection).toHaveBeenCalledWith(REF, 1536);
    expect(m.vectorStore.upsert).toHaveBeenCalledWith(REF, [
      expect.objectContaining({ id: deterministicPointId('kb-1', S3_KEY, 0) }),
    ]);
    expect(m.repository.setJobStatus).toHaveBeenCalledWith(
      'job-1',
      'done',
      null,
    );
    expect(m.repository.setVectorDbReadyIfIdle).toHaveBeenCalledWith('kb-1');
  });

  it('marks the KB processing before reading the file', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({
      body: Buffer.from('hi'),
      contentType: 'text/plain',
    });
    m.embedder.embed.mockResolvedValue([[0.1]]);

    await m.service.ingest(PAYLOAD);

    expect(m.repository.updateStatus).toHaveBeenCalledWith(
      'kb-1',
      'processing',
      null,
    );
  });

  it('handles an empty file as a valid ingest: no embed/upsert, job done', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({
      body: Buffer.from('   '),
      contentType: 'text/plain',
    });

    await m.service.ingest(PAYLOAD);

    expect(m.embedder.embed).not.toHaveBeenCalled();
    expect(m.vectorStore.upsert).not.toHaveBeenCalled();
    expect(m.repository.setJobStatus).toHaveBeenCalledWith(
      'job-1',
      'done',
      null,
    );
    expect(m.repository.setVectorDbReadyIfIdle).toHaveBeenCalledWith('kb-1');
  });

  it('is idempotent: an already-done job is skipped without re-processing', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(
      jobRow({ status: 'done' }),
    );

    await m.service.ingest(PAYLOAD);

    expect(m.repository.findById).not.toHaveBeenCalled();
    expect(m.vectorStore.upsert).not.toHaveBeenCalled();
    expect(m.repository.setJobStatus).not.toHaveBeenCalled();
  });

  it('skips silently when the job row no longer exists', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(null);

    await m.service.ingest(PAYLOAD);

    expect(m.repository.setJobStatus).not.toHaveBeenCalled();
    expect(m.vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('fails the job when its vector db no longer exists', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(null);

    await m.service.ingest(PAYLOAD);

    expect(m.repository.setJobStatus).toHaveBeenCalledWith(
      'job-1',
      'failed',
      'vector db not found',
    );
    expect(m.vectorStore.upsert).not.toHaveBeenCalled();
  });

  it('re-upserting the same job produces the same point ids (idempotent retry)', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({
      body: Buffer.from('hello world'),
      contentType: 'text/plain',
    });
    m.embedder.embed.mockResolvedValue([[0.1]]);

    await m.service.ingest(PAYLOAD);
    await m.service.ingest(PAYLOAD);

    const firstIds = (
      m.vectorStore.upsert.mock.calls[0][1] as { id: string }[]
    ).map((p) => p.id);
    const secondIds = (
      m.vectorStore.upsert.mock.calls[1][1] as { id: string }[]
    ).map((p) => p.id);
    expect(secondIds).toEqual(firstIds);
  });

  describe('failure handling', () => {
    it('on a non-terminal failure: increments attempts, resets to pending, and rethrows', async () => {
      const m = buildMocks();
      m.repository.findIngestionJobById.mockResolvedValue(
        jobRow({ attempts: 0 }),
      );
      m.repository.findById.mockResolvedValue(vdbRow());
      m.files.get.mockResolvedValue({
        body: Buffer.from('hi'),
        contentType: 'text/plain',
      });
      m.embedder.embed.mockRejectedValue(new Error('openai 429'));

      await expect(m.service.ingest(PAYLOAD)).rejects.toThrow('openai 429');

      expect(m.repository.incrementJobAttempts).toHaveBeenCalledWith('job-1');
      expect(m.repository.setJobStatus).toHaveBeenCalledWith(
        'job-1',
        'pending',
        'openai 429',
      );
      expect(m.repository.updateStatus).not.toHaveBeenCalledWith(
        'kb-1',
        'error',
        expect.anything(),
      );
    });

    it('on the final attempt: marks the job failed + KB error, and does NOT rethrow', async () => {
      const m = buildMocks();
      m.repository.findIngestionJobById.mockResolvedValue(
        jobRow({ attempts: MAX_INGESTION_ATTEMPTS - 1 }),
      );
      m.repository.findById.mockResolvedValue(vdbRow());
      m.files.get.mockResolvedValue({
        body: Buffer.from('hi'),
        contentType: 'text/plain',
      });
      m.embedder.embed.mockRejectedValue(new Error('openai down'));

      await expect(m.service.ingest(PAYLOAD)).resolves.toBeUndefined();

      expect(m.repository.setJobStatus).toHaveBeenCalledWith(
        'job-1',
        'failed',
        'openai down',
      );
      expect(m.repository.updateStatus).toHaveBeenCalledWith('kb-1', 'error', {
        message: 'openai down',
      });
    });

    it('on a non-retryable failure: fails terminally in one attempt without consuming the retry budget', async () => {
      const m = buildMocks();
      m.repository.findIngestionJobById.mockResolvedValue(
        jobRow({ attempts: 0 }),
      );
      m.repository.findById.mockResolvedValue(vdbRow());
      m.files.get.mockResolvedValue({
        body: Buffer.from('%PDF-garbage'),
        contentType: 'application/pdf',
      });
      m.extractor.extract.mockRejectedValue(
        new NonRetryableIngestionError('no extractable text'),
      );

      await expect(m.service.ingest(PAYLOAD)).resolves.toBeUndefined();

      // terminal in one attempt: failed + KB error, no rethrow…
      expect(m.repository.setJobStatus).toHaveBeenCalledWith(
        'job-1',
        'failed',
        'no extractable text',
      );
      expect(m.repository.updateStatus).toHaveBeenCalledWith('kb-1', 'error', {
        message: 'no extractable text',
      });
      // …and the retry budget is untouched (it would never succeed on retry).
      expect(m.repository.incrementJobAttempts).not.toHaveBeenCalled();
      expect(m.embedder.embed).not.toHaveBeenCalled();
    });
  });

  describe('extraction routing', () => {
    it('extracts using the file content type, then chunks the extracted text', async () => {
      const m = buildMocks();
      m.repository.findIngestionJobById.mockResolvedValue(
        jobRow({ content_type: 'application/pdf' }),
      );
      m.repository.findById.mockResolvedValue(vdbRow());
      const pdfBytes = Buffer.from('%PDF-1.4 ...');
      m.files.get.mockResolvedValue({
        body: pdfBytes,
        contentType: 'application/pdf',
      });
      m.extractor.extract.mockResolvedValue('extracted pdf text body');
      m.embedder.embed.mockResolvedValue([[0.1]]);

      await m.service.ingest(PAYLOAD);

      expect(m.extractor.extract).toHaveBeenCalledWith(
        pdfBytes,
        'application/pdf',
      );
      expect(m.chunker.chunk).toHaveBeenCalledWith('extracted pdf text body');
    });

    it('routes on the DB content_type, not the S3-returned content type', async () => {
      const m = buildMocks();
      m.repository.findIngestionJobById.mockResolvedValue(
        jobRow({ content_type: 'application/pdf' }),
      );
      m.repository.findById.mockResolvedValue(vdbRow());
      const bytes = Buffer.from('%PDF...');
      // S3 reports a stale/wrong content type; the DB value is the source of truth.
      m.files.get.mockResolvedValue({
        body: bytes,
        contentType: 'application/octet-stream',
      });
      m.extractor.extract.mockResolvedValue('text');
      m.embedder.embed.mockResolvedValue([[0.1]]);

      await m.service.ingest(PAYLOAD);

      expect(m.extractor.extract).toHaveBeenCalledWith(
        bytes,
        'application/pdf',
      );
    });
  });
});

describe('VectorDbIngestionService lifecycle', () => {
  it('gracefully stops the queue on module destroy', async () => {
    const m = buildMocks();
    await m.service.onModuleDestroy();
    expect(m.queue.stop).toHaveBeenCalledWith(true);
  });

  it('enqueues with a retry budget coupled to MAX_INGESTION_ATTEMPTS', async () => {
    const m = buildMocks();
    await m.service.enqueue('job-1', 'kb-1');
    expect(m.queue.send).toHaveBeenCalledWith(
      'vector-db-ingestion',
      { jobId: 'job-1', vectorDbId: 'kb-1' },
      { retryLimit: MAX_INGESTION_ATTEMPTS, retryBackoff: true },
    );
  });
});

describe('VectorDbIngestionService image pipeline', () => {
  it('with noop image extractor: existing text-only behavior is unchanged', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({ body: Buffer.from('text doc'), contentType: 'text/plain' });
    m.embedder.embed.mockResolvedValue([[0.1, 0.2]]);

    await m.service.ingest(PAYLOAD);

    // image extractor was called, but produced no images
    expect(m.imageExtractor.extract).toHaveBeenCalled();
    expect(m.imageDescriber.describe).not.toHaveBeenCalled();
    // only text chunk was upserted
    expect(m.vectorStore.upsert).toHaveBeenCalledTimes(1);
    expect(m.vectorStore.upsert).toHaveBeenCalledWith(REF, [
      expect.objectContaining({ id: deterministicPointId('kb-1', S3_KEY, 0) }),
    ]);
  });

  it('embeds image descriptions and upserts with deterministicImagePointId', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({ body: Buffer.from('PDF with diagram'), contentType: 'application/pdf' });
    m.extractor.extract.mockResolvedValue('text content');
    m.imageExtractor.extract.mockResolvedValue([
      { data: Buffer.from('img1'), mimeType: 'image/png', index: 0 },
    ]);
    m.imageDescriber.describe.mockResolvedValue('A flowchart showing the CI pipeline.');
    // embedder returns vectors: first call for text chunks, second for image
    m.embedder.embed
      .mockResolvedValueOnce([[0.1, 0.2]])  // text chunk
      .mockResolvedValueOnce([[0.5, 0.6]]); // image description

    await m.service.ingest(PAYLOAD);

    // image describer was called with the extracted image
    expect(m.imageDescriber.describe).toHaveBeenCalledWith(
      Buffer.from('img1'),
      'image/png',
    );
    // two upsert calls: one for text, one for image
    expect(m.vectorStore.upsert).toHaveBeenCalledTimes(2);
    expect(m.vectorStore.upsert).toHaveBeenCalledWith(REF, [
      expect.objectContaining({
        id: deterministicImagePointId('kb-1', S3_KEY, 0),
        vector: [0.5, 0.6],
      }),
    ]);
  });

  it('skips images whose description is empty', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({ body: Buffer.from('hi'), contentType: 'text/plain' });
    m.imageExtractor.extract.mockResolvedValue([
      { data: Buffer.from('tiny'), mimeType: 'image/png', index: 0 },
    ]);
    m.imageDescriber.describe.mockResolvedValue(''); // empty description
    m.embedder.embed.mockResolvedValue([[0.1]]);

    await m.service.ingest(PAYLOAD);

    // embed is called once for text, never for the empty image description
    expect(m.embedder.embed).toHaveBeenCalledTimes(1);
  });

  it('a failed image description does not abort the job (allSettled behavior)', async () => {
    const m = buildMocks();
    m.repository.findIngestionJobById.mockResolvedValue(jobRow());
    m.repository.findById.mockResolvedValue(vdbRow());
    m.files.get.mockResolvedValue({ body: Buffer.from('PDF'), contentType: 'application/pdf' });
    m.extractor.extract.mockResolvedValue('some text');
    m.imageExtractor.extract.mockResolvedValue([
      { data: Buffer.from('img1'), mimeType: 'image/jpeg', index: 0 },
      { data: Buffer.from('img2'), mimeType: 'image/jpeg', index: 1 },
    ]);
    m.imageDescriber.describe
      .mockRejectedValueOnce(new Error('rate_limit_error')) // first fails
      .mockResolvedValueOnce('A table of sales data.');  // second succeeds
    m.embedder.embed
      .mockResolvedValueOnce([[0.1]])  // text
      .mockResolvedValueOnce([[0.9]]); // second image description

    await m.service.ingest(PAYLOAD);

    // job still completes despite one image failing
    expect(m.repository.setJobStatus).toHaveBeenCalledWith('job-1', 'done', null);
    // the successful image description was still upserted
    expect(m.vectorStore.upsert).toHaveBeenCalledWith(REF, [
      expect.objectContaining({
        id: deterministicImagePointId('kb-1', S3_KEY, 1),
      }),
    ]);
  });
});

describe('VectorDbIngestionService.reconcile', () => {
  it('re-enqueues every reclaimable job', async () => {
    const m = buildMocks();
    const repo = m.repository as unknown as {
      findReclaimableJobs: jest.Mock;
    };
    repo.findReclaimableJobs = jest
      .fn<(...a: unknown[]) => Promise<unknown[]>>()
      .mockResolvedValue([
        { id: 'j1', vector_db_id: 'kb-1' },
        { id: 'j2', vector_db_id: 'kb-2' },
      ]);
    const enqueue = jest
      .spyOn(m.service, 'enqueue')
      .mockResolvedValue(undefined);

    await m.service.reconcile();

    expect(enqueue).toHaveBeenCalledWith('j1', 'kb-1');
    expect(enqueue).toHaveBeenCalledWith('j2', 'kb-2');
  });
});
