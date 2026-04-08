import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PASSWORD_POLICY } from './shared/utils/password-policy';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('api/hello')
  @AllowAnonymous()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('me')
  getProfile(@Session() session: UserSession) {
    return session;
  }

  @Get('health')
  @AllowAnonymous()
  healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Get('api/password-policy')
  @AllowAnonymous()
  getPasswordPolicy() {
    return PASSWORD_POLICY;
  }
}
