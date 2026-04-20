import { Injectable, NotImplementedException } from '@nestjs/common';
import { AirweaveCollectionProvider } from './airweave-collection.provider';
import { DatabaseSourceProvider } from './database.provider';
import { ExternalSourceProvider } from './external.provider';
import type { DataSourceKind } from '../../api/dto/project.dto';
import type { DataSourceProvider } from './data-source-provider.interface';

@Injectable()
export class DataSourceRegistry {
  private readonly providers = new Map<DataSourceKind, DataSourceProvider>();

  constructor(
    airweave: AirweaveCollectionProvider,
    database: DatabaseSourceProvider,
    external: ExternalSourceProvider,
  ) {
    this.providers.set(airweave.kind, airweave);
    this.providers.set(database.kind, database);
    this.providers.set(external.kind, external);
  }

  get(kind: DataSourceKind): DataSourceProvider {
    const provider = this.providers.get(kind);
    if (!provider) {
      throw new NotImplementedException(
        `No provider registered for data source kind "${kind}"`,
      );
    }
    return provider;
  }

  kinds(): DataSourceKind[] {
    return Array.from(this.providers.keys());
  }
}
