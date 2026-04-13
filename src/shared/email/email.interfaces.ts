export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailVerificationPayload {
  user: User;
  url: string;
  token: string;
}

export interface PasswordResetPayload {
  user: User;
  url: string;
  token: string;
}

export interface ApprovalNotificationPayload {
  user: User;
}

export interface RejectionNotificationPayload {
  user: User;
  reason?: string;
}

export interface OrganizationInvitationPayload {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  organization: {
    id: string;
    name: string;
    slug?: string;
  };
  inviter: {
    user: User;
  };
  teamId?: string;
  expiresAt: Date;
}
