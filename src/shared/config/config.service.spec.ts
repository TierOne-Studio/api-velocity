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

    it('returns gpt-4o by default', () => {
      delete process.env.OPENAI_MODEL;

      const configService = new ConfigService();

      expect(configService.getOpenAiModel()).toBe('gpt-4o');
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
