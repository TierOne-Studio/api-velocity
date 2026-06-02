import { Module, OnModuleInit } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth, setEmailService, setPostSignupCallback } from './auth';
import { PostSignupService } from './modules/admin/organizations/application/services/post-signup.service';
import { ConfigModule, ConfigService } from './shared/config';
import { EmailModule, EmailService } from './shared/email';
import { DatabaseModule } from './shared/infrastructure/database/database.module';
import { AppTypeOrmModule } from './shared/infrastructure/database/typeorm.module';
import { SharedModule } from './shared/shared.module';
import { AdminModule, RbacModule } from './modules/admin';
import { AirweaveModule } from './modules/airweave/airweave.module';
import { SqlConnectionsModule } from './modules/sql-connections/sql-connections.module';
import { VectordbModule } from './modules/vectordb/vectordb.module';
import { ProjectsModule } from './modules/projects';
import { ChatModule } from './modules/chat';

@Module({
  imports: [
    ConfigModule,
    EmailModule,
    DatabaseModule,
    AppTypeOrmModule,
    SharedModule,
    RbacModule,
    AdminModule,
    AirweaveModule,
    // SqlConnectionsModule must be imported before ProjectsModule: the
    // database source provider injects SqlConnectionsService.
    SqlConnectionsModule,
    // VectordbModule before ProjectsModule: chat provider (Slice 6)
    // will inject KnowledgeBaseService from the registry.
    VectordbModule,
    // ProjectsModule MUST be imported before ChatModule — ChatMigrationService
    // cross-injects ProjectsMigrationService to force the Projects tables to
    // exist before conversation.project_id is backfilled.
    ProjectsModule,
    ChatModule,
    AuthModule.forRoot({ auth }),
  ],
  controllers: [AppController],
  providers: [AppService, PostSignupService],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly postSignupService: PostSignupService,
  ) {}

  onModuleInit() {
    // Validate environment variables
    this.configService.validateEnvironment();

    // Wire up email service to auth
    setEmailService(this.emailService);
    console.log('✅ Email service connected to Better Auth');

    // Wire up post-signup callback for self-serve onboarding
    setPostSignupCallback((userId) =>
      this.postSignupService.addUserToDefaultOrg(userId),
    );
    console.log('✅ Post-signup callback connected to Better Auth');
  }
}
