import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';

describe('ShopController', () => {
  let app: INestApplication;
  let user: any;
  const service = { create: jest.fn(), updateOwned: jest.fn(), removeOwned: jest.fn(), listForUser: jest.fn(), copy: jest.fn() };

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
    service.updateOwned.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).patch('/shop/5').send({ name: 'Lidl' });
    expect(res.status).toBe(200);
    expect(service.updateOwned).toHaveBeenCalledWith(5, 7, { name: 'Lidl' });
  });

  it('DELETE passes the request user id', async () => {
    service.removeOwned.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).delete('/shop/5');
    expect(res.status).toBe(200);
    expect(service.removeOwned).toHaveBeenCalledWith(5, 7);
  });

  it('PATCH and DELETE give 404 when there is no user', async () => {
    user = undefined;
    expect((await request(app.getHttpServer()).patch('/shop/5').send({ name: 'x' })).status).toBe(404);
    expect((await request(app.getHttpServer()).delete('/shop/5')).status).toBe(404);
    expect(service.updateOwned).not.toHaveBeenCalled();
    expect(service.removeOwned).not.toHaveBeenCalled();
  });

  it('a 409 from the service reaches the client', async () => {
    service.removeOwned.mockRejectedValue(new ConflictException('In use'));
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

  it('GET /shop/getShopsByUser lists like GET /shop', async () => {
    service.listForUser.mockResolvedValue([{ id: 1 }]);
    const res = await request(app.getHttpServer()).get('/shop/getShopsByUser');
    expect(res.status).toBe(200);
    expect(service.listForUser).toHaveBeenCalledWith(7);
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
    expect(service.updateOwned).not.toHaveBeenCalled();
  });

  it('PATCH with a whitespace-only name passes the pipe (IsNotEmpty only rejects \'\') and is left to the service', async () => {
    service.updateOwned.mockResolvedValue({ affected: 1 });
    const res = await request(app.getHttpServer()).patch('/shop/5').send({ name: '   ' });
    expect(res.status).toBe(200);
    expect(service.updateOwned).toHaveBeenCalledWith(5, 7, { name: '   ' });
  });
});
