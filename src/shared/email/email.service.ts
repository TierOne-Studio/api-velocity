import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { ConfigService } from '../config/config.service';
import { isResendTestEmail } from '../utils/resend-test-email';
import type {
  EmailPayload,
  EmailVerificationPayload,
  PasswordResetPayload,
  OrganizationInvitationPayload,
} from './email.interfaces';

@Injectable()
export class EmailService {
  private resendClient: Resend | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.getResendApiKey();
    if (apiKey) {
      this.resendClient = new Resend(apiKey);
      console.log('✅ Resend client initialized');
    } else {
      console.log('⚠️ RESEND_API_KEY not set - emails will be logged only');
    }
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '<invalid>';
    const maskedLocal = local.length > 2 ? local[0] + '***' : '***';
    return `${maskedLocal}@${domain}`;
  }

  async sendEmail({ to, subject, html, text }: EmailPayload): Promise<void> {
    const isTestMode = this.configService.isTestMode();
    const maskedTo = isTestMode ? to : this.maskEmail(to);
    console.log('📧 [EmailService] sendEmail called:', {
      to: maskedTo,
      subject,
      isTestMode,
      hasResendClient: !!this.resendClient,
    });

    if (
      this.configService.shouldEnforceResendTestRecipients() &&
      !isResendTestEmail(to)
    ) {
      console.error(
        '❌ [EmailService] Non-Resend recipient blocked by test guardrail:',
        { to: maskedTo, subject },
      );
      throw new Error(
        'Resend test address required while ENFORCE_RESEND_TEST_RECIPIENTS is enabled. Use delivered@resend.dev or delivered+label@resend.dev.',
      );
    }

    if (this.configService.isTestMode()) {
      console.log('⚠️ [TEST MODE] Email skipped:', { to: maskedTo, subject });
      return;
    }

    if (!this.resendClient) {
      console.log('⚠️ [NO API KEY] Email logged only:', {
        to: maskedTo,
        subject,
      });
      return;
    }

    try {
      console.log('📤 [EmailService] Sending email via Resend:', {
        to: maskedTo,
        subject,
        from: this.configService.getFromEmail(),
      });
      const { data, error } = await this.resendClient.emails.send({
        from: this.configService.getFromEmail(),
        to,
        subject,
        html,
        text,
      });

      if (error) {
        console.error('❌ [EmailService] Error sending email:', error);
        throw new Error('Failed to send email');
      }

      console.log('✅ [EmailService] Email sent successfully:', data);
    } catch (error) {
      console.error('❌ [EmailService] Exception sending email:', error);
      throw error;
    }
  }

  async sendEmailVerification({
    user,
    url,
  }: EmailVerificationPayload): Promise<void> {
    console.log('📧 [EmailService] sendEmailVerification called:', {
      email: user.email,
      url,
    });

    const subject = 'Verify your email';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Email Address</h2>
        <p>Hi ${user.name || user.email},</p>
        <p>Thank you for signing up! Please click the button below to verify your email address.</p>
        <div style="margin: 20px 0;">
          <a href="${url}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Verify Email
          </a>
        </div>
        <p>If you didn't create an account with us, you can safely ignore this email.</p>
        <p>This verification link will expire soon.</p>
      </div>
    `;
    const text = `Verify your email using this link: ${url}`;

    await this.sendEmail({ to: user.email, subject, html, text });
  }

  async sendPasswordResetEmail({
    user,
    token,
  }: PasswordResetPayload): Promise<void> {
    const resetUrl = `${this.configService.getFeUrl()}/set-new-password?token=${token}`;

    const subject = 'Reset your password';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Reset Your Password</h2>
        <p>Hi ${user.name || user.email},</p>
        <p>Please click the link below to reset your password. This link will expire soon.</p>
        <div style="margin: 20px 0;">
          <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Reset Password
          </a>
        </div>
        <p>If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;
    const text = `Reset your password using this link: ${resetUrl}`;

    await this.sendEmail({ to: user.email, subject, html, text });
  }

  async sendOrganizationInvitation({
    id,
    email,
    role,
    organization,
    inviter,
  }: OrganizationInvitationPayload): Promise<void> {
    const inviteUrl = `${this.configService.getFeUrl()}/accept-invitation/${id}`;

    const subject = `Invitation to join ${organization.name}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You're Invited to Join ${organization.name}</h2>
        <p>Hi,</p>
        <p>${inviter.user.name || inviter.user.email} has invited you to join <strong>${organization.name}</strong> as a <strong>${role}</strong>.</p>
        <div style="margin: 20px 0;">
          <a href="${inviteUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Accept Invitation
          </a>
        </div>
        <p>If you don't want to join this organization, you can safely ignore this email.</p>
        <p>This invitation link will expire soon.</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666;">
          Invited by: ${inviter.user.email}<br>
          Organization: ${organization.name}<br>
          Role: ${role}
        </p>
      </div>
    `;
    const text = `You've been invited to join ${organization.name} as a ${role}. Accept the invitation using this link: ${inviteUrl}`;

    await this.sendEmail({ to: email, subject, html, text });
  }
}
