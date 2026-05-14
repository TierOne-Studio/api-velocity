import { jest } from '@jest/globals';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '../../../../shared/config';
import { encryptAesGcm } from '../../../../shared/crypto/aes-gcm';
import type { SqlConnectionRow } from '../../api/dto/sql-connection.dto';
import type { ISqlConnectionsRepository } from '../../domain/sql-connection.repository';
import { SqlConnectionsService } from './sql-connections.service';
import type {
  SqlConnectionTester,
  TestConnectionResult,
} from './sql-connection-tester';

const secretKey = Buffer.from(
  '0123456789abcdef0123456789abcdef',
).toString('base64');
const now = '2026-04-22T00:00:00.000Z';

const adminScope = {
  userId: 'user-1',
  platformRole: 'admin' as const,
  activeOrganizationId: 'org-1',
};

function buildRepositoryMock(): jest.Mocked<ISqlConnectionsRepository> {
  return {
    create: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    findById: jest.fn(),
    findByIdInOrg: jest.fn(),
    findManyByIdsForOrg: jest.fn(),
    listForOrganization: jest.fn(),
    findByOrganizationAndName: jest.fn(),
    delete: jest.fn(),
    countProjectReferences: jest.fn<() => Promise<number>>().mockResolvedValue(0),
  } as unknown as jest.Mocked<ISqlConnectionsRepository>;
}

