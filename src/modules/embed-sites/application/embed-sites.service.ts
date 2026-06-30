import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { normalizeOrigin } from '../../../shared/utils/normalize-origin';
import type { PlatformRole } from '../../admin/utils/admin.utils';
import type { IProjectsRepository } from '../../projects/domain/repositories/projects.repository.interface';
import { PROJECTS_REPOSITORY } from '../../projects/domain/repositories/projects.repository.interface';
import { EmbedSite } from '../domain/entities/embed-site';
import {
  EmbedSiteProjectConflictError,
  EmbedSitePublicKeyCollisionError,
  EMBED_SITE_REPOSITORY,
} from '../domain/repositories/embed-site.repository.interface';
import type { EmbedSiteRepositoryPort } from '../domain/repositories/embed-site.repository.interface';
import type {
  CreateEmbedSiteInput,
  EmbedSiteSummary,
  UpdateEmbedSiteInput,
} from '../api/dto/embed-site.dto';
import { generateEmbedSiteKey } from './embed-site-key';

/**
 * Caller identity resolved from the session at the controller boundary. Mirrors
 * the VectorDbService pattern: `requireOrg` turns it into a concrete, validated
 * `organizationId` and rejects cross-org access.
 */
export type EmbedSitesCallerScope = {
  userId: string;
  platformRole: PlatformRole;
  activeOrganizationId: string | null;
  organizationId?: string;
};

// Bounded retry for the astronomically-unlikely public-key collision. A
// ≥128-bit CSPRNG collision is vanishingly rare; 3 attempts then fail fast with
// context rather than loop forever (root-cause over silent retry).
const KEY_GENERATION_ATTEMPTS = 3;

