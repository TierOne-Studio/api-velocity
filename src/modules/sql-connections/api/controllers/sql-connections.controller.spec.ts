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

  // ADR-012: sql-connection:* permission family. Test endpoints map to :update
  // grade because they reveal connection metadata (defensible-but-debatable;
  // see ADR-012 Consequences > Negative).
  it.each([
    ['list', 'sql-connection:read'],
    ['create', 'sql-connection:create'],
    ['update', 'sql-connection:update'],
    ['remove', 'sql-connection:delete'],
    ['testCredentials', 'sql-connection:update'],
    ['test', 'sql-connection:update'],
  ] as const)('requires %s on the %s endpoint', (method, expected) => {
    const handler = (controller as unknown as Record<string, object>)[method];
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      handler,
    ) as string[];

    expect(permissions).toContain(expected);
  });

  // Regression pin: the swap from organization:* to sql-connection:* must be
  // complete on every endpoint. If any decorator is left as organization:*,
  // this test fails.
  it('no endpoint still requires organization:read or organization:update', () => {
    for (const method of [
      'list',
      'create',
      'update',
      'remove',
      'testCredentials',
      'test',
    ] as const) {
      const handler = (controller as unknown as Record<string, object>)[method];
      const permissions =
        (Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[]) ?? [];
      expect(permissions).not.toContain('organization:read');
      expect(permissions).not.toContain('organization:update');
    }
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