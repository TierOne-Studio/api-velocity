import { jest } from '@jest/globals';
import { ConfigService } from '../config/config.service';
import { EmailService } from './email.service';

describe('EmailService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DOTENV_CONFIG_PATH;
    delete process.env.ENFORCE_RESEND_TEST_RECIPIENTS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createConfigServiceMock(
    overrides?: Partial<ConfigService>,
  ): ConfigService {
    const mock = {
      getResendApiKey: jest.fn(() => ''),
      getFromEmail: jest.fn(() => 'noreply@tierone.cc'),
      getFeUrl: jest.fn(() => 'http://localhost:5173'),
      isTestMode: jest.fn(() => false),
      shouldEnforceResendTestRecipients: jest.fn(() => false),
      ...overrides,
    };

    return mock as unknown as ConfigService;
  }

  it('throws when recipient is not resend.dev and test-recipient guardrail is enabled', async () => {
    const configService = createConfigServiceMock({
      shouldEnforceResendTestRecipients: jest.fn(() => true),
    });
    const service = new EmailService(configService);

    await expect(
      service.sendEmail({
        to: 'user@example.com',
        subject: 'Guardrail test',
        html: '<p>Hello</p>',
      }),
    ).rejects.toThrow('Resend test address');
  });

  it('allows resend test recipient when guardrail is enabled', async () => {
    const configService = createConfigServiceMock({
      shouldEnforceResendTestRecipients: jest.fn(() => true),
    });
    const service = new EmailService(configService);

    await expect(
      service.sendEmail({
        to: 'delivered+guardrail@resend.dev',
        subject: 'Guardrail test',
        html: '<p>Hello</p>',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows non-resend recipient when guardrail is disabled', async () => {
    const configService = createConfigServiceMock({
      shouldEnforceResendTestRecipients: jest.fn(() => false),
    });
    const service = new EmailService(configService);

    await expect(
      service.sendEmail({
        to: 'user@example.com',
        subject: 'No guardrail',
        html: '<p>Hello</p>',
      }),
    ).resolves.toBeUndefined();
  });

  it('skips sending in test mode', async () => {
    const configService = createConfigServiceMock({
      isTestMode: jest.fn(() => true),
    });
    const service = new EmailService(configService);

    await expect(
      service.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
      }),
    ).resolves.toBeUndefined();
  });

  it('skips sending when no API key is configured', async () => {
    const configService = createConfigServiceMock({
      getResendApiKey: jest.fn(() => ''),
      isTestMode: jest.fn(() => false),
    });
    const service = new EmailService(configService);

    await expect(
      service.sendEmail({
        to: 'user@example.com',
        subject: 'No key',
        html: '<p>Hi</p>',
      }),
    ).resolves.toBeUndefined();
  });

  describe('sendEmailVerification', () => {
    it('calls sendEmail with verification subject and URL', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendEmailVerification({
        user: { id: 'user-1', email: 'user@example.com', name: 'Test User' },
        url: 'https://api.example.com/verify?token=abc',
        token: 'abc',
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Verify your email',
          html: expect.stringContaining(
            'https://api.example.com/verify?token=abc',
          ),
        }),
      );
    });

    it('uses email as fallback when name is not provided', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendEmailVerification({
        user: { id: 'user-1', email: 'user@example.com', name: '' },
        url: 'https://api.example.com/verify',
        token: 'abc',
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('user@example.com'),
        }),
      );
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('calls sendEmail with reset subject and correct URL', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
        getFeUrl: jest.fn(() => 'https://app.example.com'),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendPasswordResetEmail({
        user: { id: 'user-1', email: 'user@example.com', name: 'Test User' },
        token: 'reset-token-xyz',
        url: 'https://app.example.com/set-new-password?token=reset-token-xyz',
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Reset your password',
          html: expect.stringContaining('reset-token-xyz'),
        }),
      );
    });
  });

  describe('production send (with Resend client)', () => {
    it('initializes Resend client when API key is present', () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      const configService = createConfigServiceMock({
        getResendApiKey: jest.fn(() => 'real-api-key'),
      });

      new EmailService(configService);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resend client initialized'),
      );
      consoleSpy.mockRestore();
    });

    it('sends email successfully via Resend', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      const configService = createConfigServiceMock({
        getResendApiKey: jest.fn(() => 'real-api-key'),
        isTestMode: jest.fn(() => false),
      });
      const service = new EmailService(configService);

      // Mock the internal resendClient.emails.send
      const mockSend = jest
        .fn<() => Promise<{ data: { id: string }; error: null }>>()
        .mockResolvedValue({ data: { id: 'email-123' }, error: null });
      (service as any).resendClient = { emails: { send: mockSend } };

      await service.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@tierone.cc',
          to: 'user@example.com',
          subject: 'Test',
        }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EmailService] Email sent successfully'),
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });

    it('throws when Resend API returns error object', async () => {
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const configService = createConfigServiceMock({
        getResendApiKey: jest.fn(() => 'real-api-key'),
        isTestMode: jest.fn(() => false),
      });
      const service = new EmailService(configService);

      const mockSend = jest
        .fn<() => Promise<{ data: null; error: { message: string } }>>()
        .mockResolvedValue({ data: null, error: { message: 'rate limited' } });
      (service as any).resendClient = { emails: { send: mockSend } };

      await expect(
        service.sendEmail({
          to: 'user@example.com',
          subject: 'Err',
          html: '<p>Hi</p>',
        }),
      ).rejects.toThrow('Failed to send email');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error sending email'),
        expect.objectContaining({ message: 'rate limited' }),
      );
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('re-throws when Resend client throws an exception', async () => {
      const consoleSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const configService = createConfigServiceMock({
        getResendApiKey: jest.fn(() => 'real-api-key'),
        isTestMode: jest.fn(() => false),
      });
      const service = new EmailService(configService);

      const mockSend = jest
        .fn<() => Promise<never>>()
        .mockRejectedValue(new Error('Network timeout'));
      (service as any).resendClient = { emails: { send: mockSend } };

      await expect(
        service.sendEmail({
          to: 'user@example.com',
          subject: 'Exc',
          html: '<p>Hi</p>',
        }),
      ).rejects.toThrow('Network timeout');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Exception sending email'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  describe('sendOrganizationInvitation', () => {
    it('calls sendEmail with invitation subject and org name', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
        getFeUrl: jest.fn(() => 'https://app.example.com'),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendOrganizationInvitation({
        id: 'inv-1',
        email: 'invitee@example.com',
        role: 'member',
        organizationId: 'org-1',
        organization: { id: 'org-1', name: 'Acme Corp', slug: 'acme-corp' },
        inviter: {
          user: {
            id: 'admin-1',
            name: 'Admin User',
            email: 'admin@example.com',
          },
        },
        expiresAt: new Date(Date.now() + 86400000),
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invitee@example.com',
          subject: 'Invitation to join Acme Corp',
          html: expect.stringContaining('inv-1'),
        }),
      );
    });

    it('uses inviter email as fallback when inviter name is not provided', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
        getFeUrl: jest.fn(() => 'https://app.example.com'),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendOrganizationInvitation({
        id: 'inv-2',
        email: 'invitee@example.com',
        role: 'member',
        organizationId: 'org-1',
        organization: { id: 'org-1', name: 'Acme Corp', slug: 'acme-corp' },
        inviter: {
          user: { id: 'admin-1', name: '', email: 'admin@example.com' },
        },
        expiresAt: new Date(Date.now() + 86400000),
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('admin@example.com'),
        }),
      );
    });
  });

  describe('maskEmail edge cases', () => {
    it('masks a short local-part (2 chars or fewer) with triple stars', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      const configService = createConfigServiceMock({
        getResendApiKey: jest.fn(() => ''),
        isTestMode: jest.fn(() => false),
      });
      const service = new EmailService(configService);

      await service.sendEmail({
        to: 'ab@example.com',
        subject: 'Short',
        html: '<p>Hi</p>',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EmailService] sendEmail called:'),
        expect.objectContaining({ to: '***@example.com' }),
      );
      consoleSpy.mockRestore();
    });

    it('handles email addresses without @ gracefully by masking to <invalid>', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});
      const configService = createConfigServiceMock({
        getResendApiKey: jest.fn(() => ''),
        isTestMode: jest.fn(() => false),
        shouldEnforceResendTestRecipients: jest.fn(() => false),
      });
      const service = new EmailService(configService);

      await service.sendEmail({
        to: 'not-an-email',
        subject: 'No at',
        html: '<p>Hi</p>',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EmailService] sendEmail called:'),
        expect.objectContaining({ to: '<invalid>' }),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('sendPasswordResetEmail (name fallback)', () => {
    it('uses email as fallback when user name is empty', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
        getFeUrl: jest.fn(() => 'https://app.example.com'),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendPasswordResetEmail({
        user: { id: 'user-1', email: 'user@example.com', name: '' },
        token: 'reset-token-xyz',
        url: 'https://app.example.com/set-new-password?token=reset-token-xyz',
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('user@example.com'),
        }),
      );
    });
  });

  describe('sendApprovalNotification', () => {
    it('calls sendEmail with approval subject and login URL', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
        getFeUrl: jest.fn(() => 'https://app.example.com'),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendApprovalNotification({
        user: { id: 'user-1', email: 'user@example.com', name: 'Alice' },
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Your account has been approved',
          html: expect.stringContaining('https://app.example.com/login'),
        }),
      );
    });

    it('uses email as fallback when name is empty', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
        getFeUrl: jest.fn(() => 'https://app.example.com'),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendApprovalNotification({
        user: { id: 'user-1', email: 'user@example.com', name: '' },
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('user@example.com'),
        }),
      );
    });
  });

  describe('sendRejectionNotification', () => {
    it('calls sendEmail with rejection subject', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendRejectionNotification({
        user: { id: 'user-1', email: 'user@example.com', name: 'Bob' },
        reason: 'Not meeting requirements',
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Your account registration was not approved',
          html: expect.stringContaining('Not meeting requirements'),
        }),
      );
    });

    it('sends rejection email without reason', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendRejectionNotification({
        user: { id: 'user-1', email: 'user@example.com', name: 'Bob' },
        reason: undefined,
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Your account registration was not approved',
        }),
      );
    });

    it('uses email as fallback when user name is empty', async () => {
      const configService = createConfigServiceMock({
        isTestMode: jest.fn(() => true),
      });
      const service = new EmailService(configService);
      const sendEmailSpy = jest.spyOn(service, 'sendEmail');

      await service.sendRejectionNotification({
        user: { id: 'user-1', email: 'user@example.com', name: '' },
      });

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          html: expect.stringContaining('user@example.com'),
        }),
      );
    });
  });
});
