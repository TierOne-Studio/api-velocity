import { Module } from '@nestjs/common';
import { AdminModule } from '../admin';
import { AirweaveModule } from '../airweave/airweave.module';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { SqlConnectionsModule } from '../sql-connections/sql-connections.module';
import { ProjectsController } from './api/controllers/projects.controller';
import { ProjectsService } from './application/services/projects.service';
import { AirweaveCollectionProvider } from './application/providers/airweave-collection.provider';
import { DatabaseSourceProvider } from './application/providers/database.provider';
import { ExternalSourceProvider } from './application/providers/external.provider';
import { DataSourceRegistry } from './application/providers/data-source.registry';
import { ChatToSqlService } from './application/providers/database/chat-to-sql.service';
import { ProjectsDatabaseRepository } from './infrastructure/persistence/repositories/projects.database-repository';
import { PROJECTS_REPOSITORY } from './domain/repositories/projects.repository.interface';
import { ProjectsMigrationService } from './projects.migration';

@Module({
  imports: [DatabaseModule, AdminModule, AirweaveModule, SqlConnectionsModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectsMigrationService,
    AirweaveCollectionProvider,
    DatabaseSourceProvider,
    ExternalSourceProvider,
    ChatToSqlService,
    DataSourceRegistry,
    { provide: PROJECTS_REPOSITORY, useClass: ProjectsDatabaseRepository },
  ],
  exports: [
    ProjectsService,
    ProjectsMigrationService,
    DataSourceRegistry,
    PROJECTS_REPOSITORY,
  ],
})
export class ProjectsModule {}
