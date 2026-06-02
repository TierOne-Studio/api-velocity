import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { VectorDbController } from './api/controllers/vectordb.controller';
import { VectorDbService } from './application/services/vector-db.service';
import { VectorDbMigrationService } from './vector-db.migration';
import { VectorDbDatabaseRepository } from './infrastructure/persistence/repositories/vectordb.database-repository';
import { VECTOR_DB_REPOSITORY } from './domain/vector-db.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [VectorDbController],
  providers: [
    VectorDbService,
    VectorDbMigrationService,
    {
      provide: VECTOR_DB_REPOSITORY,
      useClass: VectorDbDatabaseRepository,
    },
  ],
  exports: [VectorDbService, VectorDbMigrationService],
})
export class VectorDbModule {}
