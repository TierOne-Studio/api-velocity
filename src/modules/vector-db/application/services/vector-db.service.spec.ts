import { jest } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { VectorDbRow } from '../../api/dto/vector-db.dto';
import type { IVectorDbRepository } from '../../domain/vector-db.repository';
import { VectorDbService } from './vector-db.service';

const now = '2026-06-02T00:00:00.000Z';

const adminScope = {
  userId: 'user-1',
  platformRole: 'admin' as const,
  activeOrganizationId: 'org-1',
};

const superadminScope = {
  userId: 'user-super',
  platformRole: 'superadmin' as const,
  activeOrganizationId: null,
  organizationId: 'org-2',
};

function buildRepositoryMock(): jest.Mocked<IVectorDbRepository> {
  return {
    create: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    incrementDocumentCount: jest.fn(),
    findById: jest.fn(),
    findByIdInOrg: jest.fn(),
    findManyByIdsForOrg: jest.fn(),
    listForOrganization: jest.fn(),
    findByOrganizationAndName: jest.fn(),
    delete: jest.fn(),
    countProjectReferences: jest.fn<() => Promise<number>>().mockResolvedValue(0),
    assertOrganizationExists: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    createIngestionJob: jest.fn(),
    listJobsForVectorDb: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
    findIngestionJobById: jest.fn(),
    deleteIngestionJob: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    decrementDocumentCount: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IVectorDbRepository>;
}

function buildUploaderMock() {
  return {
    put: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeService(
  repo: jest.Mocked<IVectorDbRepository>,
  uploader = buildUploaderMock(),
) {
  return new VectorDbService(repo, uploader as never);
}

function buildJobRow() {
  return {
    id: 'job-1',
    vector_db_id: 'kb-1',
    s3_key: 'vector-dbs/org-1/kb-1/uuid',
    original_filename: 'doc.txt',
    file_size_bytes: '5',
    content_type: 'text/plain',
    status: 'pending' as const,
    attempts: 0,
    locked_until: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

function buildRow(overrides: Partial<VectorDbRow> = {}): VectorDbRow {
  return {
    id: 'kb-1',
    organization_id: 'org-1',
    name: 'My KB',
    description: null,
    vector_store_kind: 'qdrant',
    vector_store_ref: 'vdb_abc123',
    status: 'empty',
    status_error: null,
    document_count: 0,
    deleted_at: null,
    version: 0,
    processing_started_at: null,
    last_ingested_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('VectorDbService.list', () => {
  it('returns org-scoped knowledge bases', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    const row = buildRow();
    repo.listForOrganization.mockResolvedValue([row]);

    const result = await service.list(adminScope);

    expect(repo.listForOrganization).toHaveBeenCalledWith('org-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('kb-1');
    expect(result[0].organizationId).toBe('org-1');
  });
});

describe('VectorDbService.getById', () => {
  it('returns a single knowledge base', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(buildRow());

    const result = await service.getById(adminScope, 'kb-1');
    expect(result.id).toBe('kb-1');
  });

  it('throws NotFoundException when not found', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(null);

    await expect(service.getById(adminScope, 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('VectorDbService.create', () => {
  it('creates a knowledge base and returns the public shape', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByOrganizationAndName.mockResolvedValue(null);
    repo.create.mockImplementation(async (row) =>
      buildRow({ id: row.id, name: row.name, vector_store_ref: row.vectorStoreRef }),
    );

    const result = await service.create(adminScope, { name: 'Docs' });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        name: 'Docs',
        description: null,
        vectorStoreKind: 'qdrant',
      }),
    );
    expect(result.vectorStoreRef).toMatch(/^vdb_[a-f0-9]{32}$/);
    expect(result.status).toBe('empty');
  });

  it('throws BadRequestException when name is blank', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);

    await expect(service.create(adminScope, { name: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws ConflictException on duplicate name', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByOrganizationAndName.mockResolvedValue(buildRow());

    await expect(service.create(adminScope, { name: 'My KB' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('uses superadmin organizationId when provided', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByOrganizationAndName.mockResolvedValue(null);
    repo.create.mockImplementation(async (row) =>
      buildRow({ organization_id: row.organizationId }),
    );

    await service.create(superadminScope, { name: 'Docs' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-2' }),
    );
  });

  it('throws BadRequestException when superadmin has no org', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);

    await expect(
      service.create(
        { userId: 'u', platformRole: 'superadmin', activeOrganizationId: null },
        { name: 'x' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when superadmin passes a non-existent org', async () => {
    const repo = buildRepositoryMock();
    repo.assertOrganizationExists = jest.fn<() => Promise<void>>().mockRejectedValue(
      new NotFoundException('Organization not found'),
    );
    const service = makeService(repo);

    await expect(
      service.create(superadminScope, { name: 'Docs' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('VectorDbService.update', () => {
  it('renames a knowledge base', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(buildRow());
    repo.findByOrganizationAndName.mockResolvedValue(null);
    repo.update.mockResolvedValue(buildRow({ name: 'Renamed' }));

    const result = await service.update(adminScope, 'kb-1', { name: 'Renamed' });
    expect(result.name).toBe('Renamed');
  });

  it('throws NotFoundException when KB not found', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(null);

    await expect(
      service.update(adminScope, 'missing', { name: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException on duplicate name collision', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(buildRow({ id: 'kb-1' }));
    repo.findByOrganizationAndName.mockResolvedValue(buildRow({ id: 'kb-2' }));

    await expect(
      service.update(adminScope, 'kb-1', { name: 'Conflict' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when new name is blank', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(buildRow());

    await expect(
      service.update(adminScope, 'kb-1', { name: '  ' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('VectorDbService.delete', () => {
  it('soft-deletes an existing vector database (returns void)', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(buildRow());
    repo.countProjectReferences.mockResolvedValue(0);
    repo.delete.mockResolvedValue(true);

    await expect(service.delete(adminScope, 'kb-1')).resolves.toBeUndefined();
  });

  it('throws NotFoundException when KB not found', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(null);

    await expect(service.delete(adminScope, 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ConflictException when project references exist', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);
    repo.findByIdInOrg.mockResolvedValue(buildRow());
    repo.countProjectReferences.mockResolvedValue(2);

    await expect(service.delete(adminScope, 'kb-1')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('VectorDbService.requireOrg (non-superadmin)', () => {
  it('throws ForbiddenException when no active organization', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);

    await expect(
      service.list({
        userId: 'u',
        platformRole: 'admin',
        activeOrganizationId: null,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when organizationId mismatches active org', async () => {
    const repo = buildRepositoryMock();
    const service = makeService(repo);

    await expect(
      service.list({
        userId: 'u',
        platformRole: 'admin',
        activeOrganizationId: 'org-1',
        organizationId: 'org-other',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('VectorDbService.uploadFile', () => {
  const scope = adminScope;
  const file = {
    buffer: Buffer.from('hello'),
    originalname: 'doc.txt',
    mimetype: 'text/plain',
    size: 5,
  } as unknown as Express.Multer.File;

  it('puts to S3 and creates an ingestion job row', async () => {
    const repo = buildRepositoryMock();
    const uploader = buildUploaderMock();
    const service = makeService(repo, uploader);

    repo.findByIdInOrg.mockResolvedValue(buildRow());
    repo.createIngestionJob.mockResolvedValue(buildJobRow());

    const result = await service.uploadFile(scope, 'kb-1', file);

    expect(uploader.put).toHaveBeenCalledTimes(1);
    expect(repo.createIngestionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        vectorDbId: 'kb-1',
        originalFilename: 'doc.txt',
        contentType: 'text/plain',
        fileSizeBytes: 5,
      }),
    );
    expect(result.status).toBe('pending');
    expect(result.vectorDbId).toBe('kb-1');
  });

  it('throws BadRequestException when no file is provided', async () => {
    const service = makeService(buildRepositoryMock());
    await expect(
      service.uploadFile(scope, 'kb-1', undefined as unknown as Express.Multer.File),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for disallowed MIME type', async () => {
    const service = makeService(buildRepositoryMock());
    const badFile = { ...file, mimetype: 'application/x-executable' } as Express.Multer.File;
    await expect(service.uploadFile(scope, 'kb-1', badFile)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows file exactly at the 50 MB limit', async () => {
    const repo = buildRepositoryMock();
    const uploader = buildUploaderMock();
    const service = makeService(repo, uploader);
    repo.findByIdInOrg.mockResolvedValue(buildRow());
    repo.createIngestionJob.mockResolvedValue(buildJobRow());

    const atLimit = { ...file, size: 50 * 1024 * 1024 } as Express.Multer.File;
    await expect(service.uploadFile(scope, 'kb-1', atLimit)).resolves.toBeDefined();
  });

  it('throws BadRequestException when file exceeds 50 MB', async () => {
    const service = makeService(buildRepositoryMock());
    const over = { ...file, size: 50 * 1024 * 1024 + 1 } as Express.Multer.File;
    await expect(service.uploadFile(scope, 'kb-1', over)).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when vectorDb is not in org', async () => {
    const repo = buildRepositoryMock();
    repo.findByIdInOrg.mockResolvedValue(null);
    const service = makeService(repo);
    await expect(service.uploadFile(scope, 'missing-id', file)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('propagates S3 put failure and does not create an ingestion job', async () => {
    const repo = buildRepositoryMock();
    const uploader = buildUploaderMock();
    const service = makeService(repo, uploader);
    repo.findByIdInOrg.mockResolvedValue(buildRow());
    uploader.put.mockRejectedValue(new Error('S3 unavailable'));

    await expect(service.uploadFile(scope, 'kb-1', file)).rejects.toThrow('S3 unavailable');
    expect(repo.createIngestionJob).not.toHaveBeenCalled();
  });

  it('propagates DB failure after S3 put without swallowing the error', async () => {
    const repo = buildRepositoryMock();
    const uploader = buildUploaderMock();
    const service = makeService(repo, uploader);
    repo.findByIdInOrg.mockResolvedValue(buildRow());
    repo.createIngestionJob.mockRejectedValue(new Error('DB down'));

    await expect(service.uploadFile(scope, 'kb-1', file)).rejects.toThrow('DB down');
    expect(uploader.put).toHaveBeenCalledTimes(1);
    expect(repo.createIngestionJob).toHaveBeenCalledTimes(1);
  });
});
