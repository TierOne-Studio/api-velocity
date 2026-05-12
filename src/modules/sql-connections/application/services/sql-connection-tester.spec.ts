import { ConfigService } from '../../../../shared/config';
import { SqlConnectionTester } from './sql-connection-tester';

describe('SqlConnectionTester (SSRF guard)', () => {
  const buildTester = () => {
    const configService = {
      getSqlAgentConnectTimeoutMs: () => 2000,
    } as unknown as ConfigService;
    return new SqlConnectionTester(configService);
  };

  it.each([
    ['169.254.169.254', /private\/reserved/],
    ['127.0.0.1', /private\/reserved/],
    ['10.0.0.5', /private\/reserved/],
    ['192.168.1.1', /private\/reserved/],
    ['172.20.0.1', /private\/reserved/],
    ['localhost', /loopback/],
  ])(
    'rejects host %s before attempting a connection',
    async (host, errorPattern) => {
      const tester = buildTester();
      const result = await tester.test({
        host,
        port: 5432,
        database: 'app',
        username: 'u',
        password: 'p',
      });
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toMatch(errorPattern);
      }
    },
  );

  it('rejects bracketed IPv6 loopback', async () => {
    const tester = buildTester();
    const result = await tester.test({
      host: '[::1]',
      port: 5432,
      database: 'app',
      username: 'u',
      password: 'p',
    });
    expect(result.ok).toBe(false);
  });
});
