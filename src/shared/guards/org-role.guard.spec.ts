import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRoleGuard, OrgRoles, ORG_ROLES_KEY } from './org-role.guard';

describe('OrgRoleGuard', () => {
  let guard: OrgRoleGuard;
  let reflector: Reflector;

  const createMockExecutionContext = (
    session: unknown,
    orgMemberRole?: string,
  ): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ session, orgMemberRole }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrgRoleGuard, Reflector],
    }).compile();

    guard = module.get<OrgRoleGuard>(OrgRoleGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('when no org roles are required', () => {
    it('should allow access when no roles metadata', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockExecutionContext(
        { user: { role: 'member' } },
        'member',
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access when empty roles array', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
      const context = createMockExecutionContext(
        { user: { role: 'member' } },
        'member',
      );
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('when org roles are required', () => {
    beforeEach(() => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['admin', 'manager']);
    });

    it('should allow access for user with matching org role (admin)', () => {
      const context = createMockExecutionContext(
        { user: { role: 'admin' } },
        'admin',
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access for user with matching org role (manager)', () => {
      const context = createMockExecutionContext(
        { user: { role: 'manager' } },
        'manager',
      );
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny access for user without matching org role', () => {
      const context = createMockExecutionContext(
        { user: { role: 'member' } },
        'member',
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when no session', () => {
      const context = createMockExecutionContext(null, 'admin');
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when session has no user', () => {
      const context = createMockExecutionContext({}, 'admin');
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when orgMemberRole is missing', () => {
      const context = createMockExecutionContext(
        { user: { role: 'admin' } },
        undefined,
      );
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});

describe('OrgRoles decorator', () => {
  it('should define org roles metadata on a method', () => {
    class TestController {
      testMethod() {}
    }

    const descriptor = Object.getOwnPropertyDescriptor(
      TestController.prototype,
      'testMethod',
    );

    OrgRoles('admin', 'manager')(
      TestController.prototype,
      'testMethod',
      descriptor,
    );

    const metadata = Reflect.getMetadata(ORG_ROLES_KEY, descriptor.value);
    expect(metadata).toEqual(['admin', 'manager']);
  });

  it('should define org roles metadata on a class', () => {
    class TestController {}

    OrgRoles('admin')(TestController);

    const metadata = Reflect.getMetadata(ORG_ROLES_KEY, TestController);
    expect(metadata).toEqual(['admin']);
  });
});
