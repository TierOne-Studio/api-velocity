import { Test, TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';

// Mock @thallesp/nestjs-better-auth to avoid ESM import issues with better-auth
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => () => {},
  Session: () => () => {},
  BetterAuthGuard: class {},
}));

import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;
  let appController: AppController;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get(AppController);
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('getPasswordPolicy', () => {
    it('should expose explicit password min length policy', () => {
      const appController = app.get(AppController);
      expect(appController.getPasswordPolicy()).toEqual({
        minLength: 8,
      });
    });
  });

  describe('getProfile', () => {
    it('should return the session object directly', () => {
      const session = {
        user: { id: 'user-1', email: 'user@test.com', role: 'admin' },
      };
      expect(appController.getProfile(session as any)).toBe(session);
    });
  });

  /**
   * PR#6 - Health check endpoint
   */
  describe('healthCheck', () => {
    it('should return status ok', () => {
      const result = appController.healthCheck();
      expect(result.status).toBe('ok');
    });

    it('should return a valid ISO timestamp', () => {
      const result = appController.healthCheck();
      expect(result.timestamp).toBeDefined();
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('should return uptime as a number', () => {
      const result = appController.healthCheck();
      expect(typeof result.uptime).toBe('number');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });
  });
});
