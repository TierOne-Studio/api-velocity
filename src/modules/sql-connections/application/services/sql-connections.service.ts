import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '../../../../shared/config';
import {
  decryptAesGcmWithUpgradeHint,
  encryptAesGcm,
} from '../../../../shared/crypto/aes-gcm';
import type {
  CreateSqlConnectionInput,
  SqlConnection,
  SqlConnectionRow,
  SqlConnectionWithSecret,
  TestSqlConnectionInput,
  UpdateSqlConnectionInput,
} from '../../api/dto/sql-connection.dto';
import {
  SQL_CONNECTIONS_REPOSITORY,
  type ISqlConnectionsRepository,
} from '../../domain/sql-connection.repository';
import {
  SqlConnectionTester,
  sanitizeError,
} from './sql-connection-tester';
import type { PlatformRole } from '../../../admin/users/utils/admin.utils';

type CallerScope = {
  userId: string;
  platformRole: PlatformRole;
  activeOrganizationId: string | null;
  organizationId?: string;
};

@Injectable()
export class SqlConnectionsService {
  private readonly logger = new Logger(SqlConnectionsService.name);

  constructor(
    @Inject(SQL_CONNECTIONS_REPOSITORY)
    private readonly repository: ISqlConnectionsRepository,
    private readonly configService: ConfigService,
    private readonly tester: SqlConnectionTester,
  ) {}

  async list(scope: CallerScope): Promise<SqlConnection[]> {
    const orgId = this.requireOrg(scope);
    const rows = await this.repository.listForOrganization(orgId);
    return rows.map(toPublic);
  }

  async create(
    scope: CallerScope,
    input: CreateSqlConnectionInput,
  ): Promise<SqlConnection> {
    const orgId = this.requireOrg(scope);
    this.validateCreateInput(input);

    const existing = await this.repository.findByOrganizationAndName(
      orgId,
      input.name,
    );
    if (existing) {
      throw new ConflictException(
        `A SQL connection named "${input.name}" already exists in this organization`,
      );
    }

    const encrypted = this.encryptPassword(input.password);
    const row = await this.repository.create({
      id: randomUUID(),
      organizationId: orgId,
      name: input.name.trim(),
      host: input.host.trim(),
      port: input.port,
      database: input.database.trim(),
      username: input.username.trim(),
      passwordCiphertext: encrypted.ciphertext,
      passwordIv: encrypted.iv,
      passwordTag: encrypted.tag,
      ssl: input.ssl ?? false,
      schemaName: input.schemaName?.trim() || 'public',
      // H1b: validateCreateInput rejects malformed entries; null and the
      // omitted case both mean "no allowlist" — preserve current behavior.
      allowedTables: input.allowedTables ?? null,
    });

    // Test in the background; do not block create.
    void this.runAndRecordTest(row.id, {
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password: input.password,
      ssl: row.ssl,
    });

    return toPublic(row);
  }

  async update(
    scope: CallerScope,
    id: string,
    input: UpdateSqlConnectionInput,
  ): Promise<SqlConnection> {
    const orgId = this.requireOrg(scope);
    this.validateUpdateInput(input);
    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('SQL connection not found');

    if (input.name && input.name !== existing.name) {
      const dup = await this.repository.findByOrganizationAndName(
        orgId,
        input.name,
      );
      if (dup && dup.id !== id) {
        throw new ConflictException(
          `A SQL connection named "${input.name}" already exists in this organization`,
        );
      }
    }

    const patch: Parameters<ISqlConnectionsRepository['update']>[1] = {
      name: input.name?.trim(),
      host: input.host?.trim(),
      port: input.port,
      database: input.database?.trim(),
      username: input.username?.trim(),
      ssl: input.ssl,
      schemaName: input.schemaName?.trim(),
    };
    if (input.allowedTables !== undefined) {
      // H1b: omit → leave unchanged; null → clear allowlist; array → replace
      // (per the DTO contract). Validation happens in validateUpdateInput.
      patch.allowedTables = input.allowedTables;
    }

    let newPasswordPlaintext: string | null = null;
    if (input.password !== undefined) {
      // Empty / whitespace-only means "keep existing". Rather than silently
      // ignoring we surface it: the form should either omit the field or
      // supply a real value.
      if (input.password.trim().length === 0) {
        throw new BadRequestException(
          'password cannot be blank; omit the field to keep the existing one',
        );
      }
      const encrypted = this.encryptPassword(input.password);
      patch.passwordCiphertext = encrypted.ciphertext;
      patch.passwordIv = encrypted.iv;
      patch.passwordTag = encrypted.tag;
      newPasswordPlaintext = input.password;
    }

    const updated = await this.repository.update(id, patch);

    // If any connection-identifying field changed, re-test in background.
    const connectionChanged =
      Boolean(newPasswordPlaintext) ||
      input.host !== undefined ||
      input.port !== undefined ||
      input.database !== undefined ||
      input.username !== undefined ||
      input.ssl !== undefined;

    if (connectionChanged) {
      const password = newPasswordPlaintext ?? this.decryptPassword(existing);
      void this.runAndRecordTest(updated.id, {
        host: updated.host,
        port: updated.port,
        database: updated.database,
        username: updated.username,
        password,
        ssl: updated.ssl,
      });
    }

    return toPublic(updated);
  }

