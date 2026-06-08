import { Module, forwardRef } from '@nestjs/common';
import { AdminModule } from '../admin';
import { AirweaveModule } from '../airweave/airweave.module';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { SqlConnectionsModule } from '../sql-connections/sql-connections.module';
import { VectorDbModule } from '../vector-db/vector-db.module';
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
  imports: [
    DatabaseModule,
    AdminModule,
    // forwardRef: AirweaveModule injects PROJECTS_REPOSITORY (Step 5 of the
    // airweave-collections-crud feature). ProjectsModule still needs
    // AirweaveModule for AirweaveCollectionProvider. forwardRef resolves
    // the resulting init cycle.
    forwardRef(() => AirweaveModule),
    SqlConnectionsModule,
    // forwardRef: ProjectsService injects VectorDbService (vector_db source
    // attach, Slice 5) while VectorDbService injects PROJECTS_REPOSITORY for
    // delete-time reference counting (ADR-013 Decision 9). Genuine
    // bidirectional dependency — resolved by forwardRef on both modules, same
    // as the AirweaveModule cycle above.
    forwardRef(() => VectorDbModule),
  ],
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
