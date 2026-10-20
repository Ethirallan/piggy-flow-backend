import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  asUser,
  createTestApp,
  registerUser,
  resetDatabase,
} from './helpers.js';

type As = ReturnType<typeof asUser>;

interface BillBody {
  id: string;
  date: string;
  priceCents: number;
}

describe('bills (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  const personalAccountId = async (as: As) =>
    ((await as.get('/accounts').expect(200)).body as { id: string }[])[0].id;
  const createAccount = async (as: As, name: string) =>
    (
      (await as.post('/accounts').send({ name }).expect(201)).body as {
        id: string;
      }
    ).id;
  const createBill = async (as: As, body: object) =>
    (await as.post('/bills').send(body).expect(201)).body as BillBody;

  describe('POST /bills and GET /bills/:id', () => {
    it('creates a bill and reads it back in UTC with its names', async () => {
      const registered = await registerUser(app);
      const ana = asUser(app, registered.accessToken);
      const accountId = await personalAccountId(ana);
      const shop = (
        await ana.post(`/accounts/${accountId}/shops`).send({ name: 'Lidl' })
      ).body as { id: string };

      const created = await createBill(ana, {
        accountId,
        date: '2026-10-16T13:26:00+02:00',
        priceCents: 1250,
        shopId: shop.id,
        comment: ' weekly ',
      });
      const res = await ana.get(`/bills/${created.id}`).expect(200);

      expect(res.body).toEqual({
        id: created.id,
        date: '2026-10-16T11:26:00.000Z',
        priceCents: 1250,
        comment: 'weekly',
        account: { id: accountId, name: 'Personal' },
        shop: { id: shop.id, name: 'Lidl' },
        category: null,
        createdBy: { userId: registered.user.id, displayName: 'Ana' },
        updatedBy: { userId: registered.user.id, displayName: 'Ana' },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        subscriptionId: null,
        photos: [],
      });
    });

    it.each([
      ['a date without an offset', { date: '2026-10-16T13:26:00.000' }],
      ['a date only', { date: '2026-10-16' }],
      ['a zero price', { priceCents: 0 }],
      ['a fractional price', { priceCents: 12.5 }],
      ['a price in euros as a string', { priceCents: '12.50' }],
      ['a 1001-character comment', { comment: 'a'.repeat(1001) }],
      ['a malformed shop id', { shopId: 'nope' }],
      ['an unknown field', { userId: randomUUID() }],
    ])('answers 400 for %s', async (_case, override) => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);

      await ana
        .post('/bills')
        .send({
          accountId,
          date: '2026-10-16T13:26:00+02:00',
          priceCents: 100,
          ...override,
        })
        .expect(400);
    });

    it('counts the comment limit in code points, like the database', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const accountId = await personalAccountId(ana);
      const body = {
        accountId,
        date: '2026-10-16T13:26:00+02:00',
        priceCents: 100,
      };

      // '❤️' is two code points (heart + variation selector).
      await ana
        .post('/bills')
        .send({ ...body, comment: '❤️'.repeat(501) })
        .expect(400);
      await ana
        .post('/bills')
        .send({ ...body, comment: '❤️'.repeat(500) })
        .expect(201);
    });

    it('answers 400 for a shop from another account', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const personal = await personalAccountId(ana);
      const home = await createAccount(ana, 'Home');
      const shop = (
        await ana.post(`/accounts/${home}/shops`).send({ name: 'Spar' })
      ).body as { id: string };

      const res = await ana
        .post('/bills')
        .send({
          accountId: personal,
          date: '2026-10-16T13:26:00+02:00',
          priceCents: 100,
          shopId: shop.id,
        })
        .expect(400);

      expect(res.body.message).toBe('Shop is not in this account');
    });

    it("answers 404 for someone else's account and someone else's bill", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com', 'Bob')).accessToken,
      );
      const anas = await personalAccountId(ana);
      const bill = await createBill(ana, {
        accountId: anas,
        date: '2026-10-16T13:26:00+02:00',
        priceCents: 100,
      });

      await bob
        .post('/bills')
        .send({
          accountId: anas,
          date: '2026-10-16T13:26:00+02:00',
          priceCents: 100,
        })
        .expect(404);
      await bob.get(`/bills/${bill.id}`).expect(404);
      await bob.get(`/bills/${randomUUID()}`).expect(404);
      await bob.get('/bills/not-a-uuid').expect(400);
    });
  });

  describe('GET /bills', () => {
    it('lists a local month across accounts, filters by account, and pages', async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const personal = await personalAccountId(ana);
      const home = await createAccount(ana, 'Home');
      for (const [accountId, date] of [
        [personal, '2026-09-30T23:59:00+02:00'], // September
        [personal, '2026-10-01T00:00:00+02:00'],
        [home, '2026-10-16T13:26:00+02:00'],
        [personal, '2026-10-16T13:26:00+02:00'],
        [personal, '2026-11-01T00:00:00+01:00'], // November
      ]) {
        await createBill(ana, { accountId, date, priceCents: 100 });
      }
      const october =
        'from=2026-10-01T00:00:00%2B02:00&to=2026-11-01T00:00:00%2B01:00';

      const all = await ana.get(`/bills?${october}&all=true`).expect(200);
      const homeOnly = await ana
        .get(`/bills?${october}&accountId=${home}`)
        .expect(200);
      const first = await ana.get(`/bills?${october}&limit=2`).expect(200);
      const second = await ana
        .get(`/bills?${october}&limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);

      expect(all.body.items).toHaveLength(3);
      expect(all.body.nextCursor).toBeNull();
      expect(homeOnly.body.items).toHaveLength(1);
      expect(first.body.items).toHaveLength(2);
      expect(second.body).toMatchObject({ nextCursor: null });
      expect(
        [...first.body.items, ...second.body.items].map((b: BillBody) => b.id),
      ).toEqual(all.body.items.map((b: BillBody) => b.id));
    });

    it.each([
      ['a cursor with all', 'all=true&cursor=abc'],
      ['from after to', 'from=2026-11-01T00:00:00Z&to=2026-10-01T00:00:00Z'],
      ['a from without an offset', 'from=2026-10-01T00:00:00'],
      ['a limit of 101', 'limit=101'],
      ['a limit of 0', 'limit=0'],
      ['all=yes', 'all=yes'],
      ['a garbage cursor', 'cursor=garbage'],
      ['an unknown parameter', 'sort=price'],
    ])('answers 400 for %s', async (_case, query) => {
      const ana = asUser(app, (await registerUser(app)).accessToken);

      await ana.get(`/bills?${query}`).expect(400);
    });

    it("answers 404 for someone else's account and 401 without a token", async () => {
      const ana = asUser(
        app,
        (await registerUser(app, 'ana@example.com')).accessToken,
      );
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com', 'Bob')).accessToken,
      );

      await bob
        .get(`/bills?accountId=${await personalAccountId(ana)}`)
        .expect(404);
      await request(app.getHttpServer()).get('/bills').expect(401);
    });
  });

  describe('PATCH and DELETE /bills/:id', () => {
    const setup = async () => {
      const ana = asUser(app, (await registerUser(app)).accessToken);
      const personal = await personalAccountId(ana);
      const home = await createAccount(ana, 'Home');
      const shop = (
        await ana.post(`/accounts/${personal}/shops`).send({ name: 'Lidl' })
      ).body as { id: string };
      const bill = await createBill(ana, {
        accountId: personal,
        date: '2026-10-16T13:26:00+02:00',
        priceCents: 100,
        shopId: shop.id,
      });
      return { ana, personal, home, shop, bill };
    };

    it('changes the price and date, and clears the shop with null', async () => {
      const { ana, bill } = await setup();

      const res = await ana
        .patch(`/bills/${bill.id}`)
        .send({ priceCents: -250, date: '2026-10-17T08:00:00Z', shopId: null })
        .expect(200);

      expect(res.body).toMatchObject({
        priceCents: -250,
        date: '2026-10-17T08:00:00.000Z',
        shop: null,
      });
    });

    it('answers 400 when moving a bill but keeping a shop from the old account', async () => {
      const { ana, home, bill } = await setup();

      const res = await ana
        .patch(`/bills/${bill.id}`)
        .send({ accountId: home })
        .expect(400);
      const moved = await ana
        .patch(`/bills/${bill.id}`)
        .send({ accountId: home, shopId: null })
        .expect(200);

      expect(res.body.message).toBe('Shop is not in this account');
      expect(moved.body.account).toEqual({ id: home, name: 'Home' });
    });

    it.each([
      ['an empty body', {}],
      ['a null price', { priceCents: null }],
      ['a null date', { date: null }],
      ['a null account', { accountId: null }],
      ['a date without an offset', { date: '2026-10-17T08:00:00' }],
      ['a zero price', { priceCents: 0 }],
    ])('answers 400 for %s', async (_case, body) => {
      const { ana, bill } = await setup();

      await ana.patch(`/bills/${bill.id}`).send(body).expect(400);
    });

    it('deletes a bill; a second delete answers 404', async () => {
      const { ana, bill } = await setup();

      await ana.delete(`/bills/${bill.id}`).expect(204);
      await ana.delete(`/bills/${bill.id}`).expect(404);
      await ana.get(`/bills/${bill.id}`).expect(404);
    });

    it("answers 404 for someone else's bill and 400 for a malformed id", async () => {
      const { bill } = await setup();
      const bob = asUser(
        app,
        (await registerUser(app, 'bob@example.com', 'Bob')).accessToken,
      );

      await bob.patch(`/bills/${bill.id}`).send({ priceCents: 5 }).expect(404);
      await bob.delete(`/bills/${bill.id}`).expect(404);
      await bob.delete('/bills/123').expect(400);
    });
  });
});
