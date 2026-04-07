import { Injectable } from '@nestjs/common';
import 'dotenv/config';

@Injectable()
export class ConfigService {
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
    return process.env.OPENAI_MODEL || 'gpt-4o';
  }

  getChatSystemPrompt(): string {
    return (
      process.env.CHAT_SYSTEM_PROMPT ||
      'You answer questions about organization knowledge bases. Use only the provided source context. Respond in structured markdown with sections ## Answer, ### Key Findings, and ### Sources. Keep attribution brief and factual.'
    );
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