  async delete(
    scope: CallerScope,
    id: string,
  ): Promise<{ deleted: boolean }> {
    const orgId = this.requireOrg(scope);
    // M6: refuse-on-reference. If any project's data-source list points at
    // this connection, deletion would leave dangling references; the chat
    // resolver would silently drop the tool with no operator signal. Force
    // the operator to detach references first.
    const existing = await this.repository.findByIdInOrg(id, orgId);
    if (!existing) throw new NotFoundException('SQL connection not found');
    const referenceCount = await this.repository.countProjectReferences(id);
    if (referenceCount > 0) {
      throw new ConflictException(
        `Cannot delete SQL connection: ${referenceCount} project data source(s) still reference it. Detach them first.`,
      );
    }
    const deleted = await this.repository.delete(id, orgId);
    if (!deleted) throw new NotFoundException('SQL connection not found');
    return { deleted: true };
  }

  async testById(
    scope: CallerScope,
    id: string,
  ): Promise<SqlConnection> {
    const orgId = this.requireOrg(scope);
    const row = await this.repository.findByIdInOrg(id, orgId);
    if (!row) throw new NotFoundException('SQL connection not found');

    const password = this.decryptPassword(row);
    await this.runAndRecordTest(row.id, {
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password,
      ssl: row.ssl,
    });
    const refreshed = await this.repository.findById(row.id);
    return toPublic(refreshed ?? row);
  }

  async testCredentials(
    scope: CallerScope,
    input: TestSqlConnectionInput,
  ): Promise<ReturnType<SqlConnectionTester['test']> extends Promise<infer TResult> ? TResult : never> {
    this.validateTestInput(input);

    let password = input.password;
    if (password === undefined) {
      if (!input.connectionId) {
        throw new BadRequestException(
          'password is required when connectionId is not provided',
        );
      }

      const orgId = this.requireOrg(scope);
      const row = await this.repository.findByIdInOrg(input.connectionId, orgId);
      if (!row) {
        throw new NotFoundException('SQL connection not found');
      }
      password = this.decryptPassword(row);
    }

    return this.tester.test({
      host: input.host.trim(),
      port: input.port,
      database: input.database.trim(),
      username: input.username.trim(),
      password,
      ssl: input.ssl,
    });
  }

  /**
   * Used by DatabaseSourceProvider at chat time to resolve a set of connection
   * ids belonging to an organization. Returns decrypted connections. Callers
   * MUST NOT log or forward the password fields.
   */
  async resolveForAgent(
    organizationId: string,
    ids: string[],
  ): Promise<Array<SqlConnectionWithSecret & { password: string }>> {
    const rows = await this.repository.findManyByIdsForOrg(ids, organizationId);
    return rows.map((row) => ({
      ...toInternal(row),
      password: this.decryptPassword(row),
    }));
  }

  async findByIdForAttach(
    organizationId: string,
    id: string,
  ): Promise<SqlConnection | null> {
    const row = await this.repository.findByIdInOrg(id, organizationId);
    return row ? toPublic(row) : null;
  }

  private encryptPassword(plaintext: string) {
    const key = this.configService.getProjectSourceSecretKey();
    return encryptAesGcm(plaintext, key);
  }

  private decryptPassword(row: SqlConnectionRow): string {
    // C3a + C3b: dual-key decrypt with lazy upgrade-on-read.
    //
    // If the row is v0 wire format OR was decrypted under the previous
    // key, the helper sets `needsUpgrade`. We then fire-and-forget a
    // re-encrypt + persist with the CURRENT key in v1 format. Errors
    // on the upgrade write are logged but never bubble up — the caller
    // gets the plaintext regardless. This is the rotation-window flow:
    // operator rotates the key, traffic naturally rewrites rows over
    // time without a batch migration.
    const key = this.configService.getProjectSourceSecretKey();
    const previousKey =
      this.configService.getProjectSourceSecretKeyPrevious() ?? undefined;
    const { plaintext, needsUpgrade } = decryptAesGcmWithUpgradeHint(
      {
        ciphertext: row.password_ciphertext,
        iv: row.password_iv,
        tag: row.password_tag,
      },
      key,
      { previousKey },
    );
    if (needsUpgrade) {
      this.scheduleCiphertextUpgrade(row, plaintext, key);
    }
    return plaintext;
  }

