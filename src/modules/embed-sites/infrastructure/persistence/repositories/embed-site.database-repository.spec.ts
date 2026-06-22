import { describe, expect, it, jest } from '@jest/globals';
import type { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import { EmbedSiteDatabaseRepository } from './embed-site.database-repository';

describe('EmbedSiteDatabaseRepository (unit)', () => {
  it('throws an actionable error if the usage-counter upsert returns no row', async () => {
    // Impossible-by-contract for an upsert, but the code guards it explicitly
    // (fail-fast). Assert the failure path surfaces a contextual error.
    const db = {
      queryOne: jest.fn(async () => null),
    } as unknown as DatabaseService;
    const repo = new EmbedSiteDatabaseRepository(db);

    await expect(repo.incrementMonthlyUsage('org-1')).rejects.toThrow(
      /usage-counter upsert returned no row/,
    );
  });

  it('returns the post-increment count from the upsert', async () => {
    const db = {
      queryOne: jest.fn(async () => ({ request_count: '7' })),
    } as unknown as DatabaseService;
    const repo = new EmbedSiteDatabaseRepository(db);

    await expect(repo.incrementMonthlyUsage('org-1')).resolves.toBe(7);
  });

  it('returns null from findByPublicKey when no row matches', async () => {
    const db = {
      queryOne: jest.fn(async () => null),
    } as unknown as DatabaseService;
    const repo = new EmbedSiteDatabaseRepository(db);

    await expect(repo.findByPublicKey('wgt_pub_x')).resolves.toBeNull();
  });
});
