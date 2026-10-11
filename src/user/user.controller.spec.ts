import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let app: INestApplication;
  let user: any;
  const service = { findOne: jest.fn(), update: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = user;
      next();
    });
    await app.init();
  });

  afterEach(() => app.close());

  it('getUserById returns the signed-in user', async () => {
    service.findOne.mockResolvedValue({ id: 7 });
    const res = await request(app.getHttpServer()).get('/user/getUserById/7');
    expect(res.status).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith(7);
  });

  it('getUserById gives 404 for another user or no user', async () => {
    expect((await request(app.getHttpServer()).get('/user/getUserById/8')).status).toBe(404);
    user = undefined;
    expect((await request(app.getHttpServer()).get('/user/getUserById/7')).status).toBe(404);
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('PATCH saves only the request user id and displayName', async () => {
    service.update.mockResolvedValue({ id: 7, displayName: 'x' });
    const res = await request(app.getHttpServer())
      .patch('/user')
      .send({ id: 999, displayName: 'x', email: 'evil' });
    expect(res.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith({ id: 7, displayName: 'x' });
  });

  it('PATCH without a displayName does not save', async () => {
    const res = await request(app.getHttpServer()).patch('/user').send({ id: 999, email: 'evil' });
    expect(res.status).toBe(200);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('PATCH gives 404 when there is no user', async () => {
    user = undefined;
    expect((await request(app.getHttpServer()).patch('/user').send({ displayName: 'x' })).status).toBe(404);
    expect(service.update).not.toHaveBeenCalled();
  });
});
