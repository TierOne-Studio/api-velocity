import { buildTypeOrmConfig } from './typeorm.config';

describe('buildTypeOrmConfig', () => {
  it('returns valid DataSourceOptions with given url', () => {
    const config = buildTypeOrmConfig('postgres://localhost:5432/test');
    expect(config.type).toBe('postgres');
    expect((config as any).url).toBe('postgres://localhost:5432/test');
    expect(config.synchronize).toBe(false);
    expect(config.logging).toBe(false);
  });

  it('includes the expected entity classes', () => {
    const config = buildTypeOrmConfig('postgres://localhost/db') as {
      entities: unknown[];
    };
    expect(Array.isArray(config.entities)).toBe(true);
    expect(config.entities.length).toBeGreaterThan(0);
  });

  it('sets migrations to an empty array', () => {
    const config = buildTypeOrmConfig('postgres://localhost/db') as {
      migrations: unknown[];
    };
    expect(config.migrations).toEqual([]);
  });
});
