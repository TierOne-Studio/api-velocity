import { Injectable, NotImplementedException } from '@nestjs/common';
import type { StructuredTool } from '@langchain/core/tools';
import { AirweaveCollectionProvider } from './airweave-collection.provider';
import { DatabaseSourceProvider } from './database.provider';
import { ExternalSourceProvider } from './external.provider';
import { VectorDbDataSourceProvider } from './vector-db-data-source.provider';
import type {
  DataSourceKind,
  ProjectDataSource,
} from '../../api/dto/project.dto';
import type {
  AgentToolContext,
  DataSourceProvider,
} from './data-source-provider.interface';

@Injectable()
export class DataSourceRegistry {
  private readonly providers = new Map<DataSourceKind, DataSourceProvider>();

  constructor(
    airweave: AirweaveCollectionProvider,
    database: DatabaseSourceProvider,
    external: ExternalSourceProvider,
    vectorDb: VectorDbDataSourceProvider,
  ) {
    this.providers.set(airweave.kind, airweave);
    this.providers.set(database.kind, database);
    this.providers.set(external.kind, external);
    this.providers.set(vectorDb.kind, vectorDb);
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

  /**
   * Groups sources by kind and asks each provider for its agent tools.
   * Providers that don't implement getAgentTools contribute nothing. Kinds
   * with zero sources are skipped — no tool is created that has no inputs.
   */
  getAgentToolsFor(
    sources: ProjectDataSource[],
    ctx: AgentToolContext,
  ): StructuredTool[] {
    const byKind = new Map<DataSourceKind, ProjectDataSource[]>();
    for (const source of sources) {
      const list = byKind.get(source.kind) ?? [];
      list.push(source);
      byKind.set(source.kind, list);
    }

    const tools: StructuredTool[] = [];
    for (const [kind, grouped] of byKind) {
      const provider = this.providers.get(kind);
      if (!provider?.getAgentTools) continue;
      tools.push(...provider.getAgentTools(grouped, ctx));
    }
    return tools;
  }
}
