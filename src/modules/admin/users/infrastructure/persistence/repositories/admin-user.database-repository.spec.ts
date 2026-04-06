import { jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { AdminUserDatabaseRepository } from './admin-user.database-repository';

const mockQuery = jest.fn<any>();
const mockQueryOne = jest.fn<any>();
const mockTransaction = jest.fn<any>();

const mockDb = {
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
};

describe('AdminUserDatabaseRepository', () => {
  let repo: AdminUserDatabaseRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repo = new AdminUserDatabaseRepository(mockDb as any);
    mockTransaction.mockImplementation(
      async (fn: (q: typeof mockQuery) => Promise<void>) => {
        await fn(mockQuery);
      },
    );
  });

  // ─── findUserRole ────────────────────────────────────────────────────────────

  describe('findUserRole', () => {
    it('returns the role string when user exists', async () => {
      mockQueryOne.mockResolvedValue({ role: 'admin' });
      expect(await repo.findUserRole('u-1')).toBe('admin');
    });

    it('returns null when user not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findUserRole('ghost')).toBeNull();
    });

    it('returns member when user exists with null platform role', async () => {
      mockQueryOne.mockResolvedValue({ role: null });
      expect(await repo.findUserRole('u-2')).toBe('member');
    });
  });

  // ─── findUserById ────────────────────────────────────────────────────────────

  describe('findUserById', () => {
    it('delegates to queryOne and returns row', async () => {
      const row = { id: 'u-1', name: 'Alice' };
      mockQueryOne.mockResolvedValue(row);
      expect(await repo.findUserById('u-1')).toEqual(row);
    });
  });

  // ─── findMemberInOrg ─────────────────────────────────────────────────────────

  describe('findMemberInOrg', () => {
    it('returns id when member exists in org', async () => {
      mockQueryOne.mockResolvedValue({ id: 'mem-1' });
      expect(await repo.findMemberInOrg('u-1', 'org-1')).toEqual({
        id: 'mem-1',
      });
    });

    it('returns null when no membership', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findMemberInOrg('ghost', 'org-1')).toBeNull();
    });
  });

  // ─── findUserOrganization ────────────────────────────────────────────────────

  describe('findUserOrganization', () => {
    it('returns organizationId row', async () => {
      mockQueryOne.mockResolvedValue({ organizationId: 'org-1' });
      expect(await repo.findUserOrganization('u-1')).toEqual({
        organizationId: 'org-1',
      });
    });
  });

  // ─── updateUser ──────────────────────────────────────────────────────────────

  describe('updateUser', () => {
    it('falls back to findUserById when no fields provided', async () => {
      const row = { id: 'u-1', name: 'Alice' };
      mockQueryOne.mockResolvedValue(row);
      const result = await repo.updateUser('u-1', {});
      expect(result).toEqual(row);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it('runs UPDATE when name is provided', async () => {
      const row = { id: 'u-1', name: 'Bob' };
      mockQueryOne.mockResolvedValue(row);
      const result = await repo.updateUser('u-1', { name: 'Bob' });
      expect(result).toEqual(row);
      const [sql] = mockQueryOne.mock.calls[0] as string[];
      expect(sql).toContain('UPDATE');
    });
  });

  // ─── banUser / unbanUser ─────────────────────────────────────────────────────

  describe('banUser', () => {
    it('bans with reason', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.banUser('u-1', 'spam');
      expect(mockQuery.mock.calls[0][1]).toEqual(['spam', 'u-1']);
    });

    it('bans with null reason when omitted', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.banUser('u-1');
      expect(mockQuery.mock.calls[0][1]).toEqual([null, 'u-1']);
    });
  });

  describe('unbanUser', () => {
    it('clears ban columns', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.unbanUser('u-1');
      expect(mockQuery.mock.calls[0][1]).toEqual(['u-1']);
    });
  });

  // ─── setUserPassword ─────────────────────────────────────────────────────────

  describe('setUserPassword', () => {
    it('updates account password', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.setUserPassword('u-1', 'hashed');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('hashed');
      expect(params[1]).toBe('u-1');
    });
  });

  // ─── removeUser / removeUsers ────────────────────────────────────────────────

  describe('removeUser', () => {
    it('deletes by id', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.removeUser('u-1');
      expect(mockQuery.mock.calls[0][1]).toEqual(['u-1']);
    });
  });

  describe('removeUsers', () => {
    it('returns 0 without querying for empty array', async () => {
      const count = await repo.removeUsers([]);
      expect(count).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('builds IN placeholders with RETURNING id and returns actual deleted count', async () => {
      mockQuery.mockResolvedValue([{ id: 'u-1' }, { id: 'u-2' }]);
      const count = await repo.removeUsers(['u-1', 'u-2']);
      const [sql, params] = mockQuery.mock.calls[0] as [string, string[]];
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('RETURNING id');
      expect(params).toEqual(['u-1', 'u-2']);
      expect(count).toBe(2);
    });

    it('returns actual count when some ids are not found', async () => {
      mockQuery.mockResolvedValue([{ id: 'u-1' }]);
      const count = await repo.removeUsers(['u-1', 'ghost-id']);
      expect(count).toBe(1);
    });
  });

  // ─── listUsers ───────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    const baseParams = {
      limit: 10,
      offset: 0,
      platformRole: 'superadmin' as const,
      activeOrganizationId: null,
    };

    it('returns data and parsed total with no filters', async () => {
      mockQuery.mockResolvedValue([{ id: 'u-1' }]);
      mockQueryOne.mockResolvedValue({ count: '1' });
      const result = await repo.listUsers(baseParams);
      expect(result.data).toEqual([{ id: 'u-1' }]);
      expect(result.total).toBe(1);
    });

    it('returns additive memberships data when present in query rows', async () => {
      mockQuery.mockResolvedValue([
        {
          id: 'u-1',
          memberships: [
            {
              organizationId: 'org-1',
              organizationName: 'Org 1',
              roleName: 'admin',
              roleDisplayName: 'Admin',
            },
          ],
        },
      ]);
      mockQueryOne.mockResolvedValue({ count: '1' });

      const result = await repo.listUsers(baseParams);

      expect(result.data[0]).toEqual(
        expect.objectContaining({
          memberships: [
            {
              organizationId: 'org-1',
              organizationName: 'Org 1',
              roleName: 'admin',
              roleDisplayName: 'Admin',
            },
          ],
        }),
      );
    });

    it('returns 0 total when queryOne returns null', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue(null);
      const result = await repo.listUsers(baseParams);
      expect(result.total).toBe(0);
    });

    it('adds ILIKE clause when searchValue is provided', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '0' });
      await repo.listUsers({ ...baseParams, searchValue: 'alice' });
      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).toContain('ILIKE');
    });

    it('does not add EXISTS clause for superadmin', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '0' });
      await repo.listUsers(baseParams);
      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).not.toContain('EXISTS');
    });

    it('adds EXISTS clause for superadmin when organizationId is provided', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '0' });
      await repo.listUsers({ ...baseParams, organizationId: 'org-2' });
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('EXISTS');
      expect(params).toContain('org-2');
    });

    it('adds EXISTS clause for admin platform role', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '0' });
      await repo.listUsers({
        ...baseParams,
        platformRole: 'admin',
        activeOrganizationId: 'org-1',
      });
      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).toContain('EXISTS');
    });

    it('adds EXISTS clause for manager platform role', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '0' });
      await repo.listUsers({
        ...baseParams,
        platformRole: 'manager',
        activeOrganizationId: 'org-1',
      });
      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).toContain('EXISTS');
    });

    it('uses parameterized $N for LIMIT and OFFSET — no interpolation', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '0' });
      await repo.listUsers({ ...baseParams, limit: 20, offset: 40 });
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(sql).not.toContain('LIMIT 20');
      expect(sql).not.toContain('OFFSET 40');
      expect(sql).toMatch(/LIMIT \$\d+/);
      expect(sql).toMatch(/OFFSET \$\d+/);
      expect(params).toContain(20);
      expect(params).toContain(40);
    });

    it('passes only filter params to COUNT query (not LIMIT/OFFSET)', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '5' });
      await repo.listUsers({
        ...baseParams,
        searchValue: 'test',
        limit: 20,
        offset: 40,
      });
      // query call (with pagination params) should have 3 params: search, limit, offset
      const [, dataParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(dataParams).toHaveLength(3);
      // queryOne call (count without pagination) should only have 1 param: search
      const [, countParams] = mockQueryOne.mock.calls[0] as [string, unknown[]];
      expect(countParams).toHaveLength(1);
    });

    it('aggregates organization memberships with role display metadata in the list query', async () => {
      mockQuery.mockResolvedValue([]);
      mockQueryOne.mockResolvedValue({ count: '0' });

      await repo.listUsers(baseParams);

      const [sql] = mockQuery.mock.calls[0] as [string];
      expect(sql).toContain('COALESCE(');
      expect(sql).toContain('json_agg');
      expect(sql).toContain(`'organizationId', m."organizationId"`);
      expect(sql).toContain(`'organizationName', o.name`);
      expect(sql).toContain(`'roleName', m.role`);
      expect(sql).toContain(
        `'roleDisplayName', COALESCE(r.display_name, m.role)`,
      );
      expect(sql).toContain('JOIN organization o ON o.id = m."organizationId"');
      expect(sql).toContain(
        'LEFT JOIN roles r ON r.organization_id = m."organizationId" AND r.name = m.role',
      );
    });
  });

  // ─── setUserRole ─────────────────────────────────────────────────────────────

  describe('setUserRole', () => {
    it('deletes member row when new role is admin', async () => {
      mockQuery
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue({ id: 'u-1', role: 'admin' });
      await repo.setUserRole({
        userId: 'u-1',
        role: 'admin',
        organizationId: null,
        newMemberId: 'm-1',
      });
      const deleteSql = mockQuery.mock.calls[1][0] as string;
      expect(deleteSql).toContain('DELETE FROM member');
    });

    it('throws ForbiddenException when non-admin role has no orgId', async () => {
      mockQuery.mockResolvedValueOnce(undefined);
      await expect(
        repo.setUserRole({
          userId: 'u-1',
          role: 'member',
          organizationId: null,
          newMemberId: 'm-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates existing member when membership already exists', async () => {
      mockQuery
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ id: 'mem-1' }])
        .mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue({ id: 'u-1', role: 'member' });
      await repo.setUserRole({
        userId: 'u-1',
        role: 'member',
        organizationId: 'org-1',
        newMemberId: 'm-new',
      });
      const updateSql = mockQuery.mock.calls[2][0] as string;
      expect(updateSql).toContain('UPDATE member');
    });

    it('inserts new member when no existing membership', async () => {
      mockQuery
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue({ id: 'u-1', role: 'member' });
      await repo.setUserRole({
        userId: 'u-1',
        role: 'member',
        organizationId: 'org-1',
        newMemberId: 'm-new',
      });
      const insertSql = mockQuery.mock.calls[2][0] as string;
      expect(insertSql).toContain('INSERT INTO member');
    });
  });

  // ─── createUser ──────────────────────────────────────────────────────────────

  describe('createUser', () => {
    const baseParams = {
      userId: 'u-1',
      accountId: 'acc-1',
      name: 'Alice',
      email: 'alice@example.com',
      hashedPassword: 'hashed',
      role: 'member' as const,
      organizationId: null,
    };

    it('throws ForbiddenException when email already exists', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'existing' }]);
      await expect(repo.createUser(baseParams)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('creates user and account without org insert when organizationId is null', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue({ id: 'u-1' });
      await repo.createUser(baseParams);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('inserts member row when organizationId is provided', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue({ id: 'u-1' });
      await repo.createUser({ ...baseParams, organizationId: 'org-1' });
      expect(mockQuery).toHaveBeenCalledTimes(4);
      const memberSql = mockQuery.mock.calls[3][0] as string;
      expect(memberSql).toContain('INSERT INTO member');
    });

    it('throws a clear error when findUserById returns null after transaction', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue(null);
      await expect(repo.createUser(baseParams)).rejects.toThrow(
        'Failed to create user: user not found after transaction',
      );
    });
  });

  // ─── sessions ────────────────────────────────────────────────────────────────

  describe('findSessionByToken', () => {
    it('returns userId row', async () => {
      mockQueryOne.mockResolvedValue({ userId: 'u-1' });
      expect(await repo.findSessionByToken('tok')).toEqual({ userId: 'u-1' });
    });
  });

  describe('revokeSession', () => {
    it('deletes session by token', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.revokeSession('tok');
      expect(mockQuery.mock.calls[0][1]).toEqual(['tok']);
    });
  });

  describe('revokeAllSessions', () => {
    it('deletes all sessions for user', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.revokeAllSessions('u-1');
      expect(mockQuery.mock.calls[0][1]).toEqual(['u-1']);
    });
  });

  describe('listUserSessions', () => {
    it('returns session rows', async () => {
      const rows = [{ id: 's-1', userId: 'u-1' }];
      mockQuery.mockResolvedValue(rows);
      expect(await repo.listUserSessions('u-1')).toEqual(rows);
    });
  });

  // ─── listRoles / listOrganizations / findOrganizationById ────────────────────

  describe('listRoles', () => {
    it('returns role rows', async () => {
      const rows = [{ name: 'admin', display_name: 'Admin', is_default: true }];
      mockQuery.mockResolvedValue(rows);
      expect(await repo.listRoles()).toEqual(rows);
    });
  });

  describe('listOrganizations', () => {
    it('returns org rows', async () => {
      const rows = [{ id: 'org-1', name: 'Acme', slug: 'acme' }];
      mockQuery.mockResolvedValue(rows);
      expect(await repo.listOrganizations()).toEqual(rows);
    });
  });

  describe('findOrganizationById', () => {
    it('returns org row when found', async () => {
      mockQueryOne.mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
      });
      expect(await repo.findOrganizationById('org-1')).toEqual({
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
      });
    });

    it('returns null when not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findOrganizationById('nope')).toBeNull();
    });
  });
});
