import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '../../../shared/config';
import { AdminOrganizationsService } from '../../admin/organizations/application/services/admin-organizations.service';
import { ProjectsService } from '../../projects/application/services/projects.service';
import {
  ChatAgentService,
  type ChatStreamEvent,
} from '../../chat/application/services/chat-agent.service';
import { EMBED_SITE_REPOSITORY } from '../../embed-sites/domain/repositories/embed-site.repository.interface';
import type { EmbedSiteRepositoryPort } from '../../embed-sites/domain/repositories/embed-site.repository.interface';
import type { EmbedScope } from './embed-scope';
import { filterPublicSources } from './public-source-allowlist';

/**
 * Orchestrates the anonymous public ask: resolves the embed site's project +
 * org, applies the fail-closed source allowlist, enforces the durable monthly
 * cost cap, then streams a grounded answer via the stateless agent core
 * (`generateReplyStreaming`). No conversation, no persistence (SPEC-003 v1).
 */
@Injectable()
export class PublicChatService {
  private readonly logger = new Logger(PublicChatService.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly organizationsService: AdminOrganizationsService,
    private readonly chatAgentService: ChatAgentService,
    @Inject(EMBED_SITE_REPOSITORY)
    private readonly embedSites: EmbedSiteRepositoryPort,
    private readonly config: ConfigService,
  ) {}

  /**
   * Public widget config (SPEC-003 §4): the resolved embed site's theming, for
   * the widget to self-render. The guard already authenticated the key + origin
   * and put `embedSiteId`/`organizationId` on the scope — we re-fetch the site
   * (org-scoped, defense in depth) rather than widen the minimal request scope
   * to carry the theme. Returns only what the anonymous widget needs.
   */
  async getPublicConfig(
    scope: EmbedScope,
  ): Promise<{ theme: Record<string, unknown> | null }> {
    const site = await this.embedSites.findById(
      scope.embedSiteId,
      scope.organizationId,
    );
    if (!site) {
      throw new NotFoundException('Embed site not found');
    }
    return { theme: site.theme };
  }

  /**
   * Resolve scope, enforce the monthly cap, and return the answer stream. All
   * the failure modes that should surface as a clean HTTP status (404 unknown
   * project/org, 429 over cap) are raised HERE — before the caller flushes SSE
   * headers — so they never appear mid-stream.
   */
  async prepareStream(params: {
    scope: EmbedScope;
    question: string;
    signal?: AbortSignal;
  }): Promise<AsyncGenerator<ChatStreamEvent>> {
    const { scope, question, signal } = params;

    const { project, sources } =
      await this.projectsService.resolveProjectSources(
        scope.projectId,
        scope.organizationId,
      );

    const organization = await this.organizationsService.findById(
      scope.organizationId,
    );
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Fail-closed allowlist + only ready sources reach the agent. database/
    // external/unknown kinds are stripped so the SQL tool is never built.
    const publicSources = filterPublicSources(
      sources.filter((source) => source.status === 'ready'),
    );

    // Durable monthly cap — the spend backstop, enforced before the LLM call.
    const used = await this.embedSites.incrementMonthlyUsage(
      scope.organizationId,
    );
    if (used > this.config.getEmbedPublicMonthlyCap()) {
      this.logger.warn('public ask rejected: org monthly cap exceeded', {
        organizationId: scope.organizationId,
        embedSiteId: scope.embedSiteId,
      });
      throw new HttpException(
        'Monthly request cap exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.chatAgentService.generateReplyStreaming({
      organizationName: organization.name,
      projectName: project.name,
      projectId: scope.projectId,
      orgId: scope.organizationId,
      userId: 'anonymous',
      conversationId: null,
      sources: publicSources,
      question,
      previousMessages: [],
      signal,
    });
  }
}
