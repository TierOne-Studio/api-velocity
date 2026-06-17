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

  // TODO(2026-Q4): remove this breadcrumb once it's no longer surprising
  // the AGENT_FORBIDDEN_DATABASES tests are gone.
  //
  // The `getAgentForbiddenDatabases` getter (and the `AGENT_FORBIDDEN_DATABASES`
  // env var contract) were removed in ADR-010; the agent path now relies on
  // the SQL validator's instance-metadata deny-list, the SET TRANSACTION READ
  // ONLY chokepoint, and operator-provisioned SELECT-only Postgres role grants.

  describe('boundedInt SQL_AGENT_* knobs', () => {
    let warnSpy: jest.SpiedFunction<typeof console.warn>;
    beforeEach(() => {
      warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('uses the default silently when unset', () => {
      delete process.env.SQL_AGENT_STATEMENT_TIMEOUT_MS;
      const cs = new ConfigService();
      expect(cs.getSqlAgentStatementTimeoutMs()).toBe(5000);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('uses a valid value when set in range', () => {
      process.env.SQL_AGENT_STATEMENT_TIMEOUT_MS = '7500';
      const cs = new ConfigService();
      expect(cs.getSqlAgentStatementTimeoutMs()).toBe(7500);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns + falls back when env is non-numeric', () => {
      process.env.SQL_AGENT_STATEMENT_TIMEOUT_MS = 'abc';
      const cs = new ConfigService();
      expect(cs.getSqlAgentStatementTimeoutMs()).toBe(5000);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/SQL_AGENT_STATEMENT_TIMEOUT_MS.*not a positive integer/),
      );
    });

    it('warns + falls back when env is below min (e.g. 0 disables timeout)', () => {
      process.env.SQL_AGENT_STATEMENT_TIMEOUT_MS = '0';
      const cs = new ConfigService();
      expect(cs.getSqlAgentStatementTimeoutMs()).toBe(5000);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/SQL_AGENT_STATEMENT_TIMEOUT_MS=0.*outside.*range/),
      );
    });

    it('warns + falls back when env is above max (e.g. 1h timeout)', () => {
      process.env.SQL_AGENT_STATEMENT_TIMEOUT_MS = '3600000';
      const cs = new ConfigService();
      expect(cs.getSqlAgentStatementTimeoutMs()).toBe(5000);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('warns + falls back for negative values', () => {
      process.env.SQL_AGENT_MAX_ROWS = '-1';
      const cs = new ConfigService();
      expect(cs.getSqlAgentMaxRows()).toBe(200);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('warns + falls back when SQL_AGENT_POOL_MAX is suspiciously large', () => {
      process.env.SQL_AGENT_POOL_MAX = '10000';
      const cs = new ConfigService();
      expect(cs.getSqlAgentPoolMax()).toBe(2);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('honors a tightened SQL_AGENT_MAX_SQL_LENGTH', () => {
      process.env.SQL_AGENT_MAX_SQL_LENGTH = '256';
      const cs = new ConfigService();
      expect(cs.getSqlAgentMaxSqlLength()).toBe(256);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    // Regression guard: getSqlAgentSampleRows MUST return null when
    // unset so the caller can omit the parameter and let the
    // underlying SqlDatabase apply its own default (3). Returning 0
    // unconditionally would be a silent behavior change from "3 sample
    // rows in info-sql" to "0 sample rows".
    describe('getSqlAgentSampleRows', () => {
      it('returns null when SQL_AGENT_SAMPLE_ROWS is unset', () => {
        delete process.env.SQL_AGENT_SAMPLE_ROWS;
        const cs = new ConfigService();
        expect(cs.getSqlAgentSampleRows()).toBeNull();
      });

      it('returns null when SQL_AGENT_SAMPLE_ROWS is empty string', () => {
        process.env.SQL_AGENT_SAMPLE_ROWS = '';
        const cs = new ConfigService();
        expect(cs.getSqlAgentSampleRows()).toBeNull();
      });

      it('returns the explicit value when set to 0 (opt-in optimization)', () => {
        process.env.SQL_AGENT_SAMPLE_ROWS = '0';
        const cs = new ConfigService();
        expect(cs.getSqlAgentSampleRows()).toBe(0);
      });

      it('returns the explicit value when set in range (1-10)', () => {
        process.env.SQL_AGENT_SAMPLE_ROWS = '5';
        const cs = new ConfigService();
        expect(cs.getSqlAgentSampleRows()).toBe(5);
      });

      it('warns + returns the default (0) when env is above max', () => {
        // boundedInt's fallback when out of range is the second arg (0
        // here). This isn't ideal — out-of-range arguably should also
        // be null — but it matches the pattern of the other safety-
        // critical knobs. Operators get a warn so the issue surfaces.
        process.env.SQL_AGENT_SAMPLE_ROWS = '999';
        const cs = new ConfigService();
        expect(cs.getSqlAgentSampleRows()).toBe(0);
        expect(warnSpy).toHaveBeenCalled();
      });
    });
  });

  describe('getVectorDbMinScore', () => {
    let warnSpy: jest.SpiedFunction<typeof console.warn>;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      delete process.env.VECTOR_DB_MIN_SCORE_PCT;
      warnSpy.mockRestore();
    });

    it('defaults to 0.3 when unset', () => {
      delete process.env.VECTOR_DB_MIN_SCORE_PCT;
      expect(new ConfigService().getVectorDbMinScore()).toBeCloseTo(0.3, 5);
    });

    it('reads an in-range percent as a 0..1 fraction', () => {
      process.env.VECTOR_DB_MIN_SCORE_PCT = '45';
      expect(new ConfigService().getVectorDbMinScore()).toBeCloseTo(0.45, 5);
    });

    it('allows 0 (disable the floor)', () => {
      process.env.VECTOR_DB_MIN_SCORE_PCT = '0';
      expect(new ConfigService().getVectorDbMinScore()).toBe(0);
    });

    it('falls back to the default for out-of-range or non-numeric values', () => {
      process.env.VECTOR_DB_MIN_SCORE_PCT = '150';
      expect(new ConfigService().getVectorDbMinScore()).toBeCloseTo(0.3, 5);
      process.env.VECTOR_DB_MIN_SCORE_PCT = 'abc';
      expect(new ConfigService().getVectorDbMinScore()).toBeCloseTo(0.3, 5);
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

  describe('getAirweaveReadLockdownEnforce', () => {
    // Per amended ADR-011 § Decision 4 (after security review): env-aware
    // defaults — enforce in non-prod, observe in prod. Explicit env value
    // ('true' | 'false') always wins over the default.
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      delete process.env.AIRWEAVE_READ_LOCKDOWN_ENFORCE;
    });

    it('defaults to TRUE when NODE_ENV !== production (dev/staging enforce)', () => {
      delete process.env.AIRWEAVE_READ_LOCKDOWN_ENFORCE;
      process.env.NODE_ENV = 'development';

      expect(new ConfigService().getAirweaveReadLockdownEnforce()).toBe(true);
    });

    it('defaults to FALSE in production (observe-only soak window)', () => {
      delete process.env.AIRWEAVE_READ_LOCKDOWN_ENFORCE;
      process.env.NODE_ENV = 'production';

      expect(new ConfigService().getAirweaveReadLockdownEnforce()).toBe(false);
    });

    it('explicit "true" overrides the production default', () => {
      process.env.NODE_ENV = 'production';
      process.env.AIRWEAVE_READ_LOCKDOWN_ENFORCE = 'true';

      expect(new ConfigService().getAirweaveReadLockdownEnforce()).toBe(true);
    });

    it('explicit "false" overrides the non-prod default', () => {
      process.env.NODE_ENV = 'development';
      process.env.AIRWEAVE_READ_LOCKDOWN_ENFORCE = 'false';

      expect(new ConfigService().getAirweaveReadLockdownEnforce()).toBe(false);
    });

    it('non-boolean string values fall through to the env-aware default', () => {
      process.env.NODE_ENV = 'production';
      process.env.AIRWEAVE_READ_LOCKDOWN_ENFORCE = '1';
      expect(new ConfigService().getAirweaveReadLockdownEnforce()).toBe(false);

      process.env.NODE_ENV = 'staging';
      process.env.AIRWEAVE_READ_LOCKDOWN_ENFORCE = 'yes';
      expect(new ConfigService().getAirweaveReadLockdownEnforce()).toBe(true);
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
        expect.stringContaining('chat system prompt'),
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

  describe('getChatAgentMaxIterations', () => {
    it('returns CHAT_AGENT_MAX_ITERATIONS when set', () => {
      process.env.CHAT_AGENT_MAX_ITERATIONS = '8';
      const configService = new ConfigService();
      expect(configService.getChatAgentMaxIterations()).toBe(8);
    });

    it('returns 5 by default', () => {
      delete process.env.CHAT_AGENT_MAX_ITERATIONS;
      const configService = new ConfigService();
      expect(configService.getChatAgentMaxIterations()).toBe(5);
    });

    it('returns the default when the value is non-numeric', () => {
      process.env.CHAT_AGENT_MAX_ITERATIONS = 'not-a-number';
      const configService = new ConfigService();
      expect(configService.getChatAgentMaxIterations()).toBe(5);
    });

    it('returns the default when the value is below 1', () => {
      process.env.CHAT_AGENT_MAX_ITERATIONS = '0';
      const configService = new ConfigService();
      expect(configService.getChatAgentMaxIterations()).toBe(5);
    });
  });

  describe('getSqlAgentSystemPrompt', () => {
    it('instructs the SQL agent to quote mixed-case identifiers from schema inspection', () => {
      delete process.env.SQL_AGENT_SYSTEM_PROMPT;
      delete process.env.SQL_AGENT_SYSTEM_PROMPT_PATH;

      const configService = new ConfigService();

      const prompt = configService.getSqlAgentSystemPrompt();
      expect(prompt).toContain('mixed-case or camelCase');
      expect(prompt).toContain('"organizationId"');
      expect(prompt).toContain('"createdAt"');
    });
  });

  describe('getChatAgentToolResultCharCap', () => {
    it('returns CHAT_AGENT_TOOL_RESULT_CHAR_CAP when set', () => {
      process.env.CHAT_AGENT_TOOL_RESULT_CHAR_CAP = '2000';
      const configService = new ConfigService();
      expect(configService.getChatAgentToolResultCharCap()).toBe(2000);
    });

    it('returns 3000 by default', () => {
      delete process.env.CHAT_AGENT_TOOL_RESULT_CHAR_CAP;
      const configService = new ConfigService();
      expect(configService.getChatAgentToolResultCharCap()).toBe(3000);
    });

    it('returns the default when the value is too small to be useful', () => {
      process.env.CHAT_AGENT_TOOL_RESULT_CHAR_CAP = '100';
      const configService = new ConfigService();
      expect(configService.getChatAgentToolResultCharCap()).toBe(3000);
    });
  });

  describe('getChatAgentToolResultLimit', () => {
    it('returns CHAT_AGENT_TOOL_RESULT_LIMIT when set', () => {
      process.env.CHAT_AGENT_TOOL_RESULT_LIMIT = '20';
      const configService = new ConfigService();
      expect(configService.getChatAgentToolResultLimit()).toBe(20);
    });

    it('returns 12 by default', () => {
      delete process.env.CHAT_AGENT_TOOL_RESULT_LIMIT;
      const configService = new ConfigService();
      expect(configService.getChatAgentToolResultLimit()).toBe(12);
    });

    it('returns the default for invalid values', () => {
      process.env.CHAT_AGENT_TOOL_RESULT_LIMIT = '0';
      const configService = new ConfigService();
      expect(configService.getChatAgentToolResultLimit()).toBe(12);
    });
  });

  describe('getChatAgentMaxSources', () => {
    it('returns CHAT_AGENT_MAX_SOURCES when set', () => {
      process.env.CHAT_AGENT_MAX_SOURCES = '25';
      const configService = new ConfigService();
      expect(configService.getChatAgentMaxSources()).toBe(25);
    });

    it('returns 15 by default', () => {
      delete process.env.CHAT_AGENT_MAX_SOURCES;
      const configService = new ConfigService();
      expect(configService.getChatAgentMaxSources()).toBe(15);
    });
  });

  describe('getChatAgentHistoryWindow', () => {
    it('returns CHAT_AGENT_HISTORY_WINDOW when set', () => {
      process.env.CHAT_AGENT_HISTORY_WINDOW = '10';
      const configService = new ConfigService();
      expect(configService.getChatAgentHistoryWindow()).toBe(10);
    });

    it('returns 6 by default', () => {
      delete process.env.CHAT_AGENT_HISTORY_WINDOW;
      const configService = new ConfigService();
      expect(configService.getChatAgentHistoryWindow()).toBe(6);
    });

    it('allows 0 to disable history', () => {
      process.env.CHAT_AGENT_HISTORY_WINDOW = '0';
      const configService = new ConfigService();
      expect(configService.getChatAgentHistoryWindow()).toBe(0);
    });
  });

  describe('getChatAgentSearchTier', () => {
    it('returns instant when CHAT_AGENT_SEARCH_TIER is set to instant', () => {
      process.env.CHAT_AGENT_SEARCH_TIER = 'instant';
      const configService = new ConfigService();
      expect(configService.getChatAgentSearchTier()).toBe('instant');
    });

    it('returns classic by default', () => {
      delete process.env.CHAT_AGENT_SEARCH_TIER;
      const configService = new ConfigService();
      expect(configService.getChatAgentSearchTier()).toBe('classic');
    });

    it('returns classic for unknown values', () => {
      process.env.CHAT_AGENT_SEARCH_TIER = 'turbo';
      const configService = new ConfigService();
      expect(configService.getChatAgentSearchTier()).toBe('classic');
    });
  });

  describe('getChatAgentRetrievalStrategy', () => {
    it('returns the strategy when set to a valid value', () => {
      process.env.CHAT_AGENT_RETRIEVAL_STRATEGY = 'hybrid';
      const configService = new ConfigService();
      expect(configService.getChatAgentRetrievalStrategy()).toBe('hybrid');
    });

    it('accepts semantic', () => {
      process.env.CHAT_AGENT_RETRIEVAL_STRATEGY = 'semantic';
      const configService = new ConfigService();
      expect(configService.getChatAgentRetrievalStrategy()).toBe('semantic');
    });

    it('accepts keyword', () => {
      process.env.CHAT_AGENT_RETRIEVAL_STRATEGY = 'keyword';
      const configService = new ConfigService();
      expect(configService.getChatAgentRetrievalStrategy()).toBe('keyword');
    });

    it('returns undefined by default (uses Airweave default)', () => {
      delete process.env.CHAT_AGENT_RETRIEVAL_STRATEGY;
      const configService = new ConfigService();
      expect(configService.getChatAgentRetrievalStrategy()).toBeUndefined();
    });

    it('returns undefined for unknown values', () => {
      process.env.CHAT_AGENT_RETRIEVAL_STRATEGY = 'quantum';
      const configService = new ConfigService();
      expect(configService.getChatAgentRetrievalStrategy()).toBeUndefined();
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
      const validProjectSourceSecretKey =
        'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

    beforeEach(() => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.QDRANT_URL = 'https://qdrant.example.com';
      process.env.QDRANT_API_KEY = 'qdrant-key';
    });

    it('should not throw when all required env vars are present', () => {
      process.env.AUTH_SECRET = 'secret';
      process.env.DATABASE_URL = 'postgresql://localhost/db';
        process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).not.toThrow();
    });

    it('should throw when QDRANT_URL is missing', () => {
      process.env.AUTH_SECRET = 'secret';
      process.env.DATABASE_URL = 'postgresql://localhost/db';
      process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
      delete process.env.QDRANT_URL;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow(
        'Missing required environment variables: QDRANT_URL',
      );
    });

    it('should throw when QDRANT_API_KEY is missing', () => {
      process.env.AUTH_SECRET = 'secret';
      process.env.DATABASE_URL = 'postgresql://localhost/db';
      process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
      delete process.env.QDRANT_API_KEY;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow(
        'Missing required environment variables: QDRANT_API_KEY',
      );
    });

    it('should throw when AUTH_SECRET is missing', () => {
      delete process.env.AUTH_SECRET;
      process.env.DATABASE_URL = 'postgresql://localhost/db';
        process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow(
        'Missing required environment variables: AUTH_SECRET',
      );
    });

    it('should throw when DATABASE_URL is missing', () => {
      process.env.AUTH_SECRET = 'secret';
      delete process.env.DATABASE_URL;
        process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow(
        'Missing required environment variables: DATABASE_URL',
      );
    });

      it('should throw when PROJECT_SOURCE_SECRET_KEY is missing', () => {
        process.env.AUTH_SECRET = 'secret';
        process.env.DATABASE_URL = 'postgresql://localhost/db';
        delete process.env.PROJECT_SOURCE_SECRET_KEY;
        const configService = new ConfigService();
        expect(() => configService.validateEnvironment()).toThrow(
          'Missing required environment variables: PROJECT_SOURCE_SECRET_KEY',
        );
      });

    it('should throw when S3_BUCKET is missing', () => {
      process.env.AUTH_SECRET = 'secret';
      process.env.DATABASE_URL = 'postgresql://localhost/db';
      process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
      delete process.env.S3_BUCKET;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow(
        'Missing required environment variables: S3_BUCKET',
      );
    });

    it('should list all missing vars when multiple are absent', () => {
      delete process.env.AUTH_SECRET;
      delete process.env.DATABASE_URL;
        delete process.env.PROJECT_SOURCE_SECRET_KEY;
      const configService = new ConfigService();
      expect(() => configService.validateEnvironment()).toThrow('AUTH_SECRET');
    });

      it('should throw when PROJECT_SOURCE_SECRET_KEY is invalid base64', () => {
        process.env.AUTH_SECRET = 'secret';
        process.env.DATABASE_URL = 'postgresql://localhost/db';
        process.env.PROJECT_SOURCE_SECRET_KEY = 'invalid-key';
        const configService = new ConfigService();
        expect(() => configService.validateEnvironment()).toThrow(
          'Invalid PROJECT_SOURCE_SECRET_KEY',
        );
      });

      // Previous-key validation during rotation window
      it('passes validation when PROJECT_SOURCE_SECRET_KEY_PREVIOUS is unset', () => {
        process.env.AUTH_SECRET = 'secret';
        process.env.DATABASE_URL = 'postgresql://localhost/db';
        process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
        delete process.env.PROJECT_SOURCE_SECRET_KEY_PREVIOUS;
        const cs = new ConfigService();
        expect(() => cs.validateEnvironment()).not.toThrow();
      });

      it('passes validation when PROJECT_SOURCE_SECRET_KEY_PREVIOUS is a valid base64 key', () => {
        process.env.AUTH_SECRET = 'secret';
        process.env.DATABASE_URL = 'postgresql://localhost/db';
        process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
        process.env.PROJECT_SOURCE_SECRET_KEY_PREVIOUS =
          validProjectSourceSecretKey;
        const cs = new ConfigService();
        expect(() => cs.validateEnvironment()).not.toThrow();
      });

      it('throws when PROJECT_SOURCE_SECRET_KEY_PREVIOUS is set but invalid', () => {
        process.env.AUTH_SECRET = 'secret';
        process.env.DATABASE_URL = 'postgresql://localhost/db';
        process.env.PROJECT_SOURCE_SECRET_KEY = validProjectSourceSecretKey;
        process.env.PROJECT_SOURCE_SECRET_KEY_PREVIOUS = 'not-a-key';
        const cs = new ConfigService();
        expect(() => cs.validateEnvironment()).toThrow(
          /Invalid PROJECT_SOURCE_SECRET_KEY_PREVIOUS/,
        );
      });
  });

  describe('getProjectSourceSecretKeyPrevious', () => {
    it('returns null when unset', () => {
      delete process.env.PROJECT_SOURCE_SECRET_KEY_PREVIOUS;
      const cs = new ConfigService();
      expect(cs.getProjectSourceSecretKeyPrevious()).toBeNull();
    });

    it('returns null when set to whitespace', () => {
      process.env.PROJECT_SOURCE_SECRET_KEY_PREVIOUS = '   ';
      const cs = new ConfigService();
      expect(cs.getProjectSourceSecretKeyPrevious()).toBeNull();
    });

    it('returns the trimmed string when set', () => {
      process.env.PROJECT_SOURCE_SECRET_KEY_PREVIOUS = '  someValue  ';
      const cs = new ConfigService();
      expect(cs.getProjectSourceSecretKeyPrevious()).toBe('someValue');
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

  describe('getS3Bucket', () => {
    it('returns the bucket name when S3_BUCKET is set', () => {
      process.env.S3_BUCKET = 'my-velocity-bucket';
      const config = new ConfigService();
      expect(config.getS3Bucket()).toBe('my-velocity-bucket');
    });

    it('throws when S3_BUCKET is not set', () => {
      delete process.env.S3_BUCKET;
      const config = new ConfigService();
      expect(() => config.getS3Bucket()).toThrow('S3_BUCKET');
    });

    it('throws when S3_BUCKET is whitespace-only', () => {
      process.env.S3_BUCKET = '   ';
      const config = new ConfigService();
      expect(() => config.getS3Bucket()).toThrow('S3_BUCKET');
    });
  });

  describe('getS3Region', () => {
    it('returns the region when S3_REGION is set', () => {
      process.env.S3_REGION = 'eu-west-1';
      const config = new ConfigService();
      expect(config.getS3Region()).toBe('eu-west-1');
    });

    it('defaults to us-east-1 when S3_REGION is not set', () => {
      delete process.env.S3_REGION;
      const config = new ConfigService();
      expect(config.getS3Region()).toBe('us-east-1');
    });
  });

  describe('getQdrantUrl', () => {
    it('returns the URL when QDRANT_URL is set', () => {
      process.env.QDRANT_URL = 'https://abc.qdrant.io:6333';
      const config = new ConfigService();
      expect(config.getQdrantUrl()).toBe('https://abc.qdrant.io:6333');
    });

    it('throws when QDRANT_URL is not set', () => {
      delete process.env.QDRANT_URL;
      const config = new ConfigService();
      expect(() => config.getQdrantUrl()).toThrow('QDRANT_URL');
    });

    it('throws when QDRANT_URL is whitespace-only', () => {
      process.env.QDRANT_URL = '   ';
      const config = new ConfigService();
      expect(() => config.getQdrantUrl()).toThrow('QDRANT_URL');
    });
  });

  describe('getQdrantApiKey', () => {
    it('returns the key when QDRANT_API_KEY is set', () => {
      process.env.QDRANT_API_KEY = 'secret-key';
      const config = new ConfigService();
      expect(config.getQdrantApiKey()).toBe('secret-key');
    });

    it('throws when QDRANT_API_KEY is not set', () => {
      delete process.env.QDRANT_API_KEY;
      const config = new ConfigService();
      expect(() => config.getQdrantApiKey()).toThrow('QDRANT_API_KEY');
    });
  });

  describe('getEmbeddingModel', () => {
    it('returns the model when EMBEDDING_MODEL is set', () => {
      process.env.EMBEDDING_MODEL = 'text-embedding-3-large';
      const config = new ConfigService();
      expect(config.getEmbeddingModel()).toBe('text-embedding-3-large');
    });

    it('defaults to text-embedding-3-small when unset', () => {
      delete process.env.EMBEDDING_MODEL;
      const config = new ConfigService();
      expect(config.getEmbeddingModel()).toBe('text-embedding-3-small');
    });
  });

  describe('getEmbeddingBatchSize', () => {
    it('returns the configured batch size within bounds', () => {
      process.env.EMBEDDING_BATCH_SIZE = '128';
      const config = new ConfigService();
      expect(config.getEmbeddingBatchSize()).toBe(128);
    });

    it('defaults to 96 when unset', () => {
      delete process.env.EMBEDDING_BATCH_SIZE;
      const config = new ConfigService();
      expect(config.getEmbeddingBatchSize()).toBe(96);
    });

    it('falls back to default when out of bounds', () => {
      process.env.EMBEDDING_BATCH_SIZE = '99999';
      const config = new ConfigService();
      expect(config.getEmbeddingBatchSize()).toBe(96);
    });
  });

  describe('getEmbeddingConcurrency', () => {
    it('returns the configured concurrency within bounds', () => {
      process.env.EMBEDDING_CONCURRENCY = '5';
      const config = new ConfigService();
      expect(config.getEmbeddingConcurrency()).toBe(5);
    });

    it('defaults to 3 when unset', () => {
      delete process.env.EMBEDDING_CONCURRENCY;
      const config = new ConfigService();
      expect(config.getEmbeddingConcurrency()).toBe(3);
    });

    it('falls back to default when below minimum', () => {
      process.env.EMBEDDING_CONCURRENCY = '0';
      const config = new ConfigService();
      expect(config.getEmbeddingConcurrency()).toBe(3);
    });
  });

  describe('isImageExtractionEnabled', () => {
    afterEach(() => {
      delete process.env.IMAGE_EXTRACTION_ENABLED;
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('returns false when IMAGE_EXTRACTION_ENABLED is unset', () => {
      delete process.env.IMAGE_EXTRACTION_ENABLED;
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(new ConfigService().isImageExtractionEnabled()).toBe(false);
    });

    it('returns false when ANTHROPIC_API_KEY is unset even with flag enabled', () => {
      process.env.IMAGE_EXTRACTION_ENABLED = 'true';
      delete process.env.ANTHROPIC_API_KEY;
      expect(new ConfigService().isImageExtractionEnabled()).toBe(false);
    });

    it('returns false when IMAGE_EXTRACTION_ENABLED is "false"', () => {
      process.env.IMAGE_EXTRACTION_ENABLED = 'false';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(new ConfigService().isImageExtractionEnabled()).toBe(false);
    });

    it('returns false for non-boolean values like "1" or "yes"', () => {
      process.env.IMAGE_EXTRACTION_ENABLED = '1';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(new ConfigService().isImageExtractionEnabled()).toBe(false);

      process.env.IMAGE_EXTRACTION_ENABLED = 'yes';
      expect(new ConfigService().isImageExtractionEnabled()).toBe(false);
    });

    it('returns true when IMAGE_EXTRACTION_ENABLED="true" and ANTHROPIC_API_KEY is set', () => {
      process.env.IMAGE_EXTRACTION_ENABLED = 'true';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      expect(new ConfigService().isImageExtractionEnabled()).toBe(true);
    });
  });

  describe('getAnthropicApiKey', () => {
    afterEach(() => {
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('returns null when ANTHROPIC_API_KEY is unset', () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(new ConfigService().getAnthropicApiKey()).toBeNull();
    });

    it('returns null when ANTHROPIC_API_KEY is whitespace-only', () => {
      process.env.ANTHROPIC_API_KEY = '   ';
      expect(new ConfigService().getAnthropicApiKey()).toBeNull();
    });

    it('returns the trimmed key when set', () => {
      process.env.ANTHROPIC_API_KEY = '  sk-ant-real-key  ';
      expect(new ConfigService().getAnthropicApiKey()).toBe('sk-ant-real-key');
    });
  });

  describe('getImageExtractionModel', () => {
    afterEach(() => {
      delete process.env.IMAGE_EXTRACTION_MODEL;
    });

    it('defaults to claude-haiku-4-5 when unset', () => {
      delete process.env.IMAGE_EXTRACTION_MODEL;
      expect(new ConfigService().getImageExtractionModel()).toBe('claude-haiku-4-5');
    });

    it('returns the configured model when IMAGE_EXTRACTION_MODEL is set', () => {
      process.env.IMAGE_EXTRACTION_MODEL = 'claude-opus-4-8';
      expect(new ConfigService().getImageExtractionModel()).toBe('claude-opus-4-8');
    });
  });

  describe('getImageExtractionMaxImagesPerDoc', () => {
    let warnSpy: jest.SpiedFunction<typeof console.warn>;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      delete process.env.IMAGE_EXTRACTION_MAX_IMAGES_PER_DOC;
      warnSpy.mockRestore();
    });

    it('defaults to 20 when unset', () => {
      delete process.env.IMAGE_EXTRACTION_MAX_IMAGES_PER_DOC;
      expect(new ConfigService().getImageExtractionMaxImagesPerDoc()).toBe(20);
    });

    it('returns the configured value when in range', () => {
      process.env.IMAGE_EXTRACTION_MAX_IMAGES_PER_DOC = '50';
      expect(new ConfigService().getImageExtractionMaxImagesPerDoc()).toBe(50);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('falls back to 20 for non-numeric values', () => {
      process.env.IMAGE_EXTRACTION_MAX_IMAGES_PER_DOC = 'abc';
      expect(new ConfigService().getImageExtractionMaxImagesPerDoc()).toBe(20);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('falls back to 20 when value is 0 (below minimum of 1)', () => {
      process.env.IMAGE_EXTRACTION_MAX_IMAGES_PER_DOC = '0';
      expect(new ConfigService().getImageExtractionMaxImagesPerDoc()).toBe(20);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('getImageExtractionMinSizeBytes', () => {
    let warnSpy: jest.SpiedFunction<typeof console.warn>;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      delete process.env.IMAGE_EXTRACTION_MIN_SIZE_BYTES;
      warnSpy.mockRestore();
    });

    it('defaults to 4096 when unset', () => {
      delete process.env.IMAGE_EXTRACTION_MIN_SIZE_BYTES;
      expect(new ConfigService().getImageExtractionMinSizeBytes()).toBe(4096);
    });

    it('returns the configured value when in range', () => {
      process.env.IMAGE_EXTRACTION_MIN_SIZE_BYTES = '8192';
      expect(new ConfigService().getImageExtractionMinSizeBytes()).toBe(8192);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('falls back to 4096 for non-numeric values', () => {
      process.env.IMAGE_EXTRACTION_MIN_SIZE_BYTES = 'not-a-number';
      expect(new ConfigService().getImageExtractionMinSizeBytes()).toBe(4096);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('allows 0 to disable the minimum size filter', () => {
      process.env.IMAGE_EXTRACTION_MIN_SIZE_BYTES = '0';
      expect(new ConfigService().getImageExtractionMinSizeBytes()).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
