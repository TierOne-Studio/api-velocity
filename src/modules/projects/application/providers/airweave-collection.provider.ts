import { Injectable } from '@nestjs/common';
import { AirweaveService } from '../../../airweave/application/services/airweave.service';
import type {
  AirweaveSearchResponse,
  AirweaveSearchTier,
} from '../../../airweave/application/services/airweave.service';
import type { ProjectDataSource } from '../../api/dto/project.dto';
import type {
  DataSourceProvider,
  DataSourceSearchOptions,
} from './data-source-provider.interface';

@Injectable()
export class AirweaveCollectionProvider implements DataSourceProvider {
  readonly kind = 'airweave_collection' as const;

  constructor(private readonly airweaveService: AirweaveService) {}

  async search(
    source: ProjectDataSource,
    query: string,
    options: DataSourceSearchOptions = {},
  ): Promise<AirweaveSearchResponse> {
    if (source.kind !== 'airweave_collection') {
      throw new Error(
        `AirweaveCollectionProvider cannot handle source kind "${source.kind}"`,
      );
    }

    const tier: AirweaveSearchTier = options.tier ?? 'instant';

    return this.airweaveService.searchCollection(
      source.config.collectionReadableId,
      {
        query,
        tier,
        retrievalStrategy: options.retrievalStrategy,
        limit: options.limit,
        offset: options.offset,
      },
    );
  }
}
