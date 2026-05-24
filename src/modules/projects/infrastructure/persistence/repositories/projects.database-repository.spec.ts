import { jest } from '@jest/globals';
import { ProjectsDatabaseRepository } from './projects.database-repository';

const mockQuery = jest.fn<any>();
const mockQueryOne = jest.fn<any>();
const mockTransaction = jest.fn<any>();

const mockDb = {
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
};

describe('ProjectsDatabaseRepository', () => {
  let repo: ProjectsDatabaseRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new ProjectsDatabaseRepository(mockDb as any);
  });

  // ── findProjectsReferencingAirweaveCollection (Security H1 fix) ───────
  // The 409-on-delete response body surfaces project { id, name } rows to
  // the caller, so cross-org rows would be an information leak even though
  // the route already gates by ownership (defense-in-depth per
  // repo-conventions §3). The SQL MUST filter on both the collection
  // readable id AND p.organization_id.
  describe('findProjectsReferencingAirweaveCollection', () => {
    it('issues a SQL query scoped by both collection readable id AND organization id', async () => {
      mockQuery.mockResolvedValue([
        { id: 'proj-1', name: 'General' },
        { id: 'proj-2', name: 'Analytics' },
      ]);

      const result = await repo.findProjectsReferencingAirweaveCollection(
        'acme-foo-deadbeef',
        'org-1',
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

      // Joins project_data_source via project_id (cardinality safe).
      expect(sql).toContain('FROM project p');
      expect(sql).toContain('JOIN project_data_source pds');
      expect(sql).toContain('pds.project_id = p.id');

      // Filter predicates — both load-bearing for the security gate.
      expect(sql).toContain("pds.kind = 'airweave_collection'");
      expect(sql).toContain("pds.config->>'collectionReadableId' = $1");
      // *** H1 fix invariant: must scope to caller's org. ***
      expect(sql).toContain('p.organization_id = $2');

      // DISTINCT to avoid duplicate rows when a project has multiple
      // sources pointing at the same collection (defensive).
      expect(sql).toContain('SELECT DISTINCT p.id, p.name');

      // Parameters in the right order.
      expect(params).toEqual(['acme-foo-deadbeef', 'org-1']);

      expect(result).toEqual([
        { id: 'proj-1', name: 'General' },
        { id: 'proj-2', name: 'Analytics' },
      ]);
    });

    it('returns an empty array when no projects reference the collection in this org', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await repo.findProjectsReferencingAirweaveCollection(
        'orphan-id',
        'org-with-no-refs',
      );

      expect(result).toEqual([]);
    });
  });
});
