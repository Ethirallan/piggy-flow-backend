import { BadRequestException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

describe('AccountController', () => {
  let app: INestApplication;
  let user: any;
  const service = { create: jest.fn(), updateMember: jest.fn(), removeMember: jest.fn(), getAccountsByUserId: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [{ provide: AccountService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = user;
      next();
    });
    await app.init();
  });

  afterEach(() => app.close());

  it('PATCH passes the request user id', async () => {
    service.updateMember.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).patch('/account/5').send({ name: 'Home' });
    expect(res.status).toBe(200);
    expect(service.updateMember).toHaveBeenCalledWith(5, 7, { name: 'Home' });
  });

  it('DELETE passes the request user id', async () => {
    service.removeMember.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).delete('/account/5');
    expect(res.status).toBe(200);
    expect(service.removeMember).toHaveBeenCalledWith(5, 7);
  });

  it('PATCH and DELETE give 404 when there is no user', async () => {
    user = undefined;
    expect((await request(app.getHttpServer()).patch('/account/5').send({ name: 'x' })).status).toBe(404);
    expect((await request(app.getHttpServer()).delete('/account/5')).status).toBe(404);
    expect(service.updateMember).not.toHaveBeenCalled();
    expect(service.removeMember).not.toHaveBeenCalled();
  });

  it('the list passes the request user id, and gives 404 without a user', async () => {
    service.getAccountsByUserId.mockResolvedValue([{ id: 1 }]);
    expect((await request(app.getHttpServer()).get('/account/getAccountsByUser')).body).toEqual([{ id: 1 }]);
    expect(service.getAccountsByUserId).toHaveBeenCalledWith(7);
    user = undefined;
    expect((await request(app.getHttpServer()).get('/account/getAccountsByUser')).status).toBe(404);
    expect(service.getAccountsByUserId).toHaveBeenCalledTimes(1);
  });

  it('DELETE of the Personal account gives the 400 message', async () => {
    service.removeMember.mockRejectedValue(new BadRequestException("The Personal account can't be deleted."));
    const res = await request(app.getHttpServer()).delete('/account/5');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("The Personal account can't be deleted.");
  });

  it('a 404 from the service reaches the client', async () => {
    service.removeMember.mockRejectedValue(new NotFoundException());
    expect((await request(app.getHttpServer()).delete('/account/5')).status).toBe(404);
  });

  it('POST ignores users in the body and saves only the caller as member', async () => {
    service.create.mockResolvedValue({ id: 1 });
    const res = await request(app.getHttpServer())
      .post('/account')
      .send({ name: 'Home', users: [{ id: 99 }] });
    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create.mock.calls[0][0].users).toEqual([{ id: 7 }]);
    expect(service.create.mock.calls[0][0].name).toBe('Home');
  });

  it('POST gives 404 without a request user', async () => {
    user = undefined;
    const res = await request(app.getHttpServer()).post('/account').send({ name: 'Home' });
    expect(res.status).toBe(404);
    expect(service.create).not.toHaveBeenCalled();
  });
});
