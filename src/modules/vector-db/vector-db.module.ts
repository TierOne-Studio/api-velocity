import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { VectorDbController } from './api/controllers/vector-db.controller';
import { VectorDbService } from './application/services/vector-db.service';
import { VectorDbMigrationService } from './vector-db.migration';
import { VectorDbDatabaseRepository } from './infrastructure/persistence/repositories/vector-db.database-repository';
import { VectorDbFileUploaderService } from './infrastructure/s3/vector-db-file-uploader.service';
import { VECTOR_DB_REPOSITORY } from './domain/vector-db.repository';
import { VECTOR_DB_FILE_UPLOADER } from './domain/vector-db-file-uploader.port';

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
    {
      provide: VECTOR_DB_FILE_UPLOADER,
      useClass: VectorDbFileUploaderService,
    },
  ],
  exports: [VectorDbService, VectorDbMigrationService],
})
export class VectorDbModule {}
