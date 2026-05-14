import { jest } from '@jest/globals';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => {},
  AllowAnonymous: () => () => {},
  BetterAuthGuard: class {},
  BetterAuthModule: { forRoot: jest.fn(() => ({ module: class {} })) },
}));

import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PermissionsGuard, PERMISSIONS_KEY } from '../../../../shared';
import { SqlConnectionsService } from '../../application/services/sql-connections.service';
import { SqlConnectionsController } from './sql-connections.controller';

describe('SqlConnectionsController', () => {
  let controller: SqlConnectionsController;
  let service: jest.Mocked<SqlConnectionsService>;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      testById: jest.fn(),
      testCredentials: jest.fn(),
      resolveForAgent: jest.fn(),
      findByIdForAttach: jest.fn(),
    } as unknown as jest.Mocked<SqlConnectionsService>;

    controller = new SqlConnectionsController(service);
  });

  it('applies the class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SqlConnectionsController,
    ) as unknown[];

    expect(guards).toContain(PermissionsGuard);
  });

  it('requires organization:update for credential tests', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      controller.testCredentials as object,
    ) as string[];

    expect(permissions).toContain('organization:update');
  });

  it('forwards ad hoc credential tests with the caller scope', async () => {
    service.testCredentials.mockResolvedValue({ ok: true } as never);
    const session = {
      user: { id: 'user-1', role: 'admin' },
      session: { activeOrganizationId: 'org-1' },
    } as unknown as UserSession;

    const result = await controller.testCredentials(session, {
      host: 'db.example.com',
      port: 5432,
      database: 'reporting',
      username: 'reader',
      password: 'typed-secret',
      ssl: false,
    });

    expect(service.testCredentials).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        platformRole: 'admin',
        activeOrganizationId: 'org-1',
        organizationId: undefined,
      },
      {
        host: 'db.example.com',
        port: 5432,
        database: 'reporting',
        username: 'reader',
        password: 'typed-secret',
        ssl: false,
      },
    );
    expect(result).toEqual({ data: { ok: true } });
  });

  it('rejects non-object bodies for credential tests', async () => {
    const session = {
      user: { id: 'user-1', role: 'admin' },
      session: { activeOrganizationId: 'org-1' },
    } as unknown as UserSession;

    await expect(
      controller.testCredentials(session, null as never),
    ).rejects.toThrow('body must be an object');
  });
});