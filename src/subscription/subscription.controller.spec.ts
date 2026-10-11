import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { BillService } from '../bill/bill.service';

describe('SubscriptionController', () => {
  let app: INestApplication;
  let user: any;
  const service = { createOwned: jest.fn(), getSubscriptionById: jest.fn(), getOwned: jest.fn(), updateOwned: jest.fn(), removeOwned: jest.fn(), getSubscriptionsByDay: jest.fn() };
  const bills = { create: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        { provide: SubscriptionService, useValue: service },
        { provide: BillService, useValue: bills },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = user;
      next();
    });
    await app.init();
  });

  afterEach(() => app.close());

  it('details, PATCH and DELETE pass the request user id', async () => {
    service.getOwned.mockResolvedValue({ id: 5 });
    service.updateOwned.mockResolvedValue({ affected: 1 });
    service.removeOwned.mockResolvedValue({ affected: 1 });
    const http = app.getHttpServer();
    expect((await request(http).get('/subscription/getSubscriptionDetails/5')).status).toBe(200);
    expect((await request(http).patch('/subscription/5').send({ price: 3 })).status).toBe(200);
    expect((await request(http).delete('/subscription/5')).status).toBe(200);
    expect(service.getOwned).toHaveBeenCalledWith(5, 7);
    expect(service.updateOwned).toHaveBeenCalledWith(5, 7, { price: 3 });
    expect(service.removeOwned).toHaveBeenCalledWith(5, 7);
  });

  it('a non-numeric id gives 400', async () => {
    expect((await request(app.getHttpServer()).patch('/subscription/abc').send({})).status).toBe(400);
  });

  it('gives 404 when there is no user', async () => {
    user = undefined;
    const http = app.getHttpServer();
    expect((await request(http).get('/subscription/getSubscriptionDetails/5')).status).toBe(404);
    expect((await request(http).patch('/subscription/5').send({ price: 3 })).status).toBe(404);
    expect((await request(http).delete('/subscription/5')).status).toBe(404);
    expect(service.getOwned).not.toHaveBeenCalled();
    expect(service.updateOwned).not.toHaveBeenCalled();
    expect(service.removeOwned).not.toHaveBeenCalled();
  });

  it('POST checks the target account through the service and saves the request user as owner', async () => {
    service.createOwned.mockResolvedValue({ id: 9 });
    service.getSubscriptionById.mockResolvedValue({ id: 9 });
    const res = await request(app.getHttpServer())
      .post('/subscription')
      .send({ chargeDay: 1, price: 2, shop: { id: 1 }, category: { id: 1 }, account: { id: 4 } });
    expect(res.status).toBe(201);
    expect(service.createOwned).toHaveBeenCalledWith(7, expect.objectContaining({ account: { id: 4 }, user: { id: 7 } }));
  });

  it('POST gives 404 when the service rejects the target account', async () => {
    service.createOwned.mockRejectedValue(new NotFoundException());
    const res = await request(app.getHttpServer())
      .post('/subscription')
      .send({ chargeDay: 1, price: 2, shop: { id: 1 }, category: { id: 1 }, account: { id: 4 } });
    expect(res.status).toBe(404);
  });

  describe('insertSubscriptions', () => {
    const OLD_SECRET = process.env.CRON_SECRET;
    beforeEach(() => (process.env.CRON_SECRET = 's3cret'));
    afterAll(() => (process.env.CRON_SECRET = OLD_SECRET));

    const sub = (id: number) => ({ id, user: { id: 7 }, account: null, shop: { id: 1 }, category: { id: 2 }, price: 3, name: `s${id}` });

    it('creates the bills one after another, never in parallel', async () => {
      service.getSubscriptionsByDay.mockResolvedValue([sub(1), sub(2)]);
      const events: string[] = [];
      bills.create.mockImplementation(async (dto: any) => {
        events.push(`start ${dto.comment}`);
        await new Promise((r) => setTimeout(r, 5));
        events.push(`end ${dto.comment}`);
        return { id: 1 };
      });
      const res = await request(app.getHttpServer()).get('/subscription/insertSubscriptions/s3cret');
      expect(res.status).toBe(200);
      expect(events).toEqual(['start s1', 'end s1', 'start s2', 'end s2']);
      expect(bills.create).toHaveBeenCalledWith(expect.objectContaining({ user: { id: 7 }, account: null, comment: 's1' }));
    });

    it('a failing create makes the endpoint fail (500) instead of an unhandled rejection', async () => {
      service.getSubscriptionsByDay.mockResolvedValue([sub(1), sub(2)]);
      bills.create.mockRejectedValueOnce(new Error('db down')).mockResolvedValue({ id: 1 });
      const res = await request(app.getHttpServer()).get('/subscription/insertSubscriptions/s3cret');
      expect(res.status).toBe(500);
      expect(bills.create).toHaveBeenCalledTimes(1);
    });

    it('gives 404 for a wrong secret and creates nothing', async () => {
      const res = await request(app.getHttpServer()).get('/subscription/insertSubscriptions/wrong');
      expect(res.status).toBe(404);
      expect(service.getSubscriptionsByDay).not.toHaveBeenCalled();
      expect(bills.create).not.toHaveBeenCalled();
    });
  });
});
