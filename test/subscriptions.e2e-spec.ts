import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  initialLastChargedMonth,
  localToday,
  nextChargeDate,
} from '../src/subscriptions/charge-schedule.js';
import { SubscriptionChargerService } from '../src/subscriptions/subscription-charger.service.js';
import {
  asUser,
  createTestApp,
  registerUser,
  resetDatabase,
} from './helpers.js';

type As = ReturnType<typeof asUser>;

describe('subscriptions (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const personalAccountId = async (as: As) =>
    ((await as.get('/accounts').expect(200)).body as { id: string }[])[0].id;
  const expectedNext = (chargeDay: number) =>
    nextChargeDate(initialLastChargedMonth(chargeDay, localToday()), chargeDay);

  it('creates, reads, lists, changes and deletes a subscription', async () => {
    const registered = await registerUser(app);
    const ana = asUser(app, registered.accessToken);
    const accountId = await personalAccountId(ana);

    const created = await ana
      .post('/subscriptions')
      .send({ accountId, priceCents: 1299, chargeDay: 31, name: ' Streaming ' })
      .expect(201);

    expect(created.body).toEqual({
      id: expect.any(String),
      name: 'Streaming',
      priceCents: 1299,
      chargeDay: 31,
      nextChargeDate: expectedNext(31),
      account: { id: accountId, name: 'Personal' },
      shop: null,
      category: null,
      createdBy: { userId: registered.user.id, displayName: 'Ana' },
      updatedBy: { userId: registered.user.id, displayName: 'Ana' },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    const id = created.body.id as string;
    await ana.get(`/subscriptions/${id}`).expect(200);
    expect((await ana.get('/subscriptions').expect(200)).body).toHaveLength(1);
    const changed = await ana
      .patch(`/subscriptions/${id}`)
      .send({ priceCents: 1499, name: null })
      .expect(200);
    expect(changed.body).toMatchObject({ priceCents: 1499, name: null });
    await ana.delete(`/subscriptions/${id}`).expect(204);
    await ana.get(`/subscriptions/${id}`).expect(404);
  });

  it.each([
    ['a zero price', { priceCents: 0 }],
    ['a fractional price', { priceCents: 9.99 }],
    ['day 0', { chargeDay: 0 }],
    ['day 32', { chargeDay: 32 }],
    ['a 101-character name', { name: 'a'.repeat(101) }],
    ['an unknown field', { lastChargedMonth: '2026-01-01' }],
  ])('answers 400 for %s', async (_case, override) => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const accountId = await personalAccountId(ana);

    await ana
      .post('/subscriptions')
      .send({
        accountId,
        priceCents: 100,
        chargeDay: 1,
        ...override,
      })
      .expect(400);
  });

  it.each([
    ['an empty body', {}],
    ['a null price', { priceCents: null }],
    ['a null charge day', { chargeDay: null }],
    ['a null account', { accountId: null }],
  ])('answers 400 to PATCH with %s', async (_case, body) => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const accountId = await personalAccountId(ana);
    const { id } = (
      await ana
        .post('/subscriptions')
        .send({
          accountId,
          priceCents: 100,
          chargeDay: 1,
        })
        .expect(201)
    ).body as { id: string };

    await ana.patch(`/subscriptions/${id}`).send(body).expect(400);
  });

  it("answers 404 for someone else's account and subscription, and 400 for a malformed id", async () => {
    const ana = asUser(
      app,
      (await registerUser(app, 'ana@example.com')).accessToken,
    );
    const bob = asUser(
      app,
      (await registerUser(app, 'bob@example.com', 'Bob')).accessToken,
    );
    const anas = await personalAccountId(ana);
    const { id } = (
      await ana
        .post('/subscriptions')
        .send({ accountId: anas, priceCents: 100, chargeDay: 1 })
        .expect(201)
    ).body as { id: string };

    await bob
      .post('/subscriptions')
      .send({ accountId: anas, priceCents: 100, chargeDay: 1 })
      .expect(404);
    await bob.get(`/subscriptions?accountId=${anas}`).expect(404);
    await bob.get(`/subscriptions/${id}`).expect(404);
    await bob.patch(`/subscriptions/${id}`).send({ priceCents: 1 }).expect(404);
    await bob.delete(`/subscriptions/${id}`).expect(404);
    await bob.get(`/subscriptions/${randomUUID()}`).expect(404);
    await ana.get('/subscriptions/123').expect(400);
    await request(app.getHttpServer()).get('/subscriptions').expect(401);
  });

  it('links generated bills to their subscription', async () => {
    const ana = asUser(app, (await registerUser(app)).accessToken);
    const accountId = await personalAccountId(ana);
    const shop = (
      await ana
        .post(`/accounts/${accountId}/shops`)
        .send({ name: 'Netflix' })
        .expect(201)
    ).body as { id: string };
    const subscription = (
      await ana
        .post('/subscriptions')
        .send({
          accountId,
          priceCents: 1299,
          chargeDay: 15,
          name: 'Streaming',
          shopId: shop.id,
        })
        .expect(201)
    ).body as { id: string; nextChargeDate: string };

    expect(
      await app
        .get(SubscriptionChargerService)
        .run(subscription.nextChargeDate),
    ).toBe(1);

    const bills = (await ana.get('/bills').expect(200)).body as {
      items: { id: string }[];
    };
    expect(bills.items).toEqual([
      expect.objectContaining({
        subscriptionId: subscription.id,
        comment: 'Streaming',
        priceCents: 1299,
        shop: { id: shop.id, name: 'Netflix' },
        createdBy: null,
      }),
    ]);
    // The generated bill uses the shop too, and bills are checked first.
    const deleteShop = () =>
      ana.delete(`/accounts/${accountId}/shops/${shop.id}`).expect(409);
    expect((await deleteShop()).body).toMatchObject({
      message: 'Shop is in use by bills',
    });
    await ana.delete(`/bills/${bills.items[0].id}`).expect(204);
    expect((await deleteShop()).body).toMatchObject({
      message: 'Shop is in use by subscriptions',
    });
  });
});
