import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { VectorDbController } from './api/controllers/vector-db.controller';
import { VectorDbService } from './application/services/vector-db.service';
import { VectorDbIngestionService } from './application/services/vector-db-ingestion.service';
import { VectorDbMigrationService } from './vector-db.migration';
import { VectorDbDatabaseRepository } from './infrastructure/persistence/repositories/vector-db.database-repository';
import { VectorDbFileUploaderService } from './infrastructure/s3/vector-db-file-uploader.service';
import { QdrantVectorStoreAdapter } from './infrastructure/qdrant/qdrant-vector-store.adapter';
import { OpenAiEmbedderAdapter } from './infrastructure/openai/openai-embedder.adapter';
import { PgBossIngestionQueueAdapter } from './infrastructure/queue/pg-boss-ingestion-queue.adapter';
import { RecursiveTextChunker } from './infrastructure/textsplitter/recursive-text-chunker.adapter';
import { VECTOR_DB_REPOSITORY } from './domain/vector-db.repository';
import { VECTOR_DB_FILE_UPLOADER } from './domain/vector-db-file-uploader.port';
import { VECTOR_STORE } from './domain/vector-store.port';
import { EMBEDDER } from './domain/embedder.port';
import { INGESTION_QUEUE } from './domain/ingestion-queue.port';
import { TEXT_CHUNKER } from './domain/text-chunker.port';

@Module({
  imports: [DatabaseModule],
  controllers: [VectorDbController],
  providers: [
    VectorDbService,
    VectorDbIngestionService,
    VectorDbMigrationService,
    {
      provide: VECTOR_DB_REPOSITORY,
      useClass: VectorDbDatabaseRepository,
    },
    {
      provide: VECTOR_DB_FILE_UPLOADER,
      useClass: VectorDbFileUploaderService,
    },
    {
      provide: VECTOR_STORE,
      useClass: QdrantVectorStoreAdapter,
    },
    {
      provide: EMBEDDER,
      useClass: OpenAiEmbedderAdapter,
    },
    {
      provide: INGESTION_QUEUE,
      useClass: PgBossIngestionQueueAdapter,
    },
    {
      provide: TEXT_CHUNKER,
      useClass: RecursiveTextChunker,
    },
  ],
  exports: [VectorDbService, VectorDbMigrationService],
})
export class VectorDbModule {}
