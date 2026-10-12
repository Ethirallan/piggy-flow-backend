import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

describe('ShopController', () => {
  let app: INestApplication;
  let user: any;
  const service = { create: jest.fn(), updateAsMember: jest.fn(), removeAsMember: jest.fn(), listForUser: jest.fn(), copy: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopController],
      providers: [{ provide: ShopService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    // Same options as main.ts.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // Stand-in for the auth middleware.
    app.use((req: any, _res: any, next: () => void) => {
      req.user = user;
      next();
    });
    await app.init();
  });

  afterEach(() => app.close());

  it('PATCH passes the request user id', async () => {
    service.updateAsMember.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).patch('/shop/5').send({ name: 'Lidl' });
    expect(res.status).toBe(200);
    expect(service.updateAsMember).toHaveBeenCalledWith(5, 7, { name: 'Lidl' });
  });

  it('DELETE passes the request user id', async () => {
    service.removeAsMember.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).delete('/shop/5');
    expect(res.status).toBe(200);
    expect(service.removeAsMember).toHaveBeenCalledWith(5, 7);
  });

  it('PATCH and DELETE give 404 when there is no user', async () => {
    user = undefined;
    expect((await request(app.getHttpServer()).patch('/shop/5').send({ name: 'x' })).status).toBe(404);
    expect((await request(app.getHttpServer()).delete('/shop/5')).status).toBe(404);
    expect(service.updateAsMember).not.toHaveBeenCalled();
    expect(service.removeAsMember).not.toHaveBeenCalled();
  });

  it('a 409 from the service reaches the client', async () => {
    service.removeAsMember.mockRejectedValue(new ConflictException('In use'));
    const res = await request(app.getHttpServer()).delete('/shop/5');
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('In use');
  });

  it('GET /shop lists all the user\'s shops, GET /shop?account=3 one account', async () => {
    service.listForUser.mockResolvedValue([]);
    expect((await request(app.getHttpServer()).get('/shop')).status).toBe(200);
    expect(service.listForUser).toHaveBeenLastCalledWith(7, undefined);
    expect((await request(app.getHttpServer()).get('/shop?account=3')).status).toBe(200);
    expect(service.listForUser).toHaveBeenLastCalledWith(7, 3);
  });

  it('GET /shop?account=abc gives 400', async () => {
    expect((await request(app.getHttpServer()).get('/shop?account=abc')).status).toBe(400);
    expect(service.listForUser).not.toHaveBeenCalled();
  });

  it('GET /shop/getShopsByUser is gone (404)', async () => {
    const res = await request(app.getHttpServer()).get('/shop/getShopsByUser');
    expect(res.status).toBe(404);
    expect(service.listForUser).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ account: null }], [{ account: '' }]])('POST without an account %j gives 400 before the service', async (body) => {
    const res = await request(app.getHttpServer()).post('/shop').send({ name: 'Lidl', ...body });
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('POST /shop/:id/copy passes the user and the body', async () => {
    service.copy.mockResolvedValue({ id: 50 });
    const res = await request(app.getHttpServer()).post('/shop/5/copy').send({ account: { id: 9 } });
    expect(res.status).toBe(201);
    expect(service.copy).toHaveBeenCalledWith(5, { id: 7 }, { account: { id: 9 } });
  });

  it('POST keeps account: { id } through the whitelist and sets user from the request', async () => {
    service.create.mockResolvedValue({ id: 1 });
    const res = await request(app.getHttpServer()).post('/shop').send({ name: 'Lidl', account: { id: 9 }, id: 99, junk: 1 });
    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lidl', account: { id: 9 }, user: { id: 7 } }));
    expect(service.create.mock.calls[0][0]).not.toHaveProperty('junk');
  });

  it('PATCH with an empty name gives 400 before the service', async () => {
    const res = await request(app.getHttpServer()).patch('/shop/5').send({ name: '' });
    expect(res.status).toBe(400);
    expect(service.updateAsMember).not.toHaveBeenCalled();
  });

  it.each([['   '], ['\t ']])('PATCH with a blank name %j gives 400 before the service', async (name) => {
    const res = await request(app.getHttpServer()).patch('/shop/5').send({ name });
    expect(res.status).toBe(400);
    expect(service.updateAsMember).not.toHaveBeenCalled();
  });

  it.each([[''], ['   ']])('POST with a blank name %j gives 400 before the service', async (name) => {
    const res = await request(app.getHttpServer()).post('/shop').send({ name });
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('POST and PATCH trim the name before the service', async () => {
    service.create.mockResolvedValue({ id: 1 });
    service.updateAsMember.mockResolvedValue({ affected: 1 });
    expect((await request(app.getHttpServer()).post('/shop').send({ name: '  Lidl  ', account: { id: 9 } })).status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lidl' }));
    expect((await request(app.getHttpServer()).patch('/shop/5').send({ name: '  Lidl  ' })).status).toBe(200);
    expect(service.updateAsMember).toHaveBeenCalledWith(5, 7, { name: 'Lidl' });
  });
});
