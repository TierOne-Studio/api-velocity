/**
 * Normalize an Origin header / allowlist entry to a canonical form for exact
 * comparison (SPEC-003 §7.4b, §10.2). Scheme + host are lowercased, a default
 * port (80 for http, 443 for https) is elided, any path/trailing slash is
 * dropped. Returns `null` for a missing or unparseable origin.
 *
 * Exact match on the normalized value only — never suffix/substring matching,
 * which is a classic CORS-bypass footgun. Shared between the public-chat embed
 * guard (request-time) and the embed-sites admin write path (store-normalized).
 */
export function normalizeOrigin(
  origin: string | null | undefined,
): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }

  const scheme = url.protocol.toLowerCase(); // includes trailing ':'
  const host = url.hostname.toLowerCase();
  const isDefaultPort =
    url.port === '' ||
    (scheme === 'http:' && url.port === '80') ||
    (scheme === 'https:' && url.port === '443');
  const portSuffix = isDefaultPort ? '' : `:${url.port}`;

  return `${scheme}//${host}${portSuffix}`;
}
