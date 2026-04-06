import { jest } from '@jest/globals';
import { SessionDatabaseRepository } from './session.database-repository';

const mockQuery = jest.fn<any>();
const mockQueryOne = jest.fn<any>();

const mockDb = { query: mockQuery, queryOne: mockQueryOne };

describe('SessionDatabaseRepository', () => {
  let repo: SessionDatabaseRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new SessionDatabaseRepository(mockDb as any);
  });

  describe('findSessionByToken', () => {
    it('returns userId row when token matches', async () => {
      mockQueryOne.mockResolvedValue({ userId: 'u-1' });
      expect(await repo.findSessionByToken('tok')).toEqual({ userId: 'u-1' });
    });

    it('returns null when token not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findSessionByToken('nope')).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('deletes the session by token', async () => {
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
    it('returns session rows for user', async () => {
      const rows = [{ id: 's-1', userId: 'u-1' }];
      mockQuery.mockResolvedValue(rows);
      expect(await repo.listUserSessions('u-1')).toEqual(rows);
    });
  });

  describe('findMemberInOrg', () => {
    it('returns id when member exists', async () => {
      mockQueryOne.mockResolvedValue({ id: 'mem-1' });
      expect(await repo.findMemberInOrg('u-1', 'org-1')).toEqual({
        id: 'mem-1',
      });
    });

    it('returns null when member not found', async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await repo.findMemberInOrg('ghost', 'org-1')).toBeNull();
    });
  });
});
