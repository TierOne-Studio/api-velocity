import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';

/**
 * Handles post-signup side-effects for self-serve onboarding.
 *
 * When DEFAULT_ORGANIZATION_SLUG is set, every new user is automatically
 * added as a `member` of that organization immediately after account creation.
 * If the env var is absent the service is a no-op, making the feature opt-in.
 *
 * The hook is wired via setPostSignupCallback() in AppModule.onModuleInit()
 * so that this service stays inside NestJS DI while auth.ts (Better Auth)
 * calls it through a lightweight module-level callback.
 */
@Injectable()
export class PostSignupService {
  constructor(private readonly db: DatabaseService) {}

  async addUserToDefaultOrg(userId: string): Promise<void> {
    const slug = process.env.DEFAULT_ORGANIZATION_SLUG || 'default';

    const org = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM organization WHERE slug = $1`,
      [slug],
    );
    if (!org) {
      console.warn(`[PostSignup] Default org slug "${slug}" not found — skipping onboarding`);
      return;
    }

    const existing = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
      [userId, org.id],
    );
    if (existing) return;

    const memberId = generateId();
    await this.db.query(
      `INSERT INTO member (id, "organizationId", "userId", role)
       VALUES ($1, $2, $3, $4)`,
      [memberId, org.id, userId, 'member'],
    );
    console.log(`[PostSignup] Added user ${userId} as member to org ${org.id}`);
  }
}

function generateId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
