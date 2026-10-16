import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { docsEnabled, setupDocs } from './docs.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);
  if (docsEnabled()) {
    setupDocs(app);
  }
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
