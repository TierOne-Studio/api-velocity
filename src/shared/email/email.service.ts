import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { ConfigService } from '../config/config.service';
import { isResendTestEmail } from '../utils/resend-test-email';
import { escapeHtml } from '../utils/html-escape';
import type {
  EmailPayload,
  EmailVerificationPayload,
  PasswordResetPayload,
  OrganizationInvitationPayload,
  ApprovalNotificationPayload,
  RejectionNotificationPayload,
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

    const safeName = escapeHtml(user.name || user.email);

    const subject = 'Verify your email';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Email Address</h2>
        <p>Hi ${safeName},</p>
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
    const resetUrl = `${this.configService.getFeUrl()}/set-new-password?token=${encodeURIComponent(token)}`;
    const safeName = escapeHtml(user.name || user.email);

    const subject = 'Reset your password';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Reset Your Password</h2>
        <p>Hi ${safeName},</p>
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
    const inviteUrl = `${this.configService.getFeUrl()}/accept-invitation/${encodeURIComponent(id)}`;
    const safeOrgName = escapeHtml(organization.name);
    const safeInviterName = escapeHtml(inviter.user.name || inviter.user.email);
    const safeInviterEmail = escapeHtml(inviter.user.email);
    const safeRole = escapeHtml(role);

    const subject = `Invitation to join ${organization.name}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You're Invited to Join ${safeOrgName}</h2>
        <p>Hi,</p>
        <p>${safeInviterName} has invited you to join <strong>${safeOrgName}</strong> as a <strong>${safeRole}</strong>.</p>
        <div style="margin: 20px 0;">
          <a href="${inviteUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Accept Invitation
          </a>
        </div>
        <p>If you don't want to join this organization, you can safely ignore this email.</p>
        <p>This invitation link will expire soon.</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666;">
          Invited by: ${safeInviterEmail}<br>
          Organization: ${safeOrgName}<br>
          Role: ${safeRole}
        </p>
      </div>
    `;
    const text = `You've been invited to join ${organization.name} as a ${role}. Accept the invitation using this link: ${inviteUrl}`;

    await this.sendEmail({ to: email, subject, html, text });
  }

  async sendApprovalNotification({
    user,
  }: ApprovalNotificationPayload): Promise<void> {
    const loginUrl = `${this.configService.getFeUrl()}/login`;
    const safeName = escapeHtml(user.name || user.email);

    const subject = 'Your account has been approved';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Account Approved</h2>
        <p>Hi ${safeName},</p>
        <p>Your account has been approved. You can now log in and start using the platform.</p>
        <div style="margin: 20px 0;">
          <a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
            Log In
          </a>
        </div>
      </div>
    `;
    const text = `Your account has been approved. Log in here: ${loginUrl}`;

    await this.sendEmail({ to: user.email, subject, html, text });
  }

  async sendRejectionNotification({
    user,
    reason,
  }: RejectionNotificationPayload): Promise<void> {
    const safeName = escapeHtml(user.name || user.email);
    const safeReason = escapeHtml(reason);

    const subject = 'Your account registration was not approved';
    const reasonText = safeReason
      ? `<p><strong>Reason:</strong> ${safeReason}</p>`
      : '';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Account Not Approved</h2>
        <p>Hi ${safeName},</p>
        <p>Unfortunately, your account registration was not approved at this time.</p>
        ${reasonText}
        <p>If you believe this is a mistake, please contact the platform administrator.</p>
      </div>
    `;
    const text = `Your account registration was not approved.${reason ? ` Reason: ${reason}` : ''} If you believe this is a mistake, please contact the platform administrator.`;

    await this.sendEmail({ to: user.email, subject, html, text });
  }
}
