import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AdminModule } from '../admin';
import { ChatModule } from '../chat/chat.module';
import { EmbedSitesModule } from '../embed-sites/embed-sites.module';
import { ProjectsModule } from '../projects';
import { PublicChatController } from './api/controllers/public-chat.controller';
import { PublicCorsMiddleware } from './api/middleware/public-cors.middleware';
import { PublicEmbedGuard } from './api/guards/public-embed.guard';
import { PublicRateLimitGuard } from './api/guards/public-rate-limit.guard';
import { PublicChatService } from './application/public-chat.service';

/**
 * Public anonymous web-chat channel (SPEC-003). Sits beside the private
 * ChatModule, reusing ChatAgentService (the stateless agent core) but with its
 * own auth (embed key + origin allowlist), per-request CORS, and burst rate
 * limiting. MUST be imported after ProjectsModule/EmbedSitesModule.
 */
@Module({
  imports: [EmbedSitesModule, ProjectsModule, AdminModule, ChatModule],
  controllers: [PublicChatController],
  providers: [PublicChatService, PublicEmbedGuard, PublicRateLimitGuard],
})
export class PublicChatModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PublicCorsMiddleware)
      .forRoutes({ path: 'api/public/*', method: RequestMethod.ALL });
  }
}
