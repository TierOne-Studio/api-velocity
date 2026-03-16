import { jest } from '@jest/globals';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { AdminOrgDatabaseRepository } from './admin-org.database-repository';

const mockQuery = jest.fn<any>();
const mockQueryOne = jest.fn<any>();
const mockTransaction = jest.fn<any>();

const mockDb = {
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
};

describe('AdminOrgDatabaseRepository', () => {
  let repo: AdminOrgDatabaseRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AdminOrgDatabaseRepository(mockDb as any);
    mockTransaction.mockImplementation(async (fn: (q: typeof mockQuery) => Promise<void>) => {
      await fn(mockQuery);
    });
  });

  // ─── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('builds query without WHERE when search is omitted', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.findAll();
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('WHERE');
      expect(mockQuery.mock.calls[0][1]).toEqual([20, 0]);
    });

    it('adds ILIKE WHERE clause when search is provided', async () => {
      mockQuery.mockResolvedValue([]);
      await repo.findAll('acme', 10, 5);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('WHERE');
      expect(params).toEqual(['%acme%', 10, 5]);
    });
  });

  // ─── countAll ───────────────────────────────────────────────────────────────

  describe('countAll', () => {
    it('returns 0 when queryOne returns null', async () => {
      mockQueryOne.mockResolvedValue(null);
      const count = await repo.countAll();
      expect(count).toBe(0);
    });

    it('parses count string from result', async () => {
      mockQueryOne.mockResolvedValue({ count: '42' });
      expect(await repo.countAll()).toBe(42);
    });

    it('adds WHERE clause when search is provided', async () => {
      mockQueryOne.mockResolvedValue({ count: '3' });
      await repo.countAll('test');
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('WHERE');
      expect(params).toEqual(['%test%']);
    });
  });

  // ─── findById / findBasicById / findBySlug ──────────────────────────────────

  describe('findById', () => {
    it('delegates to queryOne with org id', async () => {
      mockQueryOne.mockResolvedValue({ id: 'org-1' });
      const result = await repo.findById('org-1');
      expect(result).toEqual({ id: 'org-1' });
      expect(mockQueryOne.mock.calls[0][1]).toEqual(['org-1']);
    });
  });

  describe('findBasicById', () => {
    it('returns null when org not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findBasicById('nope')).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('returns id row when slug matches', async () => {
      mockQueryOne.mockResolvedValue({ id: 'org-2' });
      expect(await repo.findBySlug('my-org')).toEqual({ id: 'org-2' });
    });
  });

  // ─── createOrg ──────────────────────────────────────────────────────────────

  describe('createOrg', () => {
    const params = {
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      logo: null,
      metadataJson: null,
      actorId: 'user-1',
      actorRole: 'admin' as const,
      memberId: 'mem-1',
    };

    it('throws ConflictException when INSERT hits a unique constraint violation (23505)', async () => {
      const pgUniqueError = Object.assign(new Error('duplicate key'), { code: '23505' });
      mockQuery.mockRejectedValueOnce(pgUniqueError);
      await expect(repo.createOrg(params)).rejects.toThrow(ConflictException);
    });

    it('rethrows unrelated DB errors without wrapping', async () => {
      const dbError = Object.assign(new Error('connection lost'), { code: '08006' });
      mockQuery.mockRejectedValueOnce(dbError);
      await expect(repo.createOrg(params)).rejects.toThrow('connection lost');
    });

    it('inserts org, member, default roles, and role permissions without a prior SELECT when slug is free', async () => {
      mockQuery.mockResolvedValue(undefined);
      await expect(repo.createOrg(params)).resolves.toBeUndefined();
      expect(mockQuery).toHaveBeenCalledTimes(6);
      const [firstSql] = mockQuery.mock.calls[0] as [string];
      expect(firstSql).toContain('INSERT INTO organization');
      expect(mockQuery.mock.calls[2][0]).toContain('INSERT INTO roles');
      expect(mockQuery.mock.calls[3][0]).toContain('INSERT INTO role_permissions');
      expect(mockQuery.mock.calls[4][0]).toContain('INSERT INTO role_permissions');
      expect(mockQuery.mock.calls[5][0]).toContain('INSERT INTO role_permissions');
      expect(mockQuery.mock.calls[4][1]).toEqual([
        'org-1',
        'organization',
        'read',
        'organization',
        'update',
        'organization',
        'invite',
        'role',
        'read',
        'session',
        'read',
        'session',
        'revoke',
        'user',
        'create',
        'user',
        'read',
        'user',
        'update',
      ]);
      expect(mockQuery.mock.calls[5][1]).toEqual(['org-1', 'organization', 'read']);
    });
  });

  // ─── updateOrg ──────────────────────────────────────────────────────────────

  describe('updateOrg', () => {
    it('returns null when no fields are provided', async () => {
      expect(await repo.updateOrg('org-1', {})).toBeNull();
      expect(mockQueryOne).not.toHaveBeenCalled();
    });

    it('updates name only', async () => {
      const updated = { id: 'org-1', name: 'New Name' };
      mockQueryOne.mockResolvedValue(updated);
      const result = await repo.updateOrg('org-1', { name: 'New Name' });
      expect(result).toEqual(updated);
      const [sql] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('name =');
    });

    it('updates slug only', async () => {
      mockQueryOne.mockResolvedValue({ id: 'org-1' });
      await repo.updateOrg('org-1', { slug: 'new-slug' });
      const [sql] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('slug =');
    });

    it('updates logo and metadataJson together', async () => {
      mockQueryOne.mockResolvedValue({ id: 'org-1' });
      await repo.updateOrg('org-1', { logo: 'url', metadataJson: '{}' });
      const [sql] = mockQueryOne.mock.calls[0];
      expect(sql).toContain('logo =');
      expect(sql).toContain('metadata =');
    });
  });

  // ─── deleteOrg ──────────────────────────────────────────────────────────────

  describe('deleteOrg', () => {
    it('deletes invitations, members, and org in a transaction', async () => {
      mockQuery.mockResolvedValue(undefined);
      await repo.deleteOrg('org-1');
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });
  });

  // ─── members ────────────────────────────────────────────────────────────────

  describe('getMembers', () => {
    it('returns member rows for org', async () => {
      const rows = [{ id: 'mem-1', userId: 'u-1', role: 'admin' }];
      mockQuery.mockResolvedValue(rows);
      expect(await repo.getMembers('org-1')).toEqual(rows);
    });
  });

  describe('findMemberById', () => {
    it('returns null when member not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findMemberById('mem-x', 'org-1')).toBeNull();
    });
  });

  describe('findMemberByUserId', () => {
    it('returns id row when found', async () => {
      mockQueryOne.mockResolvedValue({ id: 'mem-1' });
      expect(await repo.findMemberByUserId('user-1', 'org-1')).toEqual({ id: 'mem-1' });
    });
  });

  describe('findMemberByEmail', () => {
    it('returns null when email not in org', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findMemberByEmail('org-1', 'a@b.com')).toBeNull();
    });
  });

  describe('countAdmins', () => {
    it('returns 0 when queryOne returns null', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.countAdmins('org-1')).toBe(0);
    });

    it('parses count string', async () => {
      mockQueryOne.mockResolvedValue({ count: '5' });
      expect(await repo.countAdmins('org-1')).toBe(5);
    });
  });

  describe('addMember', () => {
    it('inserts and returns the new member row', async () => {
      const member = { id: 'mem-2', organizationId: 'org-1', userId: 'u-2', role: 'member' };
      mockQuery.mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue(member);
      const result = await repo.addMember('mem-2', 'org-1', 'u-2', 'member');
      expect(result).toEqual(member);
    });

    it('throws InternalServerErrorException when SELECT after INSERT returns null', async () => {
      mockQuery.mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValue(null);
      await expect(repo.addMember('mem-x', 'org-1', 'u-1', 'member')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('updateMemberRole', () => {
    it('updates and returns the member row', async () => {
      const updated = { id: 'mem-1', role: 'manager' };
      mockQuery.mockResolvedValue(undefined);
      mockQueryOne.mockResolvedValue(updated);
      expect(await repo.updateMemberRole('mem-1', 'org-1', 'manager')).toEqual(updated);
    });
  });

  describe('removeMember', () => {
    it('returns true when a row was deleted', async () => {
      mockQuery.mockResolvedValue([{ id: 'mem-1' }]);
      expect(await repo.removeMember('mem-1', 'org-1')).toBe(true);
    });

    it('returns false when nothing was deleted', async () => {
      mockQuery.mockResolvedValue([]);
      expect(await repo.removeMember('nope', 'org-1')).toBe(false);
    });
  });

  // ─── invitations ────────────────────────────────────────────────────────────

  describe('findUserById', () => {
    it('returns null when user not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findUserById('ghost')).toBeNull();
    });
  });

  describe('listMemberCandidates', () => {
    it('queries users not already in the target organization', async () => {
      mockQuery.mockResolvedValue([{ id: 'u-2', email: 'candidate@example.com' }]);

      const result = await (repo as any).listMemberCandidates('org-1', { limit: 25 });

      expect(result).toEqual([{ id: 'u-2', email: 'candidate@example.com' }]);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('FROM "user" u');
      expect(sql).toContain('NOT EXISTS');
      expect(sql).toContain('member m');
      expect(params).toEqual(['org-1', 25]);
    });

    it('adds search filtering when provided', async () => {
      mockQuery.mockResolvedValue([]);

      await (repo as any).listMemberCandidates('org-1', { search: 'alice', limit: 10 });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('ILIKE');
      expect(params).toEqual(['org-1', '%alice%', 10]);
    });
  });

  describe('findPendingInvitation', () => {
    it('returns id row for matching pending invitation', async () => {
      mockQueryOne.mockResolvedValue({ id: 'inv-1' });
      expect(await repo.findPendingInvitation('org-1', 'a@b.com')).toEqual({ id: 'inv-1' });
    });
  });

  describe('findInvitationById', () => {
    it('returns null when invitation not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findInvitationById('inv-x')).toBeNull();
    });
  });

  describe('createInvitation', () => {
    it('inserts and returns the invitation row', async () => {
      const inv = {
        id: 'inv-1',
        organizationId: 'org-1',
        email: 'a@b.com',
        role: 'member',
        status: 'pending',
        expiresAt: new Date(),
        inviterId: 'u-1',
        createdAt: new Date(),
      };
      mockQuery.mockResolvedValue(undefined);
      mockQueryOne.mockResolvedValue(inv);
      const result = await repo.createInvitation('inv-1', 'org-1', 'a@b.com', 'member', inv.expiresAt, 'u-1');
      expect(result).toEqual(inv);
    });
  });

  describe('getInvitations', () => {
    it('returns invitation rows for org', async () => {
      const rows = [{ id: 'inv-1', email: 'a@b.com' }];
      mockQuery.mockResolvedValue(rows);
      expect(await repo.getInvitations('org-1')).toEqual(rows);
    });
  });

  describe('deleteInvitation', () => {
    it('returns true when invitation was deleted', async () => {
      mockQuery.mockResolvedValue([{ id: 'inv-1' }]);
      expect(await repo.deleteInvitation('inv-1', 'org-1')).toBe(true);
    });

    it('returns false when invitation not found', async () => {
      mockQuery.mockResolvedValue([]);
      expect(await repo.deleteInvitation('nope', 'org-1')).toBe(false);
    });
  });

  // ─── getRoles ───────────────────────────────────────────────────────────────

  describe('getRoles', () => {
    it('returns all role rows', async () => {
      const roles = [{ name: 'admin', display_name: 'Admin', is_system: true }];
      mockQuery.mockResolvedValue(roles);
      expect(await repo.getRoles()).toEqual(roles);
    });
  });
});
