import type { StructuredTool } from '@langchain/core/tools';
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

export type AgentToolEvent =
  | {
      type: 'sql_executed';
      connectionId: string;
      connectionName: string;
      sql: string;
      rowCount: number;
      rows: unknown[];
      truncated: boolean;
      durationMs: number;
    };

export type AgentToolPersistedCall = {
  connectionId: string;
  connectionName: string;
  sql: string;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
};

export type AgentToolContext = {
  orgId: string | null;
  userId: string;
  conversationId: string | null;
  projectId: string;
  signal: AbortSignal;
  /** Mutated synchronously by tool factories. Chat-agent streaming drains after each agent chunk. */
  eventSink: AgentToolEvent[];
  /** Mutated synchronously by tool factories. Persisted to message metadata at end of turn. */
  persistedCalls: AgentToolPersistedCall[];
  /**
   * Cleanup callbacks a provider can push when `getAgentTools` allocates
   * per-request resources (connection pools, stream handles, etc.). The
   * chat-agent service runs all callbacks in a `finally` after the outer
   * agent returns. Failures are logged and swallowed.
   */
  cleanupCallbacks: Array<() => Promise<void>>;
};

export interface DataSourceProvider {
  readonly kind: DataSourceKind;
  search(
    source: ProjectDataSource,
    query: string,
    options?: DataSourceSearchOptions,
  ): Promise<AirweaveSearchResponse>;
  /**
   * Optional. Returns zero or more LangChain tools the chat agent should expose
   * for the given subset of sources in this kind. Providers that do not
   * contribute tools omit this method.
   */
  getAgentTools?(
    sources: ProjectDataSource[],
    ctx: AgentToolContext,
  ): StructuredTool[];
}

export const DATA_SOURCE_PROVIDERS = 'DATA_SOURCE_PROVIDERS';
