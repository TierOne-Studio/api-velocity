import {
  UnsafeHostError,
  assertSafeAgentHost,
  isPrivateIp,
  isPrivateIpv4,
  isPrivateIpv6,
} from './host-validator';

describe('host-validator', () => {
  describe('isPrivateIpv4', () => {
    it.each([
      ['10.0.0.1', true],
      ['10.255.255.255', true],
      ['172.16.0.1', true],
      ['172.31.255.255', true],
      ['172.32.0.1', false],
      ['192.168.1.1', true],
      ['127.0.0.1', true],
      ['127.255.255.255', true],
      ['169.254.169.254', true], // AWS metadata
      ['169.254.0.1', true],
      ['100.64.0.1', true], // CGNAT
      ['100.127.255.255', true],
      ['0.0.0.0', true],
      ['0.255.255.255', true],
      ['8.8.8.8', false],
      ['1.1.1.1', false],
      ['203.0.113.1', false], // TEST-NET-3 (public-class)
    ])('classifies %s as private=%s', (ip, expected) => {
      expect(isPrivateIpv4(ip)).toBe(expected);
    });

    it('returns false for non-IPv4 input', () => {
      expect(isPrivateIpv4('not-an-ip')).toBe(false);
      expect(isPrivateIpv4('::1')).toBe(false);
    });
  });

  describe('isPrivateIpv6', () => {
    it.each([
      ['::1', true],
      ['fc00::1', true],
      ['fd12:3456:789a::1', true],
      ['fe80::1', true],
      ['febf::1', true],
      ['::ffff:127.0.0.1', true], // v4-mapped loopback
      ['::ffff:10.0.0.1', true], // v4-mapped private
      // Security MED-4: wildcard / unspecified address
      ['::', true],
      ['0:0:0:0:0:0:0:0', true],
      // Security MED-4: fully expanded v4-mapped form
      ['0:0:0:0:0:ffff:c0a8:0101', true], // 192.168.1.1
      ['0:0:0:0:0:ffff:7f00:0001', true], // 127.0.0.1
      ['0:0:0:0:0:ffff:0a00:0005', true], // 10.0.0.5
      ['0:0:0:0:0:ffff:a9fe:a9fe', true], // 169.254.169.254 (AWS metadata)
      ['0:0:0:0:0:ffff:0808:0808', false], // 8.8.8.8 (public)
      ['2001:4860:4860::8888', false],
      ['2606:4700:4700::1111', false],
    ])('classifies %s as private=%s', (ip, expected) => {
      expect(isPrivateIpv6(ip)).toBe(expected);
    });

    it('returns false for non-IPv6 input', () => {
      expect(isPrivateIpv6('not-an-ip')).toBe(false);
      expect(isPrivateIpv6('127.0.0.1')).toBe(false);
    });
  });

  describe('isPrivateIp', () => {
    it('unifies v4 and v6 checks', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('2001:db8::1')).toBe(false);
    });
  });

  describe('assertSafeAgentHost', () => {
    // Stub the resolver to make tests deterministic — no real DNS.
    const resolverFor = (addresses: string[]) => async () =>
      addresses.map((address) => ({ address }));

    it('throws on empty / whitespace host', async () => {
      await expect(assertSafeAgentHost('')).rejects.toBeInstanceOf(
        UnsafeHostError,
      );
      await expect(assertSafeAgentHost('   ')).rejects.toBeInstanceOf(
        UnsafeHostError,
      );
    });

    it('throws on literal loopback IPv4', async () => {
      await expect(assertSafeAgentHost('127.0.0.1')).rejects.toThrow(
        /private\/reserved range/,
      );
    });

    it('throws on AWS metadata IP', async () => {
      await expect(assertSafeAgentHost('169.254.169.254')).rejects.toThrow(
        /private\/reserved range/,
      );
    });

    it('throws on RFC1918 IPv4', async () => {
      await expect(assertSafeAgentHost('10.0.0.5')).rejects.toThrow(
        UnsafeHostError,
      );
      await expect(assertSafeAgentHost('192.168.1.1')).rejects.toThrow(
        UnsafeHostError,
      );
      await expect(assertSafeAgentHost('172.20.0.1')).rejects.toThrow(
        UnsafeHostError,
      );
    });

    it('throws on bracketed IPv6 loopback', async () => {
      await expect(assertSafeAgentHost('[::1]')).rejects.toThrow(
        UnsafeHostError,
      );
    });

    it('throws on unbracketed IPv6 loopback / ULA / link-local', async () => {
      await expect(assertSafeAgentHost('::1')).rejects.toThrow(UnsafeHostError);
      await expect(assertSafeAgentHost('fd12::1')).rejects.toThrow(
        UnsafeHostError,
      );
      await expect(assertSafeAgentHost('fe80::1')).rejects.toThrow(
        UnsafeHostError,
      );
    });

    it('throws on the literal hostname "localhost" and variants', async () => {
      await expect(assertSafeAgentHost('localhost')).rejects.toThrow(
        UnsafeHostError,
      );
      await expect(assertSafeAgentHost('LOCALHOST')).rejects.toThrow(
        UnsafeHostError,
      );
      await expect(
        assertSafeAgentHost('localhost.localdomain'),
      ).rejects.toThrow(UnsafeHostError);
    });

    it('throws when the resolver returns a private address (DNS rebinding shape)', async () => {
      await expect(
        assertSafeAgentHost('internal.example.com', {
          lookup: resolverFor(['10.0.0.5']),
        }),
      ).rejects.toThrow(/private\/reserved address/);
    });

    it('throws when ANY resolved address is private (mixed A records)', async () => {
      await expect(
        assertSafeAgentHost('mixed.example.com', {
          lookup: resolverFor(['8.8.8.8', '10.0.0.5']),
        }),
      ).rejects.toThrow(/private\/reserved address/);
    });

    it('passes for a literal public IPv4', async () => {
      await expect(assertSafeAgentHost('8.8.8.8')).resolves.toBeUndefined();
    });

    it('passes for a literal public IPv6', async () => {
      await expect(
        assertSafeAgentHost('2001:4860:4860::8888'),
      ).resolves.toBeUndefined();
      await expect(
        assertSafeAgentHost('[2001:4860:4860::8888]'),
      ).resolves.toBeUndefined();
    });

    it('passes when the resolver returns only public addresses', async () => {
      await expect(
        assertSafeAgentHost('example.com', {
          lookup: resolverFor(['93.184.216.34']),
        }),
      ).resolves.toBeUndefined();
    });

    it('throws when the resolver itself errors out', async () => {
      const failing = async () => {
        throw new Error('ENOTFOUND');
      };
      await expect(
        assertSafeAgentHost('nope.example.com', { lookup: failing }),
      ).rejects.toThrow(/unable to resolve/);
    });
  });
});
