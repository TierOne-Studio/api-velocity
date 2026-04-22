import { Injectable, NotImplementedException } from '@nestjs/common';
import { tool, type StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ConfigService } from '../../../../shared/config';
import type { AirweaveSearchResponse } from '../../../airweave/application/services/airweave.service';
import { SqlConnectionsService } from '../../../sql-connections/application/services/sql-connections.service';
import type { ProjectDataSource } from '../../api/dto/project.dto';
import type {
  AgentToolContext,
  DataSourceProvider,
} from './data-source-provider.interface';
import { ChatToSqlService } from './database/chat-to-sql.service';
import { createQueryDatabaseTool } from './database/query-database-tool';
import type { ResolvedSqlConnection } from './database/types';

type DatabaseSource = Extract<ProjectDataSource, { kind: 'database' }>;

@Injectable()
export class DatabaseSourceProvider implements DataSourceProvider {
  readonly kind = 'database' as const;

  constructor(
    private readonly sqlConnections: SqlConnectionsService,
    private readonly chatToSql: ChatToSqlService,
    private readonly configService: ConfigService,
  ) {}

  async search(
    _source: ProjectDataSource,
    _query: string,
  ): Promise<AirweaveSearchResponse> {
    throw new NotImplementedException(
      'Database sources do not participate in semantic search; they expose a query_database agent tool instead.',
    );
  }

  getAgentTools(
    sources: ProjectDataSource[],
    ctx: AgentToolContext,
  ): StructuredTool[] {
    const databaseSources = sources.filter(
      (s): s is DatabaseSource => s.kind === 'database',
    );
    if (databaseSources.length === 0) return [];
    if (!ctx.orgId) return [];

    const factory = this.chatToSql.createFactory();
    ctx.cleanupCallbacks.push(() => factory.destroyAll());

    const description = this.configService.getQueryDatabaseToolDescription(
      databaseSources.map((s) => ({
        id: s.id,
        name: s.config.connectionName || s.name,
      })),
    );

    const schema = z.object({
      question: z.string().min(1),
      source_id: z.string().optional(),
    });

    let resolvedPromise: Promise<ResolvedSqlConnection[]> | null = null;
    const ensureResolved = (): Promise<ResolvedSqlConnection[]> => {
      if (!resolvedPromise) {
        resolvedPromise = this.resolveConnections(databaseSources, ctx.orgId!);
      }
      return resolvedPromise;
    };

    const wrapper = tool(
      async (input: { question: string; source_id?: string }) => {
        const resolved = await ensureResolved();
        if (resolved.length === 0) {
          return JSON.stringify({
            error: 'connection_not_ready',
            message:
              'No attached database connection is currently available to query.',
          });
        }
        const delegate = createQueryDatabaseTool({
          connections: resolved,
          chatToSql: this.chatToSql,
          factory,
          ctx,
          description,
        });
        return delegate.invoke(input);
      },
      {
        name: 'query_database',
        description,
        schema,
      },
    ) as unknown as StructuredTool;

    return [wrapper];
  }

  private async resolveConnections(
    sources: DatabaseSource[],
    orgId: string,
  ): Promise<ResolvedSqlConnection[]> {
    const ids = Array.from(
      new Set(sources.map((s) => s.config.connectionId)),
    );
    const rows = await this.sqlConnections.resolveForAgent(orgId, ids);
    const rowById = new Map(rows.map((row) => [row.id, row] as const));
    const out: ResolvedSqlConnection[] = [];
    for (const source of sources) {
      const row = rowById.get(source.config.connectionId);
      if (!row || row.status !== 'ready') continue;
      out.push({
        id: row.id,
        name: source.config.connectionName || row.name,
        host: row.host,
        port: row.port,
        database: row.database,
        username: row.username,
        password: row.password,
        ssl: row.ssl,
        schemaName: row.schemaName,
      });
    }
    return out;
  }
}
