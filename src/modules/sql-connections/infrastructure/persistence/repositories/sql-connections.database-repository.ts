import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../../shared/infrastructure/database/database.module';
import type {
  SqlConnectionRow,
  SqlConnectionStatus,
} from '../../../api/dto/sql-connection.dto';
import type {
  CreateSqlConnectionRow,
  ISqlConnectionsRepository,
  UpdateSqlConnectionRow,
} from '../../../domain/sql-connection.repository';

const SELECT_COLUMNS = `
  id, organization_id, name, host, port, database, username,
  password_ciphertext, password_iv, password_tag,
  ssl, schema_name, allowed_tables, status, status_error, created_at, updated_at
`;

@Injectable()
export class SqlConnectionsDatabaseRepository
  implements ISqlConnectionsRepository
{
  constructor(private readonly db: DatabaseService) {}

  async create(row: CreateSqlConnectionRow): Promise<SqlConnectionRow> {
    const inserted = await this.db.queryOne<SqlConnectionRow>(
      `INSERT INTO org_sql_connection (
         id, organization_id, name, host, port, database, username,
         password_ciphertext, password_iv, password_tag,
         ssl, schema_name, allowed_tables, status, status_error
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, 'connecting', NULL)
       RETURNING ${SELECT_COLUMNS}`,
      [
        row.id,
        row.organizationId,
        row.name,
        row.host,
        row.port,
        row.database,
        row.username,
        row.passwordCiphertext,
        row.passwordIv,
        row.passwordTag,
        JSON.stringify(row.ssl ?? false),
        row.schemaName,
        row.allowedTables === undefined || row.allowedTables === null
          ? null
          : JSON.stringify(row.allowedTables),
      ],
    );
    if (!inserted) {
      throw new Error('Failed to insert SQL connection');
    }
    return inserted;
  }

  async update(
    id: string,
    row: UpdateSqlConnectionRow,
  ): Promise<SqlConnectionRow> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const append = (column: string, value: unknown, cast = '') => {
      sets.push(`${column} = $${idx}${cast}`);
      values.push(value);
      idx++;
    };
    if (row.name !== undefined) append('name', row.name);
    if (row.host !== undefined) append('host', row.host);
    if (row.port !== undefined) append('port', row.port);
    if (row.database !== undefined) append('database', row.database);
    if (row.username !== undefined) append('username', row.username);
    if (row.passwordCiphertext !== undefined) {
      append('password_ciphertext', row.passwordCiphertext);
    }
    if (row.passwordIv !== undefined) append('password_iv', row.passwordIv);
    if (row.passwordTag !== undefined) append('password_tag', row.passwordTag);
    if (row.ssl !== undefined) {
      append('ssl', JSON.stringify(row.ssl), '::jsonb');
    }
    if (row.schemaName !== undefined) append('schema_name', row.schemaName);
    if (row.allowedTables !== undefined) {
      // H1b: null clears the allowlist, array replaces it. We serialize
      // both shapes via JSON.stringify (which produces "null" for the
      // null case) and cast through ::jsonb so Postgres stores the value.
      append(
        'allowed_tables',
        row.allowedTables === null ? null : JSON.stringify(row.allowedTables),
        '::jsonb',
      );
    }
    sets.push(`updated_at = now()`);

    values.push(id);
    const updated = await this.db.queryOne<SqlConnectionRow>(
      `UPDATE org_sql_connection SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING ${SELECT_COLUMNS}`,
      values,
    );
    if (!updated) {
      throw new Error('SQL connection not found');
    }
    return updated;
  }

  async updateStatus(
    id: string,
    status: SqlConnectionStatus,
    statusError: string | null,
  ): Promise<void> {
    await this.db.query(
      `UPDATE org_sql_connection
         SET status = $1, status_error = $2, updated_at = now()
         WHERE id = $3`,
      [status, statusError, id],
    );
  }

  async findById(id: string): Promise<SqlConnectionRow | null> {
    return this.db.queryOne<SqlConnectionRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_sql_connection WHERE id = $1`,
      [id],
    );
  }

  async findByIdInOrg(
    id: string,
    organizationId: string,
  ): Promise<SqlConnectionRow | null> {
    return this.db.queryOne<SqlConnectionRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_sql_connection
         WHERE id = $1 AND organization_id = $2`,
      [id, organizationId],
    );
  }

  async findManyByIdsForOrg(
    ids: string[],
    organizationId: string,
  ): Promise<SqlConnectionRow[]> {
    if (ids.length === 0) return [];
    return this.db.query<SqlConnectionRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_sql_connection
         WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
      [organizationId, ids],
    );
  }

  async listForOrganization(
    organizationId: string,
  ): Promise<SqlConnectionRow[]> {
    return this.db.query<SqlConnectionRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_sql_connection
         WHERE organization_id = $1
         ORDER BY name ASC`,
      [organizationId],
    );
  }

  async findByOrganizationAndName(
    organizationId: string,
    name: string,
  ): Promise<SqlConnectionRow | null> {
    return this.db.queryOne<SqlConnectionRow>(
      `SELECT ${SELECT_COLUMNS} FROM org_sql_connection
         WHERE organization_id = $1 AND name = $2`,
      [organizationId, name],
    );
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.db.queryOne<{ id: string }>(
      `DELETE FROM org_sql_connection
         WHERE id = $1 AND organization_id = $2
         RETURNING id`,
      [id, organizationId],
    );
    return Boolean(result);
  }
}
