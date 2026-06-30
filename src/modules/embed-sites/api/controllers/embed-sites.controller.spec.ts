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
import { EmbedSitesService } from '../../application/embed-sites.service';
import { EmbedSitesController } from './embed-sites.controller';

const session = {
  user: { id: 'user-1', role: 'admin' },
  session: { activeOrganizationId: 'org-1' },
} as unknown as UserSession;

describe('EmbedSitesController', () => {
  let controller: EmbedSitesController;
  let service: jest.Mocked<EmbedSitesService>;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      rotateKey: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<EmbedSitesService>;

    controller = new EmbedSitesController(service);
  });

  it('applies the class-level PermissionsGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      EmbedSitesController,
    ) as unknown[];
    expect(guards).toContain(PermissionsGuard);
  });

  it.each([
    ['list', 'embed-site:read'],
    ['getById', 'embed-site:read'],
    ['create', 'embed-site:create'],
    ['update', 'embed-site:update'],
    ['rotateKey', 'embed-site:update'],
    ['remove', 'embed-site:delete'],
  ] as const)('%s requires %s permission', (method, expected) => {
    const handler = (controller as unknown as Record<string, object>)[method];
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      handler,
    ) as string[];
    expect(permissions).toContain(expected);
  });

  it('rotate-key is update-grade, NOT delete-grade (disposal stays admin-only)', () => {
    const handler = (controller as unknown as Record<string, object>)[
      'rotateKey'
    ];
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      handler,
    ) as string[];
    expect(permissions).toContain('embed-site:update');
    expect(permissions).not.toContain('embed-site:delete');
  });

  it('list delegates to service with the resolved scope and wraps result', async () => {
    service.list.mockResolvedValue([{ id: 's1' }] as never);
    const result = await controller.list(session);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(result).toEqual({ data: [{ id: 's1' }] });
  });

  it('create strips organizationId from the body into the scope', async () => {
    service.create.mockResolvedValue({ id: 's-new' } as never);
    const result = await controller.create(session, {
      name: 'W',
      projectId: 'p1',
      allowedOrigins: [],
      organizationId: 'org-override',
    });
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-override' }),
      { name: 'W', projectId: 'p1', allowedOrigins: [] },
    );
    expect(result).toEqual({ data: { id: 's-new' } });
  });

  it('rotateKey delegates to service.rotateKey', async () => {
    service.rotateKey.mockResolvedValue({ id: 's1' } as never);
    const result = await controller.rotateKey(session, 's1');
    expect(service.rotateKey).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      's1',
    );
    expect(result).toEqual({ data: { id: 's1' } });
  });

  it('remove calls service.delete and returns void (204)', async () => {
    service.delete.mockResolvedValue(undefined);
    const result = await controller.remove(session, 's1');
    expect(result).toBeUndefined();
    expect(service.delete).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      's1',
    );
  });

  it('create rejects a non-object body', async () => {
    await expect(controller.create(session, null as never)).rejects.toThrow(
      'body must be an object',
    );
  });

  it('update rejects a non-object body', async () => {
    await expect(
      controller.update(session, 's1', null as never),
    ).rejects.toThrow('body must be an object');
  });
});
