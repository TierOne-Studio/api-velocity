import 'dotenv/config';
import { betterAuth } from "better-auth";
import { bearer, openAPI, jwt, organization, admin } from "better-auth/plugins";
import { Pool } from "pg";
import type { ConfigService } from "./config/config.service";
import type { EmailService } from "./email/email.service";
import { ac, roles } from "./permissions";

const isTestMode = process.env.NODE_ENV === "test";
const authDatabasePool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://mravinale@localhost:5432/nestjs-api-starter",
});
let isAuthDatabasePoolClosed = false;

// Email service instance - will be set by the module
let emailServiceInstance: EmailService | null = null;

export function setEmailService(service: EmailService): void {
    emailServiceInstance = service;
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
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    basePath: "/api/auth",
    trustedOrigins: process.env.TRUSTED_ORIGINS?.split(",") || [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    
    // Plugins
    plugins: [
        bearer(),
        openAPI(),
        jwt(),
        organization({
            sendInvitationEmail: async (payload) => {
                if (emailServiceInstance) {
                    await emailServiceInstance.sendOrganizationInvitation(payload as any);
                } else {
                    console.log("[Organization] Invitation email (no service):", payload.email);
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
        sendResetPassword: async (payload) => {
            if (emailServiceInstance) {
                await emailServiceInstance.sendPasswordResetEmail(payload as any);
            } else {
                console.log("[Password Reset] Email (no service):", payload.user.email);
            }
        },
    },
    
    // Email Verification Configuration
    emailVerification: {
        sendOnSignUp: !isTestMode,
        autoSignInAfterVerification: true,
        expiresIn: 86400, // 24 hours
        sendVerificationEmail: async (payload) => {
            console.log('📧 [Auth] sendVerificationEmail called:', { 
                email: payload.user.email, 
                hasEmailService: !!emailServiceInstance,
                isTestMode,
                sendOnSignUp: !isTestMode
            });
            
            // Modify the callbackURL to point to the frontend
            const feUrl = process.env.FE_URL || "http://localhost:5173";
            const urlObj = new URL(payload.url);
            urlObj.searchParams.set('callbackURL', feUrl);
            const modifiedPayload = { ...payload, url: urlObj.toString() };
            
            if (emailServiceInstance) {
                console.log('✅ [Auth] Calling emailServiceInstance.sendEmailVerification');
                await emailServiceInstance.sendEmailVerification(modifiedPayload as any);
            } else {
                console.log("⚠️ [Auth] Email service not initialized - Email (no service):", payload.user.email);
                console.log("⚠️ [Auth] URL:", modifiedPayload.url);
            }
        },
    },
});
