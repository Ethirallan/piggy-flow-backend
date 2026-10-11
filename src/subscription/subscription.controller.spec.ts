import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { BillService } from '../bill/bill.service';

describe('SubscriptionController', () => {
  let app: INestApplication;
  let user: any;
  const service = { getOwned: jest.fn(), updateOwned: jest.fn(), removeOwned: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    user = { id: 7 };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [
        { provide: SubscriptionService, useValue: service },
        { provide: BillService, useValue: {} },
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
});
