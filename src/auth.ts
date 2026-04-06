import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { bearer, openAPI, jwt, organization, admin } from 'better-auth/plugins';
import { Pool } from 'pg';
import type { EmailService } from './email/email.service';
import type {
  EmailVerificationPayload,
  OrganizationInvitationPayload,
  PasswordResetPayload,
} from './shared/email/email.interfaces';
import { ac, roles } from './permissions';

const isTestMode = process.env.NODE_ENV === 'test';
const authDatabasePool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://mravinale@localhost:5432/nestjs-api-starter',
});
let isAuthDatabasePoolClosed = false;

// Email service instance - will be set by the module
let emailServiceInstance: EmailService | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toEmailUser(user: unknown): EmailVerificationPayload['user'] | null {
  if (!isRecord(user)) {
    return null;
  }

  const id = typeof user.id === 'string' ? user.id : null;
  const email = typeof user.email === 'string' ? user.email : null;
  const name = typeof user.name === 'string' ? user.name : undefined;

  if (!id || !email) {
    return null;
  }

  return { id, email, name };
}

function toOrganizationInvitationPayload(
  payload: unknown,
): OrganizationInvitationPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const organization = isRecord(payload.organization)
    ? payload.organization
    : null;
  const inviter = isRecord(payload.inviter) ? payload.inviter : null;
  const inviterUser = inviter && isRecord(inviter.user) ? inviter.user : null;
  const invitation = isRecord(payload.invitation) ? payload.invitation : null;

  const id = getString(payload.id);
  const email = getString(payload.email);
  const role = getString(payload.role);
  const organizationId = organization ? getString(organization.id) : null;
  const organizationName = organization ? getString(organization.name) : null;
  const inviterId = inviterUser ? getString(inviterUser.id) : null;
  const inviterEmail = inviterUser ? getString(inviterUser.email) : null;

  if (
    !id ||
    !email ||
    !role ||
    !organizationId ||
    !organizationName ||
    !inviterId ||
    !inviterEmail
  ) {
    return null;
  }

  const expiresAtRaw = invitation?.expiresAt;
  const expiresAt =
    expiresAtRaw instanceof Date ||
    typeof expiresAtRaw === 'string' ||
    typeof expiresAtRaw === 'number'
      ? new Date(expiresAtRaw)
      : new Date();

  return {
    id,
    email,
    role,
    organizationId,
    organization: {
      id: organizationId,
      name: organizationName,
      slug: organization ? getOptionalString(organization.slug) : undefined,
    },
    inviter: {
      user: {
        id: inviterId,
        email: inviterEmail,
        name: inviterUser ? getOptionalString(inviterUser.name) : undefined,
      },
    },
    expiresAt,
  };
}

function toPasswordResetPayload(payload: unknown): PasswordResetPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const user = toEmailUser(payload.user);
  const url = getString(payload.url);
  const token = getString(payload.token);

  if (!user || !url || !token) {
    return null;
  }

  return { user, url, token };
}

function toEmailVerificationPayload(
  payload: unknown,
): EmailVerificationPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const user = toEmailUser(payload.user);
  const url = getString(payload.url);
  const token = getString(payload.token);

  if (!user || !url || !token) {
    return null;
  }

  return { user, url, token };
}

export function setEmailService(service: EmailService): void {
  emailServiceInstance = service;
}

// Post-signup callback - will be set by the module
type PostSignupCallback = (userId: string) => Promise<void>;
let postSignupCallback: PostSignupCallback | null = null;

export function setPostSignupCallback(callback: PostSignupCallback): void {
  postSignupCallback = callback;
}

export async function closeAuthDatabasePool(): Promise<void> {
  if (isAuthDatabasePoolClosed) {
    return;
  }

  await authDatabasePool.end();
  isAuthDatabasePoolClosed = true;
}

export const auth = betterAuth({
  database: authDatabasePool,
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.BASE_URL || 'http://localhost:3000',
  basePath: '/api/auth',
  trustedOrigins: process.env.TRUSTED_ORIGINS?.split(',') || [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ],

  // Plugins
  plugins: [
    bearer(),
    openAPI(),
    jwt(),
    organization({
      sendInvitationEmail: async (payload: unknown) => {
        const invitationPayload = toOrganizationInvitationPayload(payload);

        if (!invitationPayload) {
          console.warn(
            '[Organization] Skipping invitation email because the payload shape was incomplete',
          );
          return;
        }

        if (emailServiceInstance) {
          await emailServiceInstance.sendOrganizationInvitation(
            invitationPayload,
          );
        } else {
          console.log(
            '[Organization] Invitation email (no service):',
            invitationPayload.email,
          );
        }
      },
    }),
    admin({
      ac,
      roles,
      defaultRole: 'member',
    }),
  ],

  // Email & Password Configuration
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: !isTestMode,
    resetPasswordTokenExpiresIn: 86400, // 24 hours
    sendResetPassword: async (payload: unknown) => {
      const resetPayload = toPasswordResetPayload(payload);

      if (!resetPayload) {
        console.warn(
          '[Password Reset] Skipping email because the payload shape was incomplete',
        );
        return;
      }

      if (emailServiceInstance) {
        await emailServiceInstance.sendPasswordResetEmail(resetPayload);
      } else {
        console.log(
          '[Password Reset] Email (no service):',
          resetPayload.user.email,
        );
      }
    },
  },

  // Post-signup hook — adds new users to the default org (self-serve onboarding)
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (postSignupCallback) {
            await postSignupCallback(user.id).catch((err) =>
              console.error('[Auth] post-signup hook failed:', err),
            );
          }
        },
      },
    },
  },

  // Email Verification Configuration
  emailVerification: {
    sendOnSignUp: !isTestMode,
    autoSignInAfterVerification: true,
    expiresIn: 86400, // 24 hours
    sendVerificationEmail: async (payload: unknown) => {
      const verificationPayload = toEmailVerificationPayload(payload);

      if (!verificationPayload) {
        console.warn(
          '[Auth] Skipping verification email because the payload shape was incomplete',
        );
        return;
      }

      console.log('📧 [Auth] sendVerificationEmail called:', {
        email: verificationPayload.user.email,
        hasEmailService: !!emailServiceInstance,
        isTestMode,
        sendOnSignUp: !isTestMode,
      });

      // Modify the callbackURL to point to the frontend
      const feUrl = process.env.FE_URL || 'http://localhost:5173';
      const urlObj = new URL(verificationPayload.url);
      urlObj.searchParams.set('callbackURL', feUrl);
      const modifiedPayload: EmailVerificationPayload = {
        user: verificationPayload.user,
        token: verificationPayload.token,
        url: urlObj.toString(),
      };

      if (emailServiceInstance) {
        console.log(
          '✅ [Auth] Calling emailServiceInstance.sendEmailVerification',
        );
        await emailServiceInstance.sendEmailVerification(modifiedPayload);
      } else {
        console.log(
          '⚠️ [Auth] Email service not initialized - Email (no service):',
          verificationPayload.user.email,
        );
        console.log('⚠️ [Auth] URL:', modifiedPayload.url);
      }
    },
  },
});
