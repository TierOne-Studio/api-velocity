import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects';
import { EmbedSitesController } from './api/controllers/embed-sites.controller';
import { EmbedSitesService } from './application/embed-sites.service';
import { EMBED_SITE_REPOSITORY } from './domain/repositories/embed-site.repository.interface';
import { EmbedSiteDatabaseRepository } from './infrastructure/persistence/repositories/embed-site.database-repository';
import { EmbedSitesMigrationService } from './embed-sites.migration';

/**
 * Embed-sites module: persistence + admin CRUD for public web-chat widget sites
 * (SPEC-003). MUST be imported after ProjectsModule (the `embed_site.project_id`
 * FK and the migration ordering depend on the `project` table existing first;
 * the admin service also injects PROJECTS_REPOSITORY for the cross-org
 * project-ownership check). The repo port is exported for the public-chat channel.
 *
 * DatabaseService is provided globally; ProjectsModule supplies
 * ProjectsMigrationService for migration ordering and PROJECTS_REPOSITORY.
 */
@Module({
  imports: [ProjectsModule],
  controllers: [EmbedSitesController],
  providers: [
    EmbedSitesService,
    EmbedSitesMigrationService,
    { provide: EMBED_SITE_REPOSITORY, useClass: EmbedSiteDatabaseRepository },
  ],
  exports: [EMBED_SITE_REPOSITORY],
})
export class EmbedSitesModule {}
