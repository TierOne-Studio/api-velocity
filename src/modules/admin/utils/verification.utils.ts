import * as jose from 'jose';

export async function buildVerificationToken(
  email: string,
  secret: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const encodedSecret = new TextEncoder().encode(secret);
  return new jose.SignJWT({ email: email.toLowerCase() })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${expiresInSeconds}s`)
    .setIssuedAt()
    .sign(encodedSecret);
}

export function buildVerificationUrl(
  token: string,
  baseUrl: string,
  feUrl: string,
): string {
  return `${baseUrl}/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(feUrl)}`;
}
