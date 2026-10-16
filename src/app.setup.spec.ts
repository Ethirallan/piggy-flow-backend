import { Body, Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { configureApp, parseTrustProxy } from './app.setup.js';

class EchoDto {
  @IsString()
  name: string;
}

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: EchoDto): EchoDto {
    return body;
  }
}

describe('configureApp', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('accepts a valid body', () =>
    request(app.getHttpServer())
      .post('/echo')
      .send({ name: 'Ana' })
      .expect(201, { name: 'Ana' }));

  it('rejects unknown fields', () =>
    request(app.getHttpServer())
      .post('/echo')
      .send({ name: 'Ana', admin: true })
      .expect(400));

  it('rejects fields of the wrong type', () =>
    request(app.getHttpServer()).post('/echo').send({ name: 1 }).expect(400));
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['1', 1],
    ['2', 2],
    ['true', true],
    ['false', false],
    ['loopback', 'loopback'],
    ['10.0.0.0/8, 172.16.0.0/12', '10.0.0.0/8, 172.16.0.0/12'],
  ])('parses %j as %j', (input, expected) => {
    expect(parseTrustProxy(input)).toBe(expected);
  });
});
