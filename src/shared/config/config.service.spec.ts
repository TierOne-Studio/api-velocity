import { jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from './config.service';

describe('ConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getPort', () => {
    it('should return default port 3000 when PORT is not set', () => {
      delete process.env.PORT;
      const configService = new ConfigService();
      expect(configService.getPort()).toBe(3000);
    });

    it('should return custom port from PORT env var', () => {
      process.env.PORT = '8080';
      const configService = new ConfigService();
      expect(configService.getPort()).toBe(8080);
    });
  });

  describe('getAuthSecret', () => {
    it('should return AUTH_SECRET when set', () => {
      process.env.AUTH_SECRET = 'my-secret-key';
      const configService = new ConfigService();
      expect(configService.getAuthSecret()).toBe('my-secret-key');
    });

    it('should throw when AUTH_SECRET is not set', () => {
      delete process.env.AUTH_SECRET;
      const configService = new ConfigService();
      expect(() => configService.getAuthSecret()).toThrow(
        'AUTH_SECRET environment variable is required',
      );
    });
  });

  describe('getBaseUrl', () => {
    it('should return default base URL when BASE_URL is not set', () => {
      delete process.env.BASE_URL;
      const configService = new ConfigService();
      expect(configService.getBaseUrl()).toBe('http://localhost:3000');
    });

    it('should return custom BASE_URL when set', () => {
      process.env.BASE_URL = 'https://api.example.com';
      const configService = new ConfigService();
      expect(configService.getBaseUrl()).toBe('https://api.example.com');
    });
  });

  describe('getDatabaseUrl', () => {
    it('should return DATABASE_URL when set', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      const configService = new ConfigService();
      expect(configService.getDatabaseUrl()).toBe(
        'postgresql://user:pass@localhost:5432/db',
      );
    });

    it('should throw when DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL;
      const configService = new ConfigService();
      expect(() => configService.getDatabaseUrl()).toThrow(
        'DATABASE_URL environment variable is required',
      );
    });
  });

  describe('getTrustedOrigins', () => {
    it('should read TRUSTED_ORIGINS from the environment', () => {
      process.env.TRUSTED_ORIGINS =
        'http://localhost:5173,http://127.0.0.1:65520';

      const configService = new ConfigService();

      expect(configService.getTrustedOrigins()).toEqual([
        'http://localhost:5173',
        'http://127.0.0.1:65520',
      ]);
    });

    it('should return default origins when TRUSTED_ORIGINS is not set', () => {
      delete process.env.TRUSTED_ORIGINS;

      const configService = new ConfigService();

      expect(configService.getTrustedOrigins()).toEqual([
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
      ]);
    });
  });

  describe('getResendApiKey', () => {
    it('should return RESEND_API_KEY when set', () => {
      process.env.RESEND_API_KEY = 're_test_key_123';
      const configService = new ConfigService();
      expect(configService.getResendApiKey()).toBe('re_test_key_123');
    });

    it('should return empty string when RESEND_API_KEY is not set', () => {
      delete process.env.RESEND_API_KEY;
      const configService = new ConfigService();
      expect(configService.getResendApiKey()).toBe('');
    });
  });

  describe('getFromEmail', () => {
    it('should return FROM_EMAIL when set', () => {
      process.env.FROM_EMAIL = 'hello@myapp.com';
      const configService = new ConfigService();
      expect(configService.getFromEmail()).toBe('hello@myapp.com');
    });

    it('should return default from email when FROM_EMAIL is not set', () => {
      delete process.env.FROM_EMAIL;
      const configService = new ConfigService();
      expect(configService.getFromEmail()).toBe('noreply@example.com');
    });
  });

  describe('getFeUrl', () => {
    it('should return FE_URL when set', () => {
      process.env.FE_URL = 'https://app.example.com';
      const configService = new ConfigService();
      expect(configService.getFeUrl()).toBe('https://app.example.com');
    });

    it('should return default FE URL when FE_URL is not set', () => {
      delete process.env.FE_URL;
      const configService = new ConfigService();
      expect(configService.getFeUrl()).toBe('http://localhost:5173');
    });
  });

  describe('getAirweaveApiKey', () => {
    it('returns AIRWEAVE_API_KEY when set', () => {
      process.env.AIRWEAVE_API_KEY = 'sk-airweave';

      const configService = new ConfigService();

      expect(configService.getAirweaveApiKey()).toBe('sk-airweave');
    });

    it('returns null when AIRWEAVE_API_KEY is not set', () => {
      delete process.env.AIRWEAVE_API_KEY;

      const configService = new ConfigService();

      expect(configService.getAirweaveApiKey()).toBeNull();
    });
  });

  describe('getAirweaveBaseUrl', () => {
    it('returns AIRWEAVE_BASE_URL when set', () => {
      process.env.AIRWEAVE_BASE_URL = 'https://sandbox.airweave.ai';

      const configService = new ConfigService();

      expect(configService.getAirweaveBaseUrl()).toBe(
        'https://sandbox.airweave.ai',
      );
    });

    it('returns the production Airweave URL by default', () => {
      delete process.env.AIRWEAVE_BASE_URL;

      const configService = new ConfigService();

      expect(configService.getAirweaveBaseUrl()).toBe(
        'https://api.airweave.ai',
      );
    });
  });

  describe('getOpenAiApiKey', () => {
    it('returns OPENAI_API_KEY when set', () => {
      process.env.OPENAI_API_KEY = 'sk-openai';

      const configService = new ConfigService();

      expect(configService.getOpenAiApiKey()).toBe('sk-openai');
    });

    it('returns null when OPENAI_API_KEY is not set', () => {
      delete process.env.OPENAI_API_KEY;

      const configService = new ConfigService();

      expect(configService.getOpenAiApiKey()).toBeNull();
    });
  });

  describe('getOpenAiModel', () => {
    it('returns OPENAI_MODEL when set', () => {
      process.env.OPENAI_MODEL = 'gpt-4o-mini';

      const configService = new ConfigService();

      expect(configService.getOpenAiModel()).toBe('gpt-4o-mini');
    });

    it('returns gpt-5.4-nano by default', () => {
      delete process.env.OPENAI_MODEL;

      const configService = new ConfigService();

      expect(configService.getOpenAiModel()).toBe('gpt-5.4-nano');
    });
  });

  describe('getChatSystemPrompt', () => {
    let tempDir: string;
    let warnSpy: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'config-service-prompt-'));
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns CHAT_SYSTEM_PROMPT when set inline', () => {
      process.env.CHAT_SYSTEM_PROMPT = 'inline override';
      delete process.env.CHAT_SYSTEM_PROMPT_PATH;

      const configService = new ConfigService();

      expect(configService.getChatSystemPrompt()).toBe('inline override');
    });

    it('returns the file content when CHAT_SYSTEM_PROMPT_PATH is set', () => {
      delete process.env.CHAT_SYSTEM_PROMPT;
      const promptPath = join(tempDir, 'custom-prompt.md');
      writeFileSync(promptPath, '   custom prompt from file   \n', 'utf-8');
      process.env.CHAT_SYSTEM_PROMPT_PATH = promptPath;

      const configService = new ConfigService();

      expect(configService.getChatSystemPrompt()).toBe(
        'custom prompt from file',
      );
    });

    it('inline CHAT_SYSTEM_PROMPT takes precedence over CHAT_SYSTEM_PROMPT_PATH', () => {
      process.env.CHAT_SYSTEM_PROMPT = 'inline wins';
      const promptPath = join(tempDir, 'ignored.md');
      writeFileSync(promptPath, 'should not be read', 'utf-8');
      process.env.CHAT_SYSTEM_PROMPT_PATH = promptPath;

      const configService = new ConfigService();

      expect(configService.getChatSystemPrompt()).toBe('inline wins');
    });

    it('falls back to the default prompt file when CHAT_SYSTEM_PROMPT_PATH points to a missing file', () => {
      delete process.env.CHAT_SYSTEM_PROMPT;
      process.env.CHAT_SYSTEM_PROMPT_PATH = join(tempDir, 'does-not-exist.md');

      const configService = new ConfigService();

      const prompt = configService.getChatSystemPrompt();
      expect(prompt).toContain('expert knowledge assistant');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('CHAT_SYSTEM_PROMPT_PATH'),
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('returns the default expert persona prompt from the bundled file when no env override is set', () => {
      delete process.env.CHAT_SYSTEM_PROMPT;
      delete process.env.CHAT_SYSTEM_PROMPT_PATH;

      const configService = new ConfigService();

      const prompt = configService.getChatSystemPrompt();
      expect(prompt).toContain('expert knowledge assistant');
      expect(prompt).toContain('grounded **only** in the source context');
      expect(prompt).toContain('When context is insufficient');
    });

    it('caches the default prompt file read across calls', () => {
      delete process.env.CHAT_SYSTEM_PROMPT;
      delete process.env.CHAT_SYSTEM_PROMPT_PATH;

      const configService = new ConfigService();

      const first = configService.getChatSystemPrompt();
      const second = configService.getChatSystemPrompt();

      expect(first).toBe(second);
    });
  });

  describe('getChatRateLimitTtl', () => {
    it('returns CHAT_RATE_LIMIT_TTL when set', () => {
      process.env.CHAT_RATE_LIMIT_TTL = '30000';

      const configService = new ConfigService();

      expect(configService.getChatRateLimitTtl()).toBe(30000);
    });

    it('returns 60000 by default', () => {
      delete process.env.CHAT_RATE_LIMIT_TTL;

      const configService = new ConfigService();

      expect(configService.getChatRateLimitTtl()).toBe(60000);
    });
  });

  describe('getChatRateLimitMax', () => {
    it('returns CHAT_RATE_LIMIT_MAX when set', () => {
      process.env.CHAT_RATE_LIMIT_MAX = '10';

      const configService = new ConfigService();

      expect(configService.getChatRateLimitMax()).toBe(10);
    });

    it('returns 20 by default', () => {
      delete process.env.CHAT_RATE_LIMIT_MAX;

      const configService = new ConfigService();

      expect(configService.getChatRateLimitMax()).toBe(20);
    });
  });

  describe('isTestMode', () => {
    it('should return true when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      const configService = new ConfigService();
      expect(configService.isTestMode()).toBe(true);
    });

    it('should return false when NODE_ENV is not test', () => {
      process.env.NODE_ENV = 'production';
      const configService = new ConfigService();
      expect(configService.isTestMode()).toBe(false);
    });
  });

  describe('validateEnvironment', () => {
    it('should not throw when all required env vars are present', () => {
      process.env.AUTH_SECRET = 'secret';
      process.env.DATABASE_URL = 'postgresql://localhost/db';
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).not.toThrow();
    });

    it('should throw when AUTH_SECRET is missing', () => {
      delete process.env.AUTH_SECRET;
      process.env.DATABASE_URL = 'postgresql://localhost/db';
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow(
        'Missing required environment variables: AUTH_SECRET',
      );
    });

    it('should throw when DATABASE_URL is missing', () => {
      process.env.AUTH_SECRET = 'secret';
      delete process.env.DATABASE_URL;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow(
        'Missing required environment variables: DATABASE_URL',
      );
    });

    it('should list all missing vars when multiple are absent', () => {
      delete process.env.AUTH_SECRET;
      delete process.env.DATABASE_URL;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow('AUTH_SECRET');
    });
  });

  describe('shouldEnforceResendTestRecipients', () => {
    it('returns true when running in NODE_ENV=test', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.DOTENV_CONFIG_PATH;

      const configService = new ConfigService();

      expect(configService.shouldEnforceResendTestRecipients()).toBe(true);
    });

    it('returns true when DOTENV_CONFIG_PATH points to .env.test', () => {
      process.env.NODE_ENV = 'development';
      process.env.DOTENV_CONFIG_PATH = '/tmp/project/.env.test';

      const configService = new ConfigService();

      expect(configService.shouldEnforceResendTestRecipients()).toBe(true);
    });

    it('respects explicit override when ENFORCE_RESEND_TEST_RECIPIENTS=false', () => {
      process.env.NODE_ENV = 'test';
      process.env.ENFORCE_RESEND_TEST_RECIPIENTS = 'false';

      const configService = new ConfigService();

      expect(configService.shouldEnforceResendTestRecipients()).toBe(false);
    });

    it('returns true when ENFORCE_RESEND_TEST_RECIPIENTS=true explicitly', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DOTENV_CONFIG_PATH;
      process.env.ENFORCE_RESEND_TEST_RECIPIENTS = 'true';

      const configService = new ConfigService();

      expect(configService.shouldEnforceResendTestRecipients()).toBe(true);
    });

    it('returns false in production with no overrides', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DOTENV_CONFIG_PATH;
      delete process.env.ENFORCE_RESEND_TEST_RECIPIENTS;

      const configService = new ConfigService();

      expect(configService.shouldEnforceResendTestRecipients()).toBe(false);
    });
  });
});
