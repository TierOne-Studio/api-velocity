import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from '../admin';
import { AirweaveModule } from '../airweave/airweave.module';
import { DatabaseModule } from '../../shared/infrastructure/database/database.module';
import { ConfigService } from '../../shared/config/config.service';
import { ChatController } from './api/controllers/chat.controller';
import { ChatAgentService } from './application/services/chat-agent.service';
import { ChatService } from './application/services/chat.service';
import { ChatDatabaseRepository } from './infrastructure/persistence/repositories/chat.database-repository';
import { CHAT_REPOSITORY } from './domain/repositories/chat.repository.interface';
import { ChatMigrationService } from './chat.migration';

@Module({
  imports: [
    DatabaseModule,
    AdminModule,
    AirweaveModule,
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
    ChatMigrationService,
    { provide: CHAT_REPOSITORY, useClass: ChatDatabaseRepository },
  ],
  exports: [ChatService],
})
export class ChatModule {}
