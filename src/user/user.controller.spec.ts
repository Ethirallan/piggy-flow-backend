import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PersonalAccountService } from 'src/account/personal-account.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let app: INestApplication;
  let user: any;
  const service = { findOne: jest.fn(), update: jest.fn(), create: jest.fn(), getUserByUid: jest.fn() };
  const personal = { ensurePersonal: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: service },
        { provide: PersonalAccountService, useValue: personal },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = user;
      req.fireUser = { uid: 'u1', email: 'a@b.c', name: 'A' };
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

  it('login creates a new user and ensures their Personal account', async () => {
    user = null;
    service.getUserByUid.mockResolvedValue({ id: 12, uid: 'u1' });
    personal.ensurePersonal.mockResolvedValue({ id: 3 });
    const res = await request(app.getHttpServer()).get('/user/login');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 12, uid: 'u1' });
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1', email: 'a@b.c', displayName: 'A' }));
    expect(personal.ensurePersonal).toHaveBeenCalledWith(12);
  });

  it('login ensures the Personal account of an existing user', async () => {
    user = { id: 7, uid: 'u7' };
    service.getUserByUid.mockResolvedValue({ id: 7, uid: 'u7' });
    personal.ensurePersonal.mockResolvedValue({ id: 3 });
    const res = await request(app.getHttpServer()).get('/user/login');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, uid: 'u7' });
    expect(service.create).not.toHaveBeenCalled();
    expect(personal.ensurePersonal).toHaveBeenCalledWith(7);
  });
});
