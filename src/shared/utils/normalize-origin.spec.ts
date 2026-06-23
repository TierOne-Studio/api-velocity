import { describe, expect, it } from '@jest/globals';
import { normalizeOrigin } from './normalize-origin';

describe('normalizeOrigin', () => {
  it('lowercases scheme and host', () => {
    expect(normalizeOrigin('HTTPS://Customer.COM')).toBe(
      'https://customer.com',
    );
  });

  it('strips a trailing slash / path', () => {
    expect(normalizeOrigin('https://customer.com/')).toBe(
      'https://customer.com',
    );
  });

  it('elides the default https port 443', () => {
    expect(normalizeOrigin('https://customer.com:443')).toBe(
      'https://customer.com',
    );
  });

  it('elides the default http port 80', () => {
    expect(normalizeOrigin('http://customer.com:80')).toBe(
      'http://customer.com',
    );
  });

  it('keeps a non-default port', () => {
    expect(normalizeOrigin('https://customer.com:8443')).toBe(
      'https://customer.com:8443',
    );
  });

  it('returns null for a missing origin', () => {
    expect(normalizeOrigin(undefined)).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });

  it('returns null for an unparseable origin', () => {
    expect(normalizeOrigin('not-a-url')).toBeNull();
  });

  it('normalizes equal origins that differ only by case/port/slash to the same value', () => {
    expect(normalizeOrigin('https://Customer.com:443/')).toBe(
      normalizeOrigin('https://customer.com'),
    );
  });
});
