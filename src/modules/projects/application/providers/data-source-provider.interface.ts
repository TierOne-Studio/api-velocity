import type {
  AirweaveSearchResponse,
  AirweaveSearchRetrievalStrategy,
  AirweaveSearchTier,
} from '../../../airweave/application/services/airweave.service';
import type {
  DataSourceKind,
  ProjectDataSource,
} from '../../api/dto/project.dto';

export type DataSourceSearchOptions = {
  tier?: AirweaveSearchTier;
  retrievalStrategy?: AirweaveSearchRetrievalStrategy;
  limit?: number;
  offset?: number;
};

export interface DataSourceProvider {
  readonly kind: DataSourceKind;
  search(
    source: ProjectDataSource,
    query: string,
    options?: DataSourceSearchOptions,
  ): Promise<AirweaveSearchResponse>;
}

export const DATA_SOURCE_PROVIDERS = 'DATA_SOURCE_PROVIDERS';
