import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Serves Swagger UI at /docs and the OpenAPI JSON at /docs-json. */
export function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Piggy Flow API')
    .setVersion('2')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, config),
    {
      jsonDocumentUrl: 'docs-json',
    },
  );
}

/** API docs are opt-in, so a deploy that forgets NODE_ENV doesn't publish them. */
export function docsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development';
}