function toSummary(site: EmbedSite): EmbedSiteSummary {
  return {
    id: site.id,
    name: site.name,
    projectId: site.projectId,
    publicKey: site.publicKey,
    allowedOrigins: site.allowedOrigins,
    enabled: site.enabled,
    theme: site.theme,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

@Injectable()
export class EmbedSitesService {
  private readonly logger = new Logger(EmbedSitesService.name);

  constructor(
    @Inject(EMBED_SITE_REPOSITORY)
    private readonly repository: EmbedSiteRepositoryPort,
    @Inject(PROJECTS_REPOSITORY)
    private readonly projects: IProjectsRepository,
  ) {}

  async list(scope: EmbedSitesCallerScope): Promise<EmbedSiteSummary[]> {
    const orgId = this.requireOrg(scope);
    const sites = await this.repository.listByOrg(orgId);
    return sites.map(toSummary);
  }

  async getById(
    scope: EmbedSitesCallerScope,
    id: string,
  ): Promise<EmbedSiteSummary> {
    const orgId = this.requireOrg(scope);
    const site = await this.repository.findById(id, orgId);
    if (!site) throw new NotFoundException('Embed site not found');
    return toSummary(site);
  }

  async create(
    scope: EmbedSitesCallerScope,
    input: CreateEmbedSiteInput,
  ): Promise<EmbedSiteSummary> {
    const orgId = this.requireOrg(scope);
    const name = this.requireName(input.name);
    const projectId = input.projectId?.trim();
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }
    const allowedOrigins = this.normalizeOrigins(input.allowedOrigins);

    // Cross-org attach guard (architect HIGH-1): the project MUST belong to the
    // caller's org. `IProjectsRepository.findById` is NOT org-scoped, so this
    // comparison is the sole barrier — a missing/foreign project is reported as
    // 404 (the project does not exist from this org's view), and it runs BEFORE
    // any uniqueness signal so a 409 can never leak that the project exists in
    // another org.
    const project = await this.projects.findById(projectId);
    if (!project || project.organization_id !== orgId) {
      throw new NotFoundException('Project not found');
    }

    try {
      const site = await this.withKeyRetry((publicKey) =>
        this.repository.create({
          id: randomUUID(),
          organizationId: orgId,
          projectId,
          name,
          publicKey,
          allowedOrigins,
          theme: input.theme ?? null,
        }),
      );
      this.logger.log('embed site created', {
        embedSiteId: site.id,
        organizationId: orgId,
        projectId: site.projectId,
      });
      return toSummary(site);
    } catch (err) {
      if (err instanceof EmbedSiteProjectConflictError) {
        throw new ConflictException(
          'An embed site already exists for this project',
        );
      }
      throw err;
    }
  }

  async update(
    scope: EmbedSitesCallerScope,
    id: string,
    input: UpdateEmbedSiteInput,
  ): Promise<EmbedSiteSummary> {
    const orgId = this.requireOrg(scope);
    const patch: UpdateEmbedSiteInput = {};
    if (input.name !== undefined) patch.name = this.requireName(input.name);
    if (input.allowedOrigins !== undefined) {
      patch.allowedOrigins = this.normalizeOrigins(input.allowedOrigins);
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') {
        throw new BadRequestException('enabled must be a boolean');
      }
      patch.enabled = input.enabled;
    }
    if (input.theme !== undefined) patch.theme = input.theme;

    const site = await this.repository.update(id, orgId, patch);
    if (!site) throw new NotFoundException('Embed site not found');
    return toSummary(site);
  }

  async rotateKey(
    scope: EmbedSitesCallerScope,
    id: string,
  ): Promise<EmbedSiteSummary> {
    const orgId = this.requireOrg(scope);
    const site = await this.withKeyRetry((publicKey) =>
      this.repository.rotateKey(id, orgId, publicKey),
    );
    if (!site) throw new NotFoundException('Embed site not found');
    this.logger.log('embed site key rotated', {
      embedSiteId: site.id,
      organizationId: orgId,
    });
    return toSummary(site);
  }

  async delete(scope: EmbedSitesCallerScope, id: string): Promise<void> {
    const orgId = this.requireOrg(scope);
    const deleted = await this.repository.delete(id, orgId);
    if (!deleted) throw new NotFoundException('Embed site not found');
    this.logger.log('embed site deleted', {
      embedSiteId: id,
      organizationId: orgId,
    });
  }

  /**
   * Resolve the effective organization, rejecting cross-org access (mirrors
   * VectorDbService.requireOrg). Superadmin must name an org explicitly;
   * everyone else operates in their active org and cannot target another.
   */
  private requireOrg(scope: EmbedSitesCallerScope): string {
    if (scope.platformRole === 'superadmin') {
      const orgId = scope.organizationId ?? scope.activeOrganizationId;
      if (!orgId) {
        throw new BadRequestException(
          'organizationId is required for superadmin embed-site calls',
        );
      }
      return orgId;
    }
    const activeOrg = scope.activeOrganizationId;
    if (!activeOrg) {
      // Org context missing entirely → 403 (repo-conventions §3; matches
      // VectorDbService.requireOrg).
      throw new ForbiddenException('Active organization required');
    }
    if (scope.organizationId && scope.organizationId !== activeOrg) {
      throw new ForbiddenException(
        'You can only manage embed sites in your active organization',
      );
    }
    return activeOrg;
  }

  private requireName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('name is required');
    }
    return name.trim();
  }

  /**
   * Normalize + dedupe the allowlist on write (SPEC-003 §11 "normalized on admin
   * write"). An unparseable origin is rejected rather than silently dropped, so
   * the admin gets immediate feedback instead of a widget that never matches.
   */
  private normalizeOrigins(origins: unknown): string[] {
    if (!Array.isArray(origins)) {
      throw new BadRequestException('allowedOrigins must be an array');
    }
    const normalized = new Set<string>();
    for (const origin of origins) {
      if (typeof origin !== 'string') {
        throw new BadRequestException('allowedOrigins must be strings');
      }
      const canonical = normalizeOrigin(origin);
      if (!canonical) {
        throw new BadRequestException(`Invalid origin: ${origin}`);
      }
      normalized.add(canonical);
    }
    return [...normalized];
  }

  /**
   * Run a key-bound persistence op, regenerating the key on a unique collision.
   * Bounded — after KEY_GENERATION_ATTEMPTS it fails fast with context rather
   * than looping (a sustained collision signals a deeper fault, not bad luck).
   */
  private async withKeyRetry<T>(op: (key: string) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < KEY_GENERATION_ATTEMPTS; attempt++) {
      try {
        return await op(generateEmbedSiteKey());
      } catch (err) {
        if (err instanceof EmbedSitePublicKeyCollisionError) {
          lastError = err;
          this.logger.warn('embed-site public key collision; regenerating', {
            attempt: attempt + 1,
          });
          continue;
        }
        throw err;
      }
    }
    const reason = lastError instanceof Error ? lastError.message : 'unknown';
    throw new InternalServerErrorException(
      `embed-site key generation failed after ${KEY_GENERATION_ATTEMPTS} attempts: ${reason}`,
    );
  }
}
