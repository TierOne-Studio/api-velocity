import { Injectable, NotImplementedException } from '@nestjs/common';
import type { AirweaveSearchResponse } from '../../../airweave/application/services/airweave.service';
import type { ProjectDataSource } from '../../api/dto/project.dto';
import type { DataSourceProvider } from './data-source-provider.interface';

@Injectable()
export class DatabaseSourceProvider implements DataSourceProvider {
  readonly kind = 'database' as const;

  async search(
    _source: ProjectDataSource,
    _query: string,
  ): Promise<AirweaveSearchResponse> {
    throw new NotImplementedException(
      'Database data sources are not yet supported',
    );
  }
}
