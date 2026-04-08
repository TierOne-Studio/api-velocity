import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const createMockExecutionContext = (session: unknown): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ session }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, Reflector],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('when no roles are required', () => {
    it('should allow access', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
      const context = createMockExecutionContext({ user: { role: 'user' } });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('when roles are required', () => {
    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    });

    it('should allow access for user with required role', () => {
      const context = createMockExecutionContext({ user: { role: 'admin' } });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny access for user without required role', () => {
      const context = createMockExecutionContext({ user: { role: 'user' } });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when no session exists', () => {
      const context = createMockExecutionContext(null);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny access when session has no user', () => {
      const context = createMockExecutionContext({});
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('when multiple roles are allowed', () => {
    beforeEach(() => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValue(['admin', 'moderator']);
    });

    it('should allow access for admin', () => {
      const context = createMockExecutionContext({ user: { role: 'admin' } });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow access for moderator', () => {
      const context = createMockExecutionContext({
        user: { role: 'moderator' },
      });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny access for user', () => {
      const context = createMockExecutionContext({ user: { role: 'user' } });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});
