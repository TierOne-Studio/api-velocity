import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';

const BUILT_IN_CHAT_SYSTEM_PROMPT_FALLBACK =
  'You answer questions about an organization knowledge base. Use only the provided source context. Be concise, factual, and explicitly note when context is insufficient.';

@Injectable()
export class ConfigService {
  private cachedDefaultChatPrompt: string | null = null;

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
    const inlineOverride = process.env.CHAT_SYSTEM_PROMPT?.trim();
    if (inlineOverride) {
      return inlineOverride;
    }

    const overridePath = process.env.CHAT_SYSTEM_PROMPT_PATH?.trim();
    if (overridePath) {
      const fromOverridePath = this.tryReadPromptFile(
        overridePath,
        'CHAT_SYSTEM_PROMPT_PATH',
      );
      if (fromOverridePath) {
        return fromOverridePath;
      }
    }

    return this.getDefaultChatSystemPrompt();
  }

  private getDefaultChatSystemPrompt(): string {
    if (this.cachedDefaultChatPrompt !== null) {
      return this.cachedDefaultChatPrompt;
    }

    // Resolve from process.cwd() rather than __dirname so the same code works
    // under CJS (production: node dist/main) and ESM jest (useESM: true) where
    // __dirname is undefined. dist/ is tried first so production never picks
    // up a stale src/ file when both happen to exist.
    const cwd = process.cwd();
    const candidates = [
      resolve(cwd, 'dist/modules/chat/prompts/expert-persona-system.md'),
      resolve(cwd, 'src/modules/chat/prompts/expert-persona-system.md'),
    ];

    for (const candidate of candidates) {
      const fromFile = this.tryReadPromptFile(
        candidate,
        'default chat prompt',
        {
          warnOnError: false,
        },
      );
      if (fromFile) {
        this.cachedDefaultChatPrompt = fromFile;
        return fromFile;
      }
    }

    console.warn(
      '[ConfigService] Could not load default chat system prompt from any known location. Using built-in fallback.',
      { tried: candidates },
    );
    this.cachedDefaultChatPrompt = BUILT_IN_CHAT_SYSTEM_PROMPT_FALLBACK;
    return this.cachedDefaultChatPrompt;
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
      process.env.CHAT_AGENT_TOOL_RESULT_CHAR_CAP || '1500',
      10,
    );
    if (Number.isNaN(raw) || raw < 200) {
      return 1500;
    }
    return raw;
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
    const required = ['AUTH_SECRET', 'DATABASE_URL'];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}`,
      );
    }

    console.log('✅ All required environment variables are present');
  }
}
