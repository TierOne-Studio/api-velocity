import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { VectordbController } from './api/controllers/vectordb.controller';
import { VectordbService } from './application/services/vectordb.service';
import { VectordbMigrationService } from './vectordb.migration';
import { VectordbDatabaseRepository } from './infrastructure/persistence/repositories/vectordb.database-repository';
import { VECTORDB_REPOSITORY } from './domain/vectordb.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [VectordbController],
  providers: [
    VectordbService,
    VectordbMigrationService,
    {
      provide: VECTORDB_REPOSITORY,
      useClass: VectordbDatabaseRepository,
    },
  ],
  exports: [VectordbService, VectordbMigrationService],
})
export class VectordbModule {}
