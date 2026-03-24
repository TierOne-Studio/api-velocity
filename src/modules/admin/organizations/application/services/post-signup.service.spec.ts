import { jest } from '@jest/globals';
import { PostSignupService } from './post-signup.service';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';

describe('PostSignupService', () => {
  let service: PostSignupService;
  let db: { queryOne: ReturnType<typeof jest.fn>; query: ReturnType<typeof jest.fn> };

  beforeEach(() => {
    db = {
      queryOne: jest.fn(),
      query: jest.fn(),
    };
    service = new PostSignupService(db as unknown as DatabaseService);
  });

  afterEach(() => {
    delete process.env.DEFAULT_ORGANIZATION_SLUG;
  });

  it("falls back to slug 'default' when DEFAULT_ORGANIZATION_SLUG is not set", async () => {
    db.queryOne.mockResolvedValueOnce(null); // org not found — just need it to not throw

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await service.addUserToDefaultOrg('user-1');
    warnSpy.mockRestore();

    expect(db.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM organization WHERE slug'),
      ['default'],
    );
  });

  it('logs a warning and does nothing when the default org is not found', async () => {
    process.env.DEFAULT_ORGANIZATION_SLUG = 'my-org';
    db.queryOne.mockResolvedValueOnce(null);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await service.addUserToDefaultOrg('user-1');
    warnSpy.mockRestore();

    expect(db.query).not.toHaveBeenCalled();
  });

  it('uses WHERE NOT EXISTS to guard against duplicate membership', async () => {
    process.env.DEFAULT_ORGANIZATION_SLUG = 'my-org';
    db.queryOne.mockResolvedValueOnce({ id: 'org-1' }); // org found
    db.query.mockResolvedValueOnce([]);

    await service.addUserToDefaultOrg('user-1');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE NOT EXISTS'),
      expect.arrayContaining([expect.any(String), 'org-1', 'user-1', 'member']),
    );
  });

  it('inserts a member row when user is new to the default org', async () => {
    process.env.DEFAULT_ORGANIZATION_SLUG = 'my-org';
    db.queryOne.mockResolvedValueOnce({ id: 'org-1' }); // org found
    db.query.mockResolvedValueOnce([]);

    await service.addUserToDefaultOrg('user-1');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO member'),
      expect.arrayContaining([expect.any(String), 'org-1', 'user-1', 'member']),
    );
  });
});
