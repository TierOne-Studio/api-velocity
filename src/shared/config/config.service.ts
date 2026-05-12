import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';
import { assertValidBase64Key } from '../crypto/aes-gcm.js';

const BUILT_IN_CHAT_SYSTEM_PROMPT_FALLBACK =
  'You answer questions about an organization knowledge base. Use only the provided source context. Be concise, factual, and explicitly note when context is insufficient.';

const DEFAULT_CHAT_AGENT_TOOL_RESULT_CHAR_CAP = 3000;
const MIN_CHAT_AGENT_TOOL_RESULT_CHAR_CAP = 200;

export interface PromptSpec {
  envInline?: string;
  envPath?: string;
  fileCandidates: string[];
  fallback: string;
  cacheKey: string;
}

@Injectable()
export class ConfigService {
  private readonly promptCache = new Map<string, string>();

  getPort(): number {
    return parseInt(process.env.PORT || '3000', 10);
  }

  getAuthSecret(): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
      throw new Error('AUTH_SECRET environment variable is required');
    }
    return secret;
  }

  getBaseUrl(): string {
    return process.env.BASE_URL || 'http://localhost:3000';
  }

  getDatabaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    return url;
  }

  getTrustedOrigins(): string[] {
    return (
      process.env.TRUSTED_ORIGINS?.split(',') || [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
      ]
    );
  }

  getResendApiKey(): string {
    return process.env.RESEND_API_KEY || '';
  }

  getFromEmail(): string {
    return process.env.FROM_EMAIL || 'noreply@example.com';
  }

  getFeUrl(): string {
    return process.env.FE_URL || 'http://localhost:5173';
  }

  getAirweaveApiKey(): string | null {
    return process.env.AIRWEAVE_API_KEY?.trim() || null;
  }

  getAirweaveBaseUrl(): string {
    return process.env.AIRWEAVE_BASE_URL || 'https://api.airweave.ai';
  }

  getOpenAiApiKey(): string | null {
    return process.env.OPENAI_API_KEY?.trim() || null;
  }

  getOpenAiModel(): string {
    return process.env.OPENAI_MODEL || 'gpt-5.4-nano';
  }

  getChatSystemPrompt(): string {
    return this.loadPrompt({
      envInline: process.env.CHAT_SYSTEM_PROMPT?.trim(),
      envPath: process.env.CHAT_SYSTEM_PROMPT_PATH?.trim(),
      fileCandidates: [
        resolve(
          process.cwd(),
          'dist/modules/chat/prompts/expert-persona-system.md',
        ),
        resolve(
          process.cwd(),
          'src/modules/chat/prompts/expert-persona-system.md',
        ),
      ],
      fallback: BUILT_IN_CHAT_SYSTEM_PROMPT_FALLBACK,
      cacheKey: 'chat-system',
    });
  }

  loadPrompt(spec: PromptSpec): string {
    if (spec.envInline) {
      return spec.envInline;
    }
    if (spec.envPath) {
      const fromOverridePath = this.tryReadPromptFile(
        spec.envPath,
        `${spec.cacheKey} env path`,
      );
      if (fromOverridePath) {
        return fromOverridePath;
      }
    }
    const cached = this.promptCache.get(spec.cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    for (const candidate of spec.fileCandidates) {
      const fromFile = this.tryReadPromptFile(
        candidate,
        `${spec.cacheKey} candidate`,
        { warnOnError: false },
      );
      if (fromFile) {
        this.promptCache.set(spec.cacheKey, fromFile);
        return fromFile;
      }
    }
    console.warn(
      `[ConfigService] Could not load prompt "${spec.cacheKey}" from any known location. Using built-in fallback.`,
      { tried: spec.fileCandidates },
    );
    this.promptCache.set(spec.cacheKey, spec.fallback);
    return spec.fallback;
  }

  private tryReadPromptFile(
    filePath: string,
    label: string,
    options: { warnOnError?: boolean } = {},
  ): string | null {
    const { warnOnError = true } = options;
    try {
      const content = readFileSync(filePath, 'utf-8').trim();
      return content.length > 0 ? content : null;
    } catch (error) {
      if (warnOnError) {
        console.warn(
          `[ConfigService] Failed to load chat system prompt (${label}) from ${filePath}. Falling back.`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return null;
    }
  }

  getChatAgentMaxIterations(): number {
    const raw = parseInt(process.env.CHAT_AGENT_MAX_ITERATIONS || '5', 10);
    if (Number.isNaN(raw) || raw < 1) {
      return 5;
    }
    return raw;
  }

  getChatAgentToolResultCharCap(): number {
    const raw = parseInt(
      process.env.CHAT_AGENT_TOOL_RESULT_CHAR_CAP ||
        String(DEFAULT_CHAT_AGENT_TOOL_RESULT_CHAR_CAP),
      10,
    );
    if (Number.isNaN(raw) || raw < MIN_CHAT_AGENT_TOOL_RESULT_CHAR_CAP) {
      return DEFAULT_CHAT_AGENT_TOOL_RESULT_CHAR_CAP;
    }
    return raw;
  }

  getChatAgentToolResultLimit(): number {
    const raw = parseInt(process.env.CHAT_AGENT_TOOL_RESULT_LIMIT || '12', 10);
    if (Number.isNaN(raw) || raw < 1) {
      return 12;
    }
    return raw;
  }

  getChatAgentMaxSources(): number {
    const raw = parseInt(process.env.CHAT_AGENT_MAX_SOURCES || '15', 10);
    if (Number.isNaN(raw) || raw < 1) {
      return 15;
    }
    return raw;
  }

  getChatAgentHistoryWindow(): number {
    const raw = parseInt(process.env.CHAT_AGENT_HISTORY_WINDOW || '6', 10);
    if (Number.isNaN(raw) || raw < 0) {
      return 6;
    }
    return raw;
  }

  getChatAgentSearchTier(): 'classic' | 'instant' {
    const val = process.env.CHAT_AGENT_SEARCH_TIER?.trim().toLowerCase();
    if (val === 'instant') {
      return 'instant';
    }
    return 'classic';
  }

  getChatAgentRetrievalStrategy():
    | 'semantic'
    | 'keyword'
    | 'hybrid'
    | undefined {
    const val = process.env.CHAT_AGENT_RETRIEVAL_STRATEGY?.trim().toLowerCase();
    if (val === 'semantic' || val === 'keyword' || val === 'hybrid') {
      return val;
    }
    return undefined;
  }

  getChatRateLimitTtl(): number {
    return parseInt(process.env.CHAT_RATE_LIMIT_TTL || '60000', 10);
  }

  getChatRateLimitMax(): number {
    return parseInt(process.env.CHAT_RATE_LIMIT_MAX || '20', 10);
  }

  isTestMode(): boolean {
    return process.env.NODE_ENV === 'test';
  }

  shouldEnforceResendTestRecipients(): boolean {
    const override = process.env.ENFORCE_RESEND_TEST_RECIPIENTS;
    if (override === 'true') return true;
    if (override === 'false') return false;

    const dotenvConfigPath =
      process.env.DOTENV_CONFIG_PATH?.toLowerCase() || '';
    const usesEnvTestFile = dotenvConfigPath.endsWith('.env.test');

    return this.isTestMode() || usesEnvTestFile;
  }

  validateEnvironment(): void {
    const required = [
      'AUTH_SECRET',
      'DATABASE_URL',
      'PROJECT_SOURCE_SECRET_KEY',
    ];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}`,
      );
    }

    try {
      assertValidBase64Key(this.getProjectSourceSecretKey());
    } catch (error) {
      throw new Error(
        `Invalid PROJECT_SOURCE_SECRET_KEY: ${(error as Error).message}`,
      );
    }

    // C3a: PROJECT_SOURCE_SECRET_KEY_PREVIOUS is optional, but when set it
    // must be a valid AES-256 base64 key. Validating at boot lets operators
    // catch typos during rotation rather than at first decrypt.
    const previous = this.getProjectSourceSecretKeyPrevious();
    if (previous !== null) {
      try {
        assertValidBase64Key(previous);
      } catch (error) {
        throw new Error(
          `Invalid PROJECT_SOURCE_SECRET_KEY_PREVIOUS: ${(error as Error).message}`,
        );
      }
    }

    console.log('✅ All required environment variables are present');
  }

  getProjectSourceSecretKey(): string {
    const key = process.env.PROJECT_SOURCE_SECRET_KEY?.trim();
    if (!key) {
      throw new Error(
        'PROJECT_SOURCE_SECRET_KEY is required to encrypt/decrypt SQL connection credentials',
      );
    }
    return key;
  }

  /**
   * C3a: optional previous key used during the rotation window. When set,
   * decrypt tries the current key first; on auth-tag failure it retries
   * with this previous key. Allows operators to rotate the master key
   * without simultaneously re-encrypting every stored credential.
   *
   * Returns `null` when unset (no previous key in play; decrypt is
   * single-key).
   */
  getProjectSourceSecretKeyPrevious(): string | null {
    const key = process.env.PROJECT_SOURCE_SECRET_KEY_PREVIOUS?.trim();
    return key && key.length > 0 ? key : null;
  }

  hasProjectSourceSecretKey(): boolean {
    return Boolean(process.env.PROJECT_SOURCE_SECRET_KEY?.trim());
  }

  getSqlAgentStatementTimeoutMs(): number {
    return this.boundedInt('SQL_AGENT_STATEMENT_TIMEOUT_MS', 5000, {
      min: 100,
      max: 300_000,
    });
  }

  getSqlAgentIdleTimeoutMs(): number {
    return this.boundedInt('SQL_AGENT_IDLE_TIMEOUT_MS', 5000, {
      min: 100,
      max: 300_000,
    });
  }

  getSqlAgentMaxRows(): number {
    return this.boundedInt('SQL_AGENT_MAX_ROWS', 200, {
      min: 1,
      max: 100_000,
    });
  }

  getSqlAgentMaxBytes(): number {
    return this.boundedInt('SQL_AGENT_MAX_BYTES', 65536, {
      min: 1024,
      max: 10_485_760,
    });
  }

  getSqlAgentMaxFieldBytes(): number {
    return this.boundedInt('SQL_AGENT_MAX_FIELD_BYTES', 4096, {
      min: 128,
      max: 1_048_576,
    });
  }

  getSqlAgentMaxSqlLength(): number {
    return this.boundedInt('SQL_AGENT_MAX_SQL_LENGTH', 8192, {
      min: 128,
      max: 1_048_576,
    });
  }

  getSqlAgentMaxIterations(): number {
    return this.boundedInt('SQL_AGENT_MAX_ITERATIONS', 8, {
      min: 1,
      max: 50,
    });
  }

  getSqlAgentPoolMax(): number {
    return this.boundedInt('SQL_AGENT_POOL_MAX', 2, { min: 1, max: 50 });
  }

  getSqlAgentConnectTimeoutMs(): number {
    return this.boundedInt('SQL_AGENT_CONNECT_TIMEOUT_MS', 3000, {
      min: 100,
      max: 60_000,
    });
  }

  getSqlAgentAllowWrites(): boolean {
    return process.env.SQL_AGENT_ALLOW_WRITES === 'true';
  }

  /**
   * Returns the list of database URLs the SQL agent path is forbidden from
   * dialing (the "forbidden app-DB list" — see S4 of the chat-to-SQL self-
   * review). The intent is "agent path can NOT reach these specific Postgres
   * endpoints", evaluated by host+port match against each URL.
   *
   * Defaults to a single-element list containing DATABASE_URL so the app's
   * own database is always blocked. Operators with primary + replica setups
   * or multi-instance topologies set `AGENT_FORBIDDEN_DATABASES` to a
   * comma-separated list of all endpoints to block.
   *
   * If neither env is set, the getter returns an empty list and the factory
   * applies no forbidden-host guard — this is rare; the canonical config
   * always has DATABASE_URL set.
   */
  getAgentForbiddenDatabases(): string[] {
    const explicit = process.env.AGENT_FORBIDDEN_DATABASES?.trim();
    if (explicit && explicit.length > 0) {
      return explicit
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    const databaseUrl = process.env.DATABASE_URL?.trim();
    return databaseUrl ? [databaseUrl] : [];
  }

  getSqlAgentModel(): string | null {
    return process.env.SQL_AGENT_MODEL?.trim() || null;
  }

  getSqlAgentSystemPrompt(): string {
    return this.loadPrompt({
      envInline: process.env.SQL_AGENT_SYSTEM_PROMPT?.trim(),
      envPath: process.env.SQL_AGENT_SYSTEM_PROMPT_PATH?.trim(),
      fileCandidates: [
        resolve(
          process.cwd(),
          'dist/modules/chat/prompts/sql-agent-system.md',
        ),
        resolve(process.cwd(), 'src/modules/chat/prompts/sql-agent-system.md'),
      ],
      fallback:
        'You translate a natural-language question into a single read-only SQL query against a Postgres database, execute it via the provided tools, and return the rows. Never modify data. Use LIMIT. Prefer explicit column lists. If the schema is ambiguous, inspect tables first.',
      cacheKey: 'sql-agent-system',
    });
  }

  getSqlToolUsagePrompt(): string {
    return this.loadPrompt({
      envInline: process.env.SQL_TOOL_USAGE_PROMPT?.trim(),
      envPath: process.env.SQL_TOOL_USAGE_PROMPT_PATH?.trim(),
      fileCandidates: [
        resolve(process.cwd(), 'dist/modules/chat/prompts/sql-tool-usage.md'),
        resolve(process.cwd(), 'src/modules/chat/prompts/sql-tool-usage.md'),
      ],
      fallback:
        'Use list_tables_sql_db to discover tables, info_sql_db for schema, and query_sql_db to run SELECTs with a LIMIT.',
      cacheKey: 'sql-tool-usage',
    });
  }

  getQueryDatabaseToolDescription(
    available: ReadonlyArray<{ id: string; name: string }> = [],
  ): string {
    const base = this.loadPrompt({
      envInline: process.env.QUERY_DATABASE_TOOL_DESCRIPTION?.trim(),
      envPath: process.env.QUERY_DATABASE_TOOL_DESCRIPTION_PATH?.trim(),
      fileCandidates: [
        resolve(
          process.cwd(),
          'dist/modules/chat/prompts/query-database-tool-description.md',
        ),
        resolve(
          process.cwd(),
          'src/modules/chat/prompts/query-database-tool-description.md',
        ),
      ],
      fallback:
        'Ask a natural-language question of a project database. Returns rows from a single SELECT. Read-only; writes are rejected.',
      cacheKey: 'query-database-tool-description',
    });
    if (available.length < 2) return base;
    const list = available
      .map((c) => `- ${c.id}: ${c.name}`)
      .join('\n');
    return `${base}\n\n## Available source_id values\n\nMultiple databases are attached. Pass one of these as \`source_id\`:\n${list}`;
  }

  private positiveInt(raw: string | undefined, fallback: number): number {
    const parsed = parseInt(raw || '', 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      return fallback;
    }
    return parsed;
  }

  /**
   * Bounded-int parser for SQL-agent and similar safety-critical knobs (L2).
   *
   * - Unset env: returns `fallback` silently (this is the normal case).
   * - Env set but unparseable / NaN: returns `fallback` and logs a warning
   *   so an operator typo is visible rather than silently disabled.
   * - Env below `min` or above `max`: returns `fallback` and logs a warning.
   *   The fallback is what protects the system; we never honor an unsafe
   *   value. A 0 statement timeout would disable the read-only guard's
   *   timeout; a 100_000_000 max-rows would invite OOM.
   *
   * @internal exposed for unit testing via getter call sites.
   */
  private boundedInt(
    envName: string,
    fallback: number,
    bounds: { min: number; max: number },
  ): number {
    const raw = process.env[envName];
    if (raw === undefined || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = parseInt(raw.trim(), 10);
    if (Number.isNaN(parsed)) {
      console.warn(
        `[ConfigService] ${envName}="${raw}" is not a positive integer; using default ${fallback}`,
      );
      return fallback;
    }
    if (parsed < bounds.min || parsed > bounds.max) {
      console.warn(
        `[ConfigService] ${envName}=${parsed} is outside the allowed range [${bounds.min}, ${bounds.max}]; using default ${fallback}`,
      );
      return fallback;
    }
    return parsed;
  }
}
