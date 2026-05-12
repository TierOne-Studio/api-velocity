import type { SqlConnectionRow } from '../api/dto/sql-connection.dto';

/**
 * M4: SqlConnectionStatus belongs to the domain — the repository port (this
 * file) references it on the `updateStatus` method, and the lifecycle it
 * encodes is part of the domain contract, not a transport concern. The
 * api/dto layer re-exports this type for backward-compatible imports.
 */
export type SqlConnectionStatus = 'connecting' | 'ready' | 'error';

export const SQL_CONNECTIONS_REPOSITORY = 'SQL_CONNECTIONS_REPOSITORY';

export type CreateSqlConnectionRow = {
  id: string;
  organizationId: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  passwordCiphertext: string;
  passwordIv: string;
  passwordTag: string;
  ssl: unknown;
  schemaName: string;
  /** H1b: optional table allowlist; null = sub-agent sees all tables. */
  allowedTables: string[] | null;
};

export type UpdateSqlConnectionRow = Partial<
  Omit<CreateSqlConnectionRow, 'id' | 'organizationId'>
>;

export interface ISqlConnectionsRepository {
  create(row: CreateSqlConnectionRow): Promise<SqlConnectionRow>;
  update(id: string, row: UpdateSqlConnectionRow): Promise<SqlConnectionRow>;
  updateStatus(
    id: string,
    status: SqlConnectionStatus,
    statusError: string | null,
  ): Promise<void>;
  findById(id: string): Promise<SqlConnectionRow | null>;
  findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<SqlConnectionRow | null>;
  findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<SqlConnectionRow[]>;
  listForOrganization(organizationId: string): Promise<SqlConnectionRow[]>;
  findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<SqlConnectionRow | null>;
  delete(id: string, organizationId: string): Promise<boolean>;
  /**
   * M6: returns the number of project_data_source rows that reference this
   * connection (kind='database', config->>'connectionId' = id). Used by
   * the service's delete path to refuse-with-context when a project would
   * be orphaned by the deletion.
   *
   * Cross-module schema read: pragmatically lives here rather than in a
   * projects-side port + DI injection (heavier for one query). If the
   * projects module grows a public "list-references-by-connection" method,
   * this can delegate there.
   */
  countProjectReferences(connectionId: string): Promise<number>;
}
