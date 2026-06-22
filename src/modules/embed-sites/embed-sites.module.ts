import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects';
import { EMBED_SITE_REPOSITORY } from './domain/repositories/embed-site.repository.interface';
import { EmbedSiteDatabaseRepository } from './infrastructure/persistence/repositories/embed-site.database-repository';
import { EmbedSitesMigrationService } from './embed-sites.migration';

/**
 * Embed-sites module: persistence for public web-chat widget sites (SPEC-003).
 * MUST be imported after ProjectsModule (the `embed_site.project_id` FK and the
 * migration ordering depend on the `project` table existing first). The repo
 * port is exported for the public-chat channel; admin CRUD arrives in Slice 2.
 *
 * DatabaseService is provided globally; ProjectsModule supplies
 * ProjectsMigrationService for migration ordering.
 */
@Module({
  imports: [ProjectsModule],
  providers: [
    EmbedSitesMigrationService,
    { provide: EMBED_SITE_REPOSITORY, useClass: EmbedSiteDatabaseRepository },
  ],
  exports: [EMBED_SITE_REPOSITORY],
})
export class EmbedSitesModule {}
