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
    status: 'ready',
    status_error: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

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