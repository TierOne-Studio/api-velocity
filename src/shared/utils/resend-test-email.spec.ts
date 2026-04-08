import {
  DEFAULT_E2E_TEST_USER_EMAIL,
  isResendTestEmail,
  resendTestEmail,
  uniqueResendDeliveredEmail,
} from './resend-test-email';

describe('resendTestEmail', () => {
  it('returns delivered address by default', () => {
    expect(resendTestEmail()).toBe('delivered@resend.dev');
  });

  it('builds a labeled resend address using normalized label', () => {
    expect(resendTestEmail('delivered', 'Sign Up Flow')).toBe(
      'delivered+sign-up-flow@resend.dev',
    );
  });

  it('falls back to event-only when label normalizes to empty', () => {
    expect(resendTestEmail('delivered', '___')).toBe('delivered@resend.dev');
  });
});

describe('uniqueResendDeliveredEmail', () => {
  it('returns a delivered resend.dev address with flow label and unique suffix', () => {
    const email = uniqueResendDeliveredEmail('signup');

    expect(email).toMatch(/^delivered\+signup-\d+-[a-z0-9]{6}@resend\.dev$/);
  });

  it('keeps a stable default e2e test user email', () => {
    expect(DEFAULT_E2E_TEST_USER_EMAIL).toBe(
      'delivered+e2e-test-user@resend.dev',
    );
  });
});

describe('isResendTestEmail', () => {
  it('returns true for valid resend test recipient addresses', () => {
    expect(isResendTestEmail('delivered@resend.dev')).toBe(true);
    expect(isResendTestEmail('delivered+signup-flow@resend.dev')).toBe(true);
    expect(isResendTestEmail('BOUNCED+case-insensitive@resend.dev')).toBe(true);
  });

  it('returns false for non-resend recipients', () => {
    expect(isResendTestEmail('user@example.com')).toBe(false);
    expect(isResendTestEmail('hello@resend.com')).toBe(false);
    expect(isResendTestEmail('delivered+bad_label@resend.dev')).toBe(false);
  });
});
