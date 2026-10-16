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