  /**
   * Fire-and-forget re-encrypt + persist of a row's stored password under
   * the current key in v1 wire format. Used by lazy upgrade-on-read (C3b).
   *
   * Intentionally not awaited by the caller — the decrypt path returns
   * the plaintext immediately so user-facing latency is unaffected.
   * Concurrent reads of the same row may race and both rewrite the
   * column; that's harmless (same plaintext, fresh nonce each time;
   * last write wins, both equally valid).
   */
  private scheduleCiphertextUpgrade(
    row: SqlConnectionRow,
    plaintext: string,
    currentKey: string,
  ): void {
    const fresh = encryptAesGcm(plaintext, currentKey);
    void this.repository
      .update(row.id, {
        passwordCiphertext: fresh.ciphertext,
        passwordIv: fresh.iv,
        passwordTag: fresh.tag,
      })
      .then(() => {
        this.logger.log(
          `lazy-upgraded sql_connection ${row.id} ciphertext to v1`,
        );
      })
      .catch((error) => {
        this.logger.warn(
          `lazy ciphertext upgrade failed for sql_connection ${row.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private async runAndRecordTest(
    id: string,
    credentials: Parameters<SqlConnectionTester['test']>[0],
  ): Promise<void> {
    try {
      const result = await this.tester.test(credentials);
      if (result.ok === true) {
        await this.repository.updateStatus(id, 'ready', null);
        return;
      }
      await this.repository.updateStatus(id, 'error', result.error);
    } catch (error) {
      await this.repository.updateStatus(id, 'error', sanitizeError(error));
    }
  }

  private requireOrg(scope: CallerScope): string {
    if (scope.platformRole === 'superadmin') {
      const orgId = scope.organizationId ?? scope.activeOrganizationId;
      if (!orgId) {
        throw new BadRequestException(
          'organizationId is required for superadmin SQL connection calls',
        );
      }
      return orgId;
    }
    const activeOrg = scope.activeOrganizationId;
    if (!activeOrg) {
      throw new ForbiddenException('Active organization required');
    }
    if (scope.organizationId && scope.organizationId !== activeOrg) {
      throw new ForbiddenException(
        'You can only manage SQL connections in your active organization',
      );
    }
    return activeOrg;
  }

  private validateCreateInput(input: CreateSqlConnectionInput): void {
    if (!input.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!input.host?.trim()) {
      throw new BadRequestException('host is required');
    }
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new BadRequestException('port must be an integer in 1..65535');
    }
    if (!input.database?.trim()) {
      throw new BadRequestException('database is required');
    }
    if (!input.username?.trim()) {
      throw new BadRequestException('username is required');
    }
    if (!input.password) {
      throw new BadRequestException('password is required');
    }
    if (input.allowedTables !== undefined && input.allowedTables !== null) {
      validateAllowedTables(input.allowedTables);
    }
  }

  private validateUpdateInput(input: UpdateSqlConnectionInput): void {
    if (input.allowedTables !== undefined && input.allowedTables !== null) {
      validateAllowedTables(input.allowedTables);
    }
  }

  private validateTestInput(input: TestSqlConnectionInput): void {
    if (!input.host?.trim()) {
      throw new BadRequestException('host is required');
    }
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      throw new BadRequestException('port must be an integer in 1..65535');
    }
    if (!input.database?.trim()) {
      throw new BadRequestException('database is required');
    }
    if (!input.username?.trim()) {
      throw new BadRequestException('username is required');
    }
    if (input.password !== undefined && input.password.trim().length === 0) {
      throw new BadRequestException('password cannot be blank');
    }
  }
}

// H1b: validates each entry against the Postgres identifier shape.
// Accepts unqualified ("users") or schema-qualified ("analytics.orders")
// names. Per Postgres docs each identifier part is max 63 chars.
const ALLOWED_TABLE_REGEX =
  /^[A-Za-z_][A-Za-z0-9_]{0,62}(\.[A-Za-z_][A-Za-z0-9_]{0,62})?$/;

function validateAllowedTables(entries: string[]): void {
  if (!Array.isArray(entries)) {
    throw new BadRequestException(
      'allowedTables must be an array of identifiers or null',
    );
  }
  if (entries.length === 0) {
    throw new BadRequestException(
      'allowedTables cannot be an empty array; use null to clear the allowlist',
    );
  }
  if (entries.length > 200) {
    throw new BadRequestException('allowedTables is limited to 200 entries');
  }
  for (const entry of entries) {
    if (typeof entry !== 'string' || !ALLOWED_TABLE_REGEX.test(entry)) {
      throw new BadRequestException(
        `Invalid allowedTables entry: ${JSON.stringify(entry)}. Use Postgres identifier shape, optionally schema-qualified (e.g. "users" or "analytics.orders")`,
      );
    }
  }
}

function toPublic(row: SqlConnectionRow): SqlConnection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    host: row.host,
    port: row.port,
    database: row.database,
    username: row.username,
    ssl: row.ssl,
    schemaName: row.schema_name,
    allowedTables: row.allowed_tables,
    status: row.status,
    statusError: row.status_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toInternal(row: SqlConnectionRow): SqlConnectionWithSecret {
  return {
    ...toPublic(row),
    passwordCiphertext: row.password_ciphertext,
    passwordIv: row.password_iv,
    passwordTag: row.password_tag,
  };
}
