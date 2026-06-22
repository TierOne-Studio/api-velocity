import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './shared/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  const configService = app.get(ConfigService);

  // Trust proxy controls request.ip derivation behind a load balancer — required
  // for the public chat per-IP rate limiter to identify real clients (SPEC-003).
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    configService.getTrustProxy(),
  );

  app.enableCors({
    origin: configService.getTrustedOrigins(),
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Application listening on port ${port}`);
}
bootstrap();
