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
import { KnowledgeBaseService } from '../../application/services/knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';

const session = {
  user: { id: 'user-1', role: 'admin' },
  session: { activeOrganizationId: 'org-1' },
} as unknown as UserSession;

describe('KnowledgeBaseController', () => {
  let controller: KnowledgeBaseController;
  let service: jest.Mocked<KnowledgeBaseService>;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findByIdForAttach: jest.fn(),
      findManyByIdsForOrg: jest.fn(),
    } as unknown as jest.Mocked<KnowledgeBaseService>;

    controller = new KnowledgeBaseController(service);
  });

  it('applies the class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      KnowledgeBaseController,
    ) as unknown[];
    expect(guards).toContain(PermissionsGuard);
  });

  it.each([
    ['list', 'knowledge-base:read'],
    ['getById', 'knowledge-base:read'],
    ['create', 'knowledge-base:create'],
    ['update', 'knowledge-base:update'],
    ['remove', 'knowledge-base:delete'],
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

  it('remove returns the service result directly', async () => {
    service.delete.mockResolvedValue({ deleted: true });

    const result = await controller.remove(session, 'kb-1');
    expect(result).toEqual({ deleted: true });
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