function buildRow(overrides: Partial<SqlConnectionRow> = {}): SqlConnectionRow {
  const encrypted = encryptAesGcm('stored-secret', secretKey);
  return {
    id: 'conn-1',
    organization_id: 'org-1',
    name: 'Reporting DB',
    host: 'db.example.com',
    port: 5432,
    database: 'reporting',
    username: 'reader',
    password_ciphertext: encrypted.ciphertext,
    password_iv: encrypted.iv,
    password_tag: encrypted.tag,
    ssl: false,
    schema_name: 'public',
    allowed_tables: null,
    status: 'ready',
    status_error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('SqlConnectionsService.decryptPassword lazy upgrade (C3b)', () => {
  let repository: jest.Mocked<ISqlConnectionsRepository>;
  let configService: jest.Mocked<ConfigService>;
  let tester: jest.Mocked<SqlConnectionTester>;
  let service: SqlConnectionsService;
  const oldKey = Buffer.from('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').toString(
    'base64',
  );

  beforeEach(() => {
    repository = buildRepositoryMock();
    configService = {
      getProjectSourceSecretKey: jest.fn().mockReturnValue(secretKey),
      getProjectSourceSecretKeyPrevious: jest.fn().mockReturnValue(null),
      getSqlAgentConnectTimeoutMs: jest.fn().mockReturnValue(1000),
    } as unknown as jest.Mocked<ConfigService>;
    tester = {
      test: jest.fn<() => Promise<TestConnectionResult>>(),
    } as unknown as jest.Mocked<SqlConnectionTester>;
    service = new SqlConnectionsService(repository, configService, tester);

    // Suppress NestJS Logger output during the test (the upgrade path logs
    // success/failure of the fire-and-forget repository.update).
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('triggers repository.update when a v0 (legacy) row is decrypted', async () => {
    const v1 = encryptAesGcm('legacy-secret', secretKey);
    const v0Row = buildRow({
      // Strip the v1 prefix to simulate a pre-C3a row.
      password_ciphertext: v1.ciphertext.slice(3),
      password_iv: v1.iv,
      password_tag: v1.tag,
    });
    repository.findManyByIdsForOrg.mockResolvedValue([v0Row]);
    (repository.update as jest.Mock).mockResolvedValue(v0Row as never);

    await service.resolveForAgent('org-1', ['conn-1']);

    // The fire-and-forget upgrade scheduled an async update; flush microtasks.
    await new Promise((r) => setImmediate(r));

    expect(repository.update).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({
        passwordCiphertext: expect.stringMatching(/^v1:/),
        passwordIv: expect.any(String),
        passwordTag: expect.any(String),
      }),
    );
  });

  it('does NOT trigger repository.update for a v1 row under the current key', async () => {
    const v1 = encryptAesGcm('current-secret', secretKey);
    const v1Row = buildRow({
      password_ciphertext: v1.ciphertext,
      password_iv: v1.iv,
      password_tag: v1.tag,
    });
    repository.findManyByIdsForOrg.mockResolvedValue([v1Row]);

    await service.resolveForAgent('org-1', ['conn-1']);
    await new Promise((r) => setImmediate(r));

    expect(repository.update).not.toHaveBeenCalled();
  });

  it('triggers repository.update when the previous key was needed (rotation)', async () => {
    const v1UnderOld = encryptAesGcm('rotated-secret', oldKey);
    const rotatedRow = buildRow({
      password_ciphertext: v1UnderOld.ciphertext,
      password_iv: v1UnderOld.iv,
      password_tag: v1UnderOld.tag,
    });
    configService.getProjectSourceSecretKeyPrevious = jest
      .fn()
      .mockReturnValue(oldKey) as never;
    repository.findManyByIdsForOrg.mockResolvedValue([rotatedRow]);
    (repository.update as jest.Mock).mockResolvedValue(rotatedRow as never);

    await service.resolveForAgent('org-1', ['conn-1']);
    await new Promise((r) => setImmediate(r));

    expect(repository.update).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({
        passwordCiphertext: expect.stringMatching(/^v1:/),
      }),
    );
  });

  it('does not surface upgrade-write failures to the caller', async () => {
    const v1 = encryptAesGcm('legacy', secretKey);
    const v0Row = buildRow({
      password_ciphertext: v1.ciphertext.slice(3),
      password_iv: v1.iv,
      password_tag: v1.tag,
    });
    repository.findManyByIdsForOrg.mockResolvedValue([v0Row]);
    (repository.update as jest.Mock).mockRejectedValue(
      new Error('db write failed') as never,
    );

    // The caller still gets the resolved connection.
    const out = await service.resolveForAgent('org-1', ['conn-1']);
    await new Promise((r) => setImmediate(r));

    expect(out).toHaveLength(1);
    expect(out[0]!.password).toBe('legacy');
  });
});

describe('SqlConnectionsService.create / update — allowedTables (H1b)', () => {
  let repository: jest.Mocked<ISqlConnectionsRepository>;
  let configService: jest.Mocked<ConfigService>;
  let tester: jest.Mocked<SqlConnectionTester>;
  let service: SqlConnectionsService;

  const baseCreate = {
    name: 'reporting',
    host: 'db.example.com',
    port: 5432,
    database: 'reporting',
    username: 'reader',
    password: 'pw',
  };

  beforeEach(() => {
    repository = buildRepositoryMock();
    configService = {
      getProjectSourceSecretKey: jest.fn().mockReturnValue(secretKey),
      getProjectSourceSecretKeyPrevious: jest.fn().mockReturnValue(null),
      getSqlAgentConnectTimeoutMs: jest.fn().mockReturnValue(1000),
    } as unknown as jest.Mocked<ConfigService>;
    tester = {
      test: jest.fn<() => Promise<TestConnectionResult>>(),
    } as unknown as jest.Mocked<SqlConnectionTester>;
    service = new SqlConnectionsService(repository, configService, tester);
    repository.findByOrganizationAndName.mockResolvedValue(null);
    (repository.create as jest.Mock).mockImplementation((row: unknown) =>
      Promise.resolve(
        buildRow({
          allowed_tables: (row as { allowedTables: string[] | null }).allowedTables,
        }) as never,
      ),
    );
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists allowedTables=null when omitted (default = no allowlist)', async () => {
    await service.create(adminScope, baseCreate);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ allowedTables: null }),
    );
  });

  it('persists a valid array of unqualified table names', async () => {
    await service.create(adminScope, {
      ...baseCreate,
      allowedTables: ['users', 'orders'],
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ allowedTables: ['users', 'orders'] }),
    );
  });

  it('persists a valid array of schema-qualified table names', async () => {
    await service.create(adminScope, {
      ...baseCreate,
      allowedTables: ['analytics.orders', 'public.users'],
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedTables: ['analytics.orders', 'public.users'],
      }),
    );
  });

  it.each([
    ['empty array', []],
    ['malformed entry with SQL injection chars', ["users;DROP TABLE x"]],
    ['malformed entry with quote', ['"users"']],
    ['malformed entry starts with number', ['1users']],
    ['three-dot qualified', ['db.schema.table']],
    ['contains space', ['user accounts']],
    ['list of 201 entries', Array.from({ length: 201 }, (_, i) => `t_${i}`)],
  ])('rejects %s', async (_label, allowedTables) => {
    await expect(
      service.create(adminScope, { ...baseCreate, allowedTables }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('update with allowedTables=null clears the allowlist', async () => {
    const existing = buildRow({ allowed_tables: ['users'] });
    repository.findByIdInOrg.mockResolvedValue(existing);
    (repository.update as jest.Mock).mockResolvedValue(
      buildRow({ allowed_tables: null }) as never,
    );

    await service.update(adminScope, 'conn-1', { allowedTables: null });

    expect(repository.update).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ allowedTables: null }),
    );
  });

  it('update without allowedTables preserves existing value', async () => {
    const existing = buildRow({ allowed_tables: ['users'] });
    repository.findByIdInOrg.mockResolvedValue(existing);
    (repository.update as jest.Mock).mockResolvedValue(existing as never);

    await service.update(adminScope, 'conn-1', { name: 'renamed' });

    const patchArg = (repository.update as jest.Mock).mock.calls[0]![1];
    expect(patchArg).not.toHaveProperty('allowedTables');
  });

  it('update with malformed allowedTables is rejected', async () => {
    const existing = buildRow();
    repository.findByIdInOrg.mockResolvedValue(existing);

    await expect(
      service.update(adminScope, 'conn-1', {
        allowedTables: ['"x"'],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('SqlConnectionsService.delete — refuse-on-reference (M6)', () => {
  let repository: jest.Mocked<ISqlConnectionsRepository>;
  let configService: jest.Mocked<ConfigService>;
  let tester: jest.Mocked<SqlConnectionTester>;
  let service: SqlConnectionsService;

  beforeEach(() => {
    repository = buildRepositoryMock();
    configService = {
      getProjectSourceSecretKey: jest.fn().mockReturnValue(secretKey),
      getProjectSourceSecretKeyPrevious: jest.fn().mockReturnValue(null),
      getSqlAgentConnectTimeoutMs: jest.fn().mockReturnValue(1000),
    } as unknown as jest.Mocked<ConfigService>;
    tester = {
      test: jest.fn<() => Promise<TestConnectionResult>>(),
    } as unknown as jest.Mocked<SqlConnectionTester>;
    service = new SqlConnectionsService(repository, configService, tester);
  });

  it('deletes when no project references the connection', async () => {
    repository.findByIdInOrg.mockResolvedValue(buildRow());
    (repository.countProjectReferences as jest.Mock).mockResolvedValue(0 as never);
    (repository.delete as jest.Mock).mockResolvedValue(true as never);

    const out = await service.delete(adminScope, 'conn-1');

    expect(out).toEqual({ deleted: true });
    expect(repository.delete).toHaveBeenCalledWith('conn-1', 'org-1');
  });

  it('refuses delete with ConflictException when references exist', async () => {
    repository.findByIdInOrg.mockResolvedValue(buildRow());
    (repository.countProjectReferences as jest.Mock).mockResolvedValue(3 as never);

    await expect(service.delete(adminScope, 'conn-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('still throws NotFoundException for missing connection (no refuse-on-reference check leaks)', async () => {
    repository.findByIdInOrg.mockResolvedValue(null);
    await expect(service.delete(adminScope, 'missing')).rejects.toMatchObject({
      status: 404,
    });
    expect(repository.countProjectReferences).not.toHaveBeenCalled();
  });
});

describe('SqlConnectionsService.testCredentials', () => {
  let repository: jest.Mocked<ISqlConnectionsRepository>;
  let configService: jest.Mocked<ConfigService>;
  let tester: jest.Mocked<SqlConnectionTester>;
  let service: SqlConnectionsService;

  beforeEach(() => {
    repository = buildRepositoryMock();
    configService = {
      getProjectSourceSecretKey: jest.fn().mockReturnValue(secretKey),
      getProjectSourceSecretKeyPrevious: jest.fn().mockReturnValue(null),
      getSqlAgentConnectTimeoutMs: jest.fn().mockReturnValue(1000),
    } as unknown as jest.Mocked<ConfigService>;
    tester = {
      test: jest.fn<() => Promise<TestConnectionResult>>(),
    } as unknown as jest.Mocked<SqlConnectionTester>;

    service = new SqlConnectionsService(repository, configService, tester);
  });

  it('tests ad hoc credentials without loading a stored connection', async () => {
    tester.test.mockResolvedValue({ ok: true });

    const result = await service.testCredentials(adminScope, {
      host: 'db.example.com',
      port: 5432,
      database: 'reporting',
      username: 'reader',
      password: 'typed-secret',
      ssl: true,
    });

    expect(result).toEqual({ ok: true });
    expect(tester.test).toHaveBeenCalledWith({
      host: 'db.example.com',
      port: 5432,
      database: 'reporting',
      username: 'reader',
      password: 'typed-secret',
      ssl: true,
    });
    expect(repository.findByIdInOrg).not.toHaveBeenCalled();
  });

  it('reuses the stored password when connectionId is provided and password is omitted', async () => {
    repository.findByIdInOrg.mockResolvedValue(buildRow());
    tester.test.mockResolvedValue({ ok: true });

    await service.testCredentials(adminScope, {
      connectionId: 'conn-1',
      host: 'db.example.com',
      port: 5432,
      database: 'reporting',
      username: 'reader',
      ssl: false,
    });

    expect(repository.findByIdInOrg).toHaveBeenCalledWith('conn-1', 'org-1');
    expect(tester.test).toHaveBeenCalledWith({
      host: 'db.example.com',
      port: 5432,
      database: 'reporting',
      username: 'reader',
      password: 'stored-secret',
      ssl: false,
    });
  });

  it('rejects omitted passwords when no stored connection is provided', async () => {
    await expect(
      service.testCredentials(adminScope, {
        host: 'db.example.com',
        port: 5432,
        database: 'reporting',
        username: 'reader',
        ssl: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tester.test).not.toHaveBeenCalled();
  });

  it('rejects missing stored connections when password reuse is requested', async () => {
    repository.findByIdInOrg.mockResolvedValue(null);

    await expect(
      service.testCredentials(adminScope, {
        connectionId: 'conn-404',
        host: 'db.example.com',
        port: 5432,
        database: 'reporting',
        username: 'reader',
        ssl: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns failed test results without persisting status', async () => {
    tester.test.mockResolvedValue({ ok: false, error: 'connect timeout' });

    const result = await service.testCredentials(adminScope, {
      host: 'db.example.com',
      port: 5432,
      database: 'reporting',
      username: 'reader',
      password: 'typed-secret',
      ssl: false,
    });

    expect(result).toEqual({ ok: false, error: 'connect timeout' });
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });
});