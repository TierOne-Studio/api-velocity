import { rowToOrganization } from './organization.dto';
import type { OrganizationRow } from './organization.dto';

const baseRow: OrganizationRow = {
  id: 'org-1',
  name: 'Test Org',
  slug: 'test-org',
  logo: null,
  metadata: null,
  createdAt: new Date('2024-01-01'),
};

describe('rowToOrganization', () => {
  it('maps a row with null metadata to null on the domain object', () => {
    const org = rowToOrganization(baseRow);

    expect(org.id).toBe('org-1');
    expect(org.name).toBe('Test Org');
    expect(org.slug).toBe('test-org');
    expect(org.logo).toBeNull();
    expect(org.metadata).toBeNull();
    expect(org.createdAt).toEqual(new Date('2024-01-01'));
  });

  it('parses JSON metadata when the metadata field is a non-empty string', () => {
    const row: OrganizationRow = {
      ...baseRow,
      metadata: '{"plan":"pro","seats":10}',
    };
    const org = rowToOrganization(row);

    expect(org.metadata).toEqual({ plan: 'pro', seats: 10 });
  });

  it('includes logo when present', () => {
    const row: OrganizationRow = {
      ...baseRow,
      logo: 'https://cdn.example.com/logo.png',
    };
    const org = rowToOrganization(row);

    expect(org.logo).toBe('https://cdn.example.com/logo.png');
  });
});
