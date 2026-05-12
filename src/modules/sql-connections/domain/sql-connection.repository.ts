import type {
  SqlConnectionRow,
  SqlConnectionStatus,
} from '../api/dto/sql-connection.dto';

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
}
