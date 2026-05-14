/**
 * SSRF host validation for outbound connections from the agent path.
 *
 * Rejects hosts that resolve to RFC1918 / loopback / link-local / unique-local
 * / cloud-metadata / wildcard / CGNAT ranges. Used by sql-connection-tester
 * and sql-datasource.factory to prevent a logged-in org member from coercing
 * the server into probing internal services or the cloud-provider metadata
 * endpoint.
 *
 * Residual risk: DNS-rebinding between this check and the eventual TCP
 * connect remains theoretically possible. A stricter defense is to resolve
 * once, validate, then dial by IP — which is a larger refactor tracked
 * separately. Within a single async tick the lookup-then-connect window
 * is small enough that this guard meaningfully raises the bar.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeHostError';
  }
}

export interface HostLookupResult {
  address: string;
}
export type HostLookup = (host: string) => Promise<HostLookupResult[]>;

export interface AssertSafeAgentHostOptions {
  /** Injectable resolver for deterministic unit testing. */
  lookup?: HostLookup;
}

// IPv4 ranges (inclusive) expressed as 32-bit integers via BigInt.
function ipv4ToBigint(ip: string): bigint {
  const parts = ip.split('.').map(Number);
  return (
    (BigInt(parts[0]) << 24n) +
    (BigInt(parts[1]) << 16n) +
    (BigInt(parts[2]) << 8n) +
    BigInt(parts[3])
  );
}

const PRIVATE_IPV4_RANGES: ReadonlyArray<{ from: bigint; to: bigint }> = [
  // 0.0.0.0/8 — "this network", wildcard
  { from: ipv4ToBigint('0.0.0.0'), to: ipv4ToBigint('0.255.255.255') },
  // 10.0.0.0/8 — RFC1918
  { from: ipv4ToBigint('10.0.0.0'), to: ipv4ToBigint('10.255.255.255') },
  // 100.64.0.0/10 — CGNAT
  { from: ipv4ToBigint('100.64.0.0'), to: ipv4ToBigint('100.127.255.255') },
  // 127.0.0.0/8 — loopback
  { from: ipv4ToBigint('127.0.0.0'), to: ipv4ToBigint('127.255.255.255') },
  // 169.254.0.0/16 — link-local incl. AWS/GCP/Azure metadata
  { from: ipv4ToBigint('169.254.0.0'), to: ipv4ToBigint('169.254.255.255') },
  // 172.16.0.0/12 — RFC1918
  { from: ipv4ToBigint('172.16.0.0'), to: ipv4ToBigint('172.31.255.255') },
  // 192.168.0.0/16 — RFC1918
  { from: ipv4ToBigint('192.168.0.0'), to: ipv4ToBigint('192.168.255.255') },
];

export function isPrivateIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const n = ipv4ToBigint(ip);
  return PRIVATE_IPV4_RANGES.some((r) => n >= r.from && n <= r.to);
}

export function isPrivateIpv6(ip: string): boolean {
  if (isIP(ip) !== 6) return false;
  const lower = ip.toLowerCase();
  // Loopback ::1
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  // Unspecified / wildcard "any" address (security MED-4). On Linux,
  // dialing [::]:5432 resolves to the local interface — SSRF-equivalent.
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  // v4-mapped ::ffff:a.b.c.d (compressed form) — check the v4 part.
  const v4mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isPrivateIpv4(v4mapped[1]);
  // v4-mapped fully expanded: 0:0:0:0:0:ffff:c0a8:0101 (= 192.168.1.1)
  // (security MED-4). The last 32 bits encode the IPv4 address as two
  // 16-bit hex groups; reconstruct and check.
  const v4mappedExpanded = lower.match(
    /^0:0:0:0:0:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (v4mappedExpanded) {
    const hi = parseInt(v4mappedExpanded[1]!, 16);
    const lo = parseInt(v4mappedExpanded[2]!, 16);
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isPrivateIpv4(dotted);
  }
  // Unique-local fc00::/7 (fc.. or fd..)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  return false;
}

export function isPrivateIp(ip: string): boolean {
  return isPrivateIpv4(ip) || isPrivateIpv6(ip);
}

const NAMED_LOOPBACK_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

const defaultLookup: HostLookup = async (host) => {
  const addrs = await dns.lookup(host, { all: true });
  return addrs.map((a) => ({ address: a.address }));
};

/**
 * Throws `UnsafeHostError` if `host` is a literal private/reserved IP, a
 * known loopback hostname, or resolves to any private address.
 */
export async function assertSafeAgentHost(
  host: string,
  options?: AssertSafeAgentHostOptions,
): Promise<void> {
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw new UnsafeHostError('host must be a non-empty string');
  }

  const lookup = options?.lookup ?? defaultLookup;
  const lowered = host.trim().toLowerCase();

  // Strip a single pair of brackets used for IPv6 literals.
  const cleaned =
    lowered.startsWith('[') && lowered.endsWith(']')
      ? lowered.slice(1, -1)
      : lowered;

  if (NAMED_LOOPBACK_HOSTS.has(cleaned)) {
    throw new UnsafeHostError(`host '${host}' resolves to a loopback address`);
  }

  if (isIP(cleaned)) {
    if (isPrivateIp(cleaned)) {
      throw new UnsafeHostError(
        `host '${host}' is in a private/reserved range`,
      );
    }
    return;
  }

  let addresses: HostLookupResult[];
  try {
    addresses = await lookup(cleaned);
  } catch (error) {
    throw new UnsafeHostError(
      `unable to resolve host '${host}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new UnsafeHostError(
        `host '${host}' resolves to a private/reserved address (${addr.address})`,
      );
    }
  }
}
