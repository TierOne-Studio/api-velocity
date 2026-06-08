import { NotImplementedException } from '@nestjs/common';
import { AirweaveCollectionProvider } from './airweave-collection.provider';
import { DatabaseSourceProvider } from './database.provider';
import { ExternalSourceProvider } from './external.provider';
import { VectorDbDataSourceProvider } from './vector-db-data-source.provider';
import { DataSourceRegistry } from './data-source.registry';

describe('DataSourceRegistry', () => {
  let registry: DataSourceRegistry;

  beforeEach(() => {
    const airweave = new AirweaveCollectionProvider({} as never);
    const database = new DatabaseSourceProvider(
      {} as never,
      {} as never,
      {} as never,
    );
    const external = new ExternalSourceProvider();
    const vectorDb = new VectorDbDataSourceProvider({} as never);

    registry = new DataSourceRegistry(airweave, database, external, vectorDb);
  });

  it('returns registered provider by kind', () => {
    expect(registry.get('airweave_collection').kind).toBe(
      'airweave_collection',
    );
    expect(registry.get('database').kind).toBe('database');
    expect(registry.get('external').kind).toBe('external');
  });

  it('resolves the vector_db provider (no longer NotImplemented)', () => {
    expect(registry.get('vector_db').kind).toBe('vector_db');
  });

  it('throws NotImplementedException for an unknown kind', () => {
    expect(() => registry.get('unknown' as never)).toThrow(
      NotImplementedException,
    );
  });

  it('lists the supported kinds', () => {
    expect(registry.kinds().sort()).toEqual(
      ['airweave_collection', 'database', 'external', 'vector_db'].sort(),
    );
  });
});
