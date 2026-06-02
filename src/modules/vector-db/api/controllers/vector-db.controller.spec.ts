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
import { VectorDbService } from '../../application/services/vector-db.service';
import { VectorDbController } from './vector-db.controller';

const session = {
  user: { id: 'user-1', role: 'admin' },
  session: { activeOrganizationId: 'org-1' },
} as unknown as UserSession;

describe('VectorDbController', () => {
  let controller: VectorDbController;
  let service: jest.Mocked<VectorDbService>;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByIdForAttach: jest.fn(),
      findManyByIdsForOrg: jest.fn(),
    } as unknown as jest.Mocked<VectorDbService>;

    controller = new VectorDbController(service);
  });

  it('applies the class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      VectorDbController,
    ) as unknown[];
    expect(guards).toContain(PermissionsGuard);
  });

  it.each([
    ['list', 'vector-db:read'],
    ['getById', 'vector-db:read'],
    ['create', 'vector-db:create'],
    ['update', 'vector-db:update'],
    ['remove', 'vector-db:delete'],
  ] as const)('%s requires %s permission', (method, expected) => {
    const handler = (controller as unknown as Record<string, object>)[method];
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      handler,
    ) as string[];
    expect(permissions).toContain(expected);
  });

  it('list delegates to service and wraps result', async () => {
    const kb = { id: 'kb-1', name: 'Docs' };
    service.list.mockResolvedValue([kb] as never);

    const result = await controller.list(session);
    expect(result).toEqual({ data: [kb] });
  });

  it('create delegates to service and wraps result', async () => {
    const kb = { id: 'kb-new', name: 'New KB' };
    service.create.mockResolvedValue(kb as never);

    const result = await controller.create(session, { name: 'New KB' });
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      { name: 'New KB' },
    );
    expect(result).toEqual({ data: kb });
  });

  it('remove calls service.delete and returns void (204)', async () => {
    service.delete.mockResolvedValue(undefined);

    const result = await controller.remove(session, 'kb-1');
    expect(result).toBeUndefined();
    expect(service.delete).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'kb-1',
    );
  });

  it('create rejects non-object body', async () => {
    await expect(
      controller.create(session, null as never),
    ).rejects.toThrow('body must be an object');
  });

  it('update rejects non-object body', async () => {
    await expect(
      controller.update(session, 'kb-1', null as never),
    ).rejects.toThrow('body must be an object');
  });
});
