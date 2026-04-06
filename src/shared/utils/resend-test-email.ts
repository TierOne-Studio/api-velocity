export type ResendTestEvent =
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'suppressed';

const RESEND_TEST_DOMAIN = 'resend.dev';
const RANDOM_SUFFIX_LENGTH = 6;
const RESEND_TEST_RECIPIENT_REGEX =
  /^(delivered|bounced|complained|suppressed)(\+[a-z0-9-]+)?@resend\.dev$/i;

export const DEFAULT_E2E_TEST_USER_EMAIL = 'delivered+e2e-test-user@resend.dev';

function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function resendTestEmail(
  event: ResendTestEvent = 'delivered',
  label?: string,
): string {
  if (!label) {
    return `${event}@${RESEND_TEST_DOMAIN}`;
  }

  const normalizedLabel = normalizeLabel(label);
  if (!normalizedLabel) {
    return `${event}@${RESEND_TEST_DOMAIN}`;
  }

  return `${event}+${normalizedLabel}@${RESEND_TEST_DOMAIN}`;
}

export function uniqueResendDeliveredEmail(flowLabel: string): string {
  const randomSuffix = Math.random()
    .toString(36)
    .slice(2, 2 + RANDOM_SUFFIX_LENGTH);
  const uniqueLabel = `${flowLabel}-${Date.now()}-${randomSuffix}`;
  return resendTestEmail('delivered', uniqueLabel);
}

export function isResendTestEmail(email: string): boolean {
  return RESEND_TEST_RECIPIENT_REGEX.test(email.trim());
}
