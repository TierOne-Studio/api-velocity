import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { KnowledgeBaseController } from './api/controllers/knowledge-base.controller';
import { KnowledgeBaseService } from './application/services/knowledge-base.service';
import { KnowledgeBaseMigrationService } from './knowledge-base.migration';
import { KnowledgeBaseDatabaseRepository } from './infrastructure/persistence/repositories/knowledge-base.database-repository';
import { KNOWLEDGE_BASE_REPOSITORY } from './domain/knowledge-base.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [KnowledgeBaseController],
  providers: [
    KnowledgeBaseService,
    KnowledgeBaseMigrationService,
    {
      provide: KNOWLEDGE_BASE_REPOSITORY,
      useClass: KnowledgeBaseDatabaseRepository,
    },
  ],
  exports: [KnowledgeBaseService, KnowledgeBaseMigrationService],
})
export class KnowledgeBaseModule {}
