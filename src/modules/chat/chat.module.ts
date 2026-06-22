import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from '../admin';
import { AirweaveModule } from '../airweave/airweave.module';
import { ProjectsModule } from '../projects';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { ConfigService } from '../../shared/config/config.service';
import { ChatController } from './api/controllers/chat.controller';
import { ChatAgentService } from './application/services/chat-agent.service';
import { ChatRouterService } from './application/services/chat-router.service';
import { ChatService } from './application/services/chat.service';
import { ChatDatabaseRepository } from './infrastructure/persistence/repositories/chat.database-repository';
import { CHAT_REPOSITORY } from './domain/repositories/chat.repository.interface';
import { ChatMigrationService } from './chat.migration';

@Module({
  imports: [
    DatabaseModule,
    AdminModule,
    AirweaveModule,
    ProjectsModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'chat',
            ttl: config.getChatRateLimitTtl(),
            limit: config.getChatRateLimitMax(),
          },
        ],
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatAgentService,
    // Consumed by ChatAgentService's dispatcher branch when
    // CHAT_ROUTER_ENABLED=true; otherwise the classifier is never invoked.
    ChatRouterService,
    ChatMigrationService,
    { provide: CHAT_REPOSITORY, useClass: ChatDatabaseRepository },
  ],
  // ChatAgentService is exported so the public web-chat channel (PublicChatModule,
  // SPEC-003) can reuse the stateless agent core. A dedicated `chat-agent`
  // sub-module would be cleaner for SoC, but physically relocating the service
  // would churn ~8 co-located spec files + chat.service; deferred as a follow-up
  // (P3.5 — structural refactor, repo wins for this PR).
  exports: [ChatService, ChatAgentService],
})
export class ChatModule {}
