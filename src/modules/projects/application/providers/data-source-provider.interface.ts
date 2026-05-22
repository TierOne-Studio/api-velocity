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
    }
  | {
      // Phase 3b (R / §3.6): fires from ChatToSqlService before the
      // sub-agent starts running. Surfaces "I am about to think about
      // your SQL question" to the SPA during the otherwise-silent
      // sub-agent latency window. Drained at the next outer-loop message
      // boundary — typically immediately before sql_executed.
      type: 'sql_planning';
      connectionId: string;
      connectionName: string;
    }
  | {
      // Phase 3b (R / §3.6): fires from inside runSqlSubAgent — wrapped
      // around the query-sql tool's invoke — right BEFORE db.run() is
      // called. Carries the actual SQL string so the SPA can show
      // "Running: SELECT ..." progress chrome before the query returns.
      type: 'sql_executing';
      connectionId: string;
      connectionName: string;
      sql: string;
    };

/**
 * Phase 3b (R / §3.6) — synchronous progress callback that
 * `runSqlSubAgent` and `ChatToSqlService.askConnection` fire to push
 * progress events into `ctx.eventSink` mid-execution. The streaming
 * loop in `ChatAgentService` drains the sink at the next outer-loop
 * message boundary (typically the tool message immediately preceding
 * `sql_executed`).
 *
 * Optional everywhere — callers that don't care for the progress
 * surface (existing chat-to-sql callers, non-streaming paths) pass
 * undefined and pay no overhead.
 */
export type SqlProgressCallback = (event: AgentToolEvent) => void;

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
