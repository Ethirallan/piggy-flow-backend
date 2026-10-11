import { ConflictException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';

describe('CategoryController', () => {
  let app: INestApplication;
  let user: any;
  const service = { updateOwned: jest.fn(), removeOwned: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [{ provide: CategoryService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    // Stand-in for the auth middleware.
    app.use((req: any, _res: any, next: () => void) => {
      req.user = user;
      next();
    });
    await app.init();
  });

  afterEach(() => app.close());

  it('PATCH passes the request user id', async () => {
    service.updateOwned.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).patch('/category/5').send({ name: 'Food', emoji: '🍕' });
    expect(res.status).toBe(200);
    expect(service.updateOwned).toHaveBeenCalledWith(5, 7, { name: 'Food', emoji: '🍕' });
  });

  it('DELETE passes the request user id', async () => {
    service.removeOwned.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).delete('/category/5');
    expect(res.status).toBe(200);
    expect(service.removeOwned).toHaveBeenCalledWith(5, 7);
  });

  it('PATCH and DELETE give 404 when there is no user', async () => {
    user = undefined;
    expect((await request(app.getHttpServer()).patch('/category/5').send({ name: 'x' })).status).toBe(404);
    expect((await request(app.getHttpServer()).delete('/category/5')).status).toBe(404);
    expect(service.updateOwned).not.toHaveBeenCalled();
    expect(service.removeOwned).not.toHaveBeenCalled();
  });

  it('a 409 from the service reaches the client', async () => {
    service.removeOwned.mockRejectedValue(new ConflictException('In use'));
    const res = await request(app.getHttpServer()).delete('/category/5');
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('In use');
  });
});
