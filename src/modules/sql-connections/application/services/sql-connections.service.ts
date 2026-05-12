import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '../../../../shared/config';
import {
  decryptAesGcm,
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
    // C3a: pass the optional previous key so legacy rows encrypted under
    // the prior master key still decrypt during a rotation window.
    // Lazy upgrade-on-read of those rows is C3b (separate commit).
    const key = this.configService.getProjectSourceSecretKey();
    const previousKey =
      this.configService.getProjectSourceSecretKeyPrevious() ?? undefined;
    return decryptAesGcm(
      {
        ciphertext: row.password_ciphertext,
        iv: row.password_iv,
        tag: row.password_tag,
      },
      key,
      { previousKey },
    );
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
