import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Let startup errors (e.g. invalid env) reach the catch below instead of a silent abort.
    abortOnError: false,
  });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(AppConfig).get('PORT'));
}

bootstrap().catch((error: unknown) => {
  console.error('API failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
