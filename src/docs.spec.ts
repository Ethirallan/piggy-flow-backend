import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from './app.controller.js';
import { setupDocs } from './docs.js';

describe('setupDocs', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    app = moduleRef.createNestApplication();
    setupDocs(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('serves the OpenAPI document with the health endpoint and bearer auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(res.body.info).toMatchObject({
      title: 'Piggy Flow API',
      version: '2',
    });
    expect(res.body.paths['/health'].get).toMatchObject({
      summary: 'Check that the API is running',
      tags: ['health'],
    });
    expect(res.body.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});
