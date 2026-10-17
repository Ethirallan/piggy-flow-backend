import type { INestApplication } from '@nestjs/common';
import {
  asUser,
  createTestApp,
  registerUser,
  resetDatabase,
} from './helpers.js';

describe('account members (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(() => app.close());

  beforeEach(() => resetDatabase(app));

  /** Ana with a shared "Home" account, and Bob, who isn't in it yet. */
  const setupHome = async () => {
    const ana = await registerUser(app, 'ana@example.com', 'Ana');
    const bob = await registerUser(app, 'bob@example.com', 'Bob');
    const asAna = asUser(app, ana.accessToken);
    const asBob = asUser(app, bob.accessToken);
    const home = await asAna.post('/accounts').send({ name: 'Home' });
    return { ana, bob, asAna, asBob, homeId: (home.body as { id: string }).id };
  };

  const memberEmails = async (
    as: ReturnType<typeof asUser>,
    accountId: string,
  ) =>
    (
      (await as.get(`/accounts/${accountId}`).expect(200)).body.members as {
        email: string;
      }[]
    ).map((member) => member.email);

  describe('POST /accounts/:id/members', () => {
    it('adds a registered user by email in any case, who then sees the account', async () => {
      const { bob, asAna, asBob, homeId } = await setupHome();

      const res = await asAna
        .post(`/accounts/${homeId}/members`)
        .send({ email: ' BOB@Example.com ' })
        .expect(201);

      expect(res.body).toEqual({
        userId: bob.user.id,
        displayName: 'Bob',
        email: 'bob@example.com',
        joinedAt: expect.any(String),
      });
      const bobsAccounts = (await asBob.get('/accounts')).body as {
        name: string;
      }[];
      expect(bobsAccounts.map((a) => a.name)).toEqual(['Personal', 'Home']);
      expect(await memberEmails(asBob, homeId)).toEqual([
        'ana@example.com',
        'bob@example.com',
      ]);
    });

    it('answers 404 for an email nobody registered', async () => {
      const { asAna, homeId } = await setupHome();

      const res = await asAna
        .post(`/accounts/${homeId}/members`)
        .send({ email: 'carol@example.com' })
        .expect(404);

      expect(res.body.message).toBe('No user with that email');
    });

    it('answers 409 for someone who is already a member, the caller included', async () => {
      const { asAna, homeId } = await setupHome();
      await asAna
        .post(`/accounts/${homeId}/members`)
        .send({ email: 'bob@example.com' })
        .expect(201);

      await asAna
        .post(`/accounts/${homeId}/members`)
        .send({ email: 'bob@example.com' })
        .expect(409);
      await asAna
        .post(`/accounts/${homeId}/members`)
        .send({ email: 'ana@example.com' })
        .expect(409);
    });

    it('answers 409 for the Personal account, whether or not the email exists', async () => {
      const { asAna } = await setupHome();
      const [personal] = (await asAna.get('/accounts')).body as {
        id: string;
      }[];

      const res = await asAna
        .post(`/accounts/${personal.id}/members`)
        .send({ email: 'bob@example.com' })
        .expect(409);
      await asAna
        .post(`/accounts/${personal.id}/members`)
        .send({ email: 'nobody@example.com' })
        .expect(409);

      expect(res.body.message).toBe("The Personal account can't be shared");
    });

    it('answers 404 when the caller is not a member, and adds nobody', async () => {
      const { asAna, asBob, homeId } = await setupHome();

      await asBob
        .post(`/accounts/${homeId}/members`)
        .send({ email: 'bob@example.com' })
        .expect(404);

      expect(await memberEmails(asAna, homeId)).toEqual(['ana@example.com']);
    });

    it('answers 400 for an invalid email', async () => {
      const { asAna, homeId } = await setupHome();

      await asAna
        .post(`/accounts/${homeId}/members`)
        .send({ email: 'not-an-email' })
        .expect(400);
    });
  });
});
