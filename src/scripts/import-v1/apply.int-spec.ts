import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { createIntegrationModule, truncateTables } from '../../../test/db.js';
import { AccountsService } from '../../accounts/accounts.service.js';
import { BillsModule } from '../../bills/bills.module.js';
import { BillsService } from '../../bills/bills.service.js';
import { CategoriesModule } from '../../categories/categories.module.js';
import { PhotoStorage } from '../../photos/photo-storage.js';
import { ShopsModule } from '../../shops/shops.module.js';
import { SubscriptionsModule } from '../../subscriptions/subscriptions.module.js';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service.js';
import { UsersService } from '../../users/users.service.js';
import {
  applyPlan,
  assertV2Empty,
  checkSources,
  ImportError,
  loadV2Users,
} from './apply.js';
import { parseDump } from './parse-dump.js';
import { planImport } from './plan.js';
import { toSnapshot } from './v1-snapshot.js';

const DUMP = `-- synthetic v1 dump
CREATE TABLE \`user\` (\`id\` int);
INSERT INTO \`user\` (\`id\`, \`uid\`, \`email\`, \`displayName\`, \`created\`, \`lastUpdate\`) VALUES
(1, 'u1', 'ana@example.com', 'Ana', '2025-01-01 10:00:00.000000', '2025-01-01 10:00:00.000000');
CREATE TABLE \`account\` (\`id\` int);
INSERT INTO \`account\` (\`id\`, \`name\`, \`created\`, \`lastUpdate\`) VALUES
(1, 'Car', '2025-01-01 10:00:00.000000', '2025-01-02 10:00:00.000000');
CREATE TABLE \`user_accounts_account\` (\`userId\` int);
INSERT INTO \`user_accounts_account\` (\`userId\`, \`accountId\`) VALUES (1, 1);
CREATE TABLE \`shop\` (\`id\` int);
INSERT INTO \`shop\` (\`id\`, \`name\`, \`created\`, \`lastUpdate\`, \`userId\`) VALUES
(1, 'Petrol', '2025-01-01 10:00:00.000000', '2025-01-01 10:00:00.000000', 1);
CREATE TABLE \`category\` (\`id\` int);
INSERT INTO \`category\` (\`id\`, \`name\`, \`created\`, \`lastUpdate\`, \`userId\`, \`emoji\`) VALUES
(1, 'Fuel', '2025-01-01 10:00:00.000000', '2025-01-01 10:00:00.000000', 1, '⛽');
CREATE TABLE \`bill\` (\`id\` int);
INSERT INTO \`bill\` (\`id\`, \`date\`, \`price\`, \`comment\`, \`created\`, \`lastUpdate\`, \`userId\`, \`accountId\`, \`shopId\`, \`categoryId\`) VALUES
(1, '2025-07-10 13:05:00', 27.62, 'it\\'s fuel', '2025-07-12 08:00:00.000000', '2025-07-12 08:00:00.000000', 1, 1, 1, 1),
(2, '2026-10-04 06:00:02', 9.99, 'Netflix', '2026-10-04 06:00:02.200000', '2026-10-04 06:00:02.200000', 1, NULL, NULL, NULL);
CREATE TABLE \`bill_photo\` (\`id\` int);
INSERT INTO \`bill_photo\` (\`id\`, \`name\`, \`path\`, \`blurhash\`, \`created\`, \`billId\`) VALUES
(1, 'IMG_1.jpg', 'p1.jpg', 'x', '2025-07-12 08:00:00.000000', 1);
CREATE TABLE \`subscription\` (\`id\` int);
INSERT INTO \`subscription\` (\`id\`, \`chargeDay\`, \`price\`, \`name\`, \`created\`, \`lastUpdate\`, \`userId\`, \`accountId\`, \`shopId\`, \`categoryId\`) VALUES
(1, 4, 9.99, 'Netflix', '2025-01-01 10:00:00.000000', '2025-01-01 10:00:00.000000', 1, NULL, NULL, NULL);
`;

describe('import-v1 apply (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let users: UsersService;
  let accounts: AccountsService;
  let source: string;
  let storageDir: string;
  let storage: PhotoStorage;

  const register = async (email: string) =>
    dataSource.transaction(async (manager) => {
      const user = await users.create(
        { email, displayName: 'Ana', passwordHash: 'hash' },
        manager,
      );
      await accounts.createPersonal(user.id, manager);
      return user;
    });
  const planFor = async (dump = DUMP) =>
    planImport(toSnapshot(parseDump(dump)), await loadV2Users(dataSource), {
      dismissedEmails: [],
      today: '2026-10-20',
    });

  beforeAll(async () => {
    moduleRef = await createIntegrationModule({
      imports: [
        BillsModule,
        SubscriptionsModule,
        ShopsModule,
        CategoriesModule,
      ],
    });
    await moduleRef.init();
    dataSource = moduleRef.get(DataSource);
    users = moduleRef.get(UsersService);
    accounts = moduleRef.get(AccountsService);
  });

  afterAll(() => moduleRef.close());

  beforeEach(async () => {
    await truncateTables(dataSource);
    source = await mkdtemp(join(tmpdir(), 'v1-uploads-'));
    storageDir = await mkdtemp(join(tmpdir(), 'v2-uploads-'));
    storage = new PhotoStorage(storageDir);
    await storage.onModuleInit();
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#c33' },
    })
      .jpeg()
      .toBuffer();
    await writeFile(join(source, 'p1.jpg'), jpeg);
    await writeFile(join(source, 'orphan.jpg'), jpeg);
  });

  const v2Files = async () =>
    (await readdir(storageDir)).filter((f) => f.endsWith('.jpg'));

  it('imports a dump end to end, readable through the v2 services', async () => {
    const ana = await register('ana@example.com');
    const plan = await planFor();

    expect(await checkSources(plan, source)).toEqual({
      unreferenced: ['orphan.jpg'],
    });
    const result = await applyPlan(dataSource, plan, source, storage);

    expect(result.photos).toBe(1);
    const page = await moduleRef.get(BillsService).list(ana.id, { all: true });
    expect(
      page.items.map((b) => [
        b.comment,
        b.priceCents,
        b.account?.name,
        b.shop?.name ?? null,
        b.category?.emoji ?? null,
      ]),
    ).toEqual([
      ['Netflix', 999, 'Personal', null, null],
      ["it's fuel", 2762, 'Car', 'Petrol', '⛽'],
    ]);
    // Mobile era, entered later: 13:05 Ljubljana summer time.
    expect(page.items[1].date.toISOString()).toBe('2025-07-10T11:05:00.000Z');
    // Timestamps come from v1, not from the insert.
    expect(page.items[1].createdAt.toISOString()).toBe(
      '2025-07-12T08:00:00.000Z',
    );
    expect(page.items[1].account!.createdAt.toISOString()).toBe(
      '2025-01-01T10:00:00.000Z',
    );
    expect(page.items[1].account!.updatedAt.toISOString()).toBe(
      '2025-01-02T10:00:00.000Z',
    );
    expect(page.items[1].photos).toHaveLength(1);
    expect(page.items[1].photos![0].createdAt.toISOString()).toBe(
      '2025-07-12T08:00:00.000Z',
    );
    const [photo] = page.items[1].photos!;
    expect(photo).toMatchObject({ name: 'IMG_1.jpg', width: 40, height: 30 });
    const file = await storage.open(photo.id);
    expect(file?.size).toBe(photo.sizeBytes);
    file?.stream.destroy();
    const [netflix] = await moduleRef.get(SubscriptionsService).list(ana.id);
    expect(netflix).toMatchObject({
      name: 'Netflix',
      priceCents: 999,
      lastChargedMonth: '2026-10-01',
    });
    expect(page.items[0].subscriptionId).toBe(netflix.id);
  });

  it('refuses a database that already has data, before writing anything', async () => {
    await register('ana@example.com');
    await applyPlan(dataSource, await planFor(), source, storage);
    const filesBefore = await v2Files();

    await expect(assertV2Empty(dataSource)).rejects.toThrow(ImportError);
    await expect(
      applyPlan(dataSource, await planFor(), source, storage),
    ).rejects.toThrow('The v2 database already has data');
    expect(await v2Files()).toEqual(filesBefore);
  });

  it('rolls back and deletes written photos when the totals check fails', async () => {
    await register('ana@example.com');
    const plan = await planFor();
    plan.expected[0].cents += 1;

    await expect(applyPlan(dataSource, plan, source, storage)).rejects.toThrow(
      'Totals differ',
    );
    expect(
      await dataSource.query('SELECT count(*)::int AS n FROM bills'),
    ).toEqual([{ n: 0 }]);
    expect(
      await dataSource.query(
        'SELECT count(*)::int AS n FROM accounts WHERE NOT is_personal',
      ),
    ).toEqual([{ n: 0 }]);
    expect(await v2Files()).toEqual([]);
  });

  it('rolls back and deletes written photos when a later photo can’t be decoded', async () => {
    await register('ana@example.com');
    const twoPhotos = DUMP.replace(
      "(1, 'IMG_1.jpg', 'p1.jpg', 'x', '2025-07-12 08:00:00.000000', 1);",
      "(1, 'IMG_1.jpg', 'p1.jpg', 'x', '2025-07-12 08:00:00.000000', 1),\n(2, 'bad.jpg', 'bad.jpg', 'x', '2025-07-12 08:00:00.000000', 1);",
    );
    await writeFile(join(source, 'bad.jpg'), 'not an image');
    const plan = await planFor(twoPhotos);

    await expect(applyPlan(dataSource, plan, source, storage)).rejects.toThrow(
      'photo bad.jpg',
    );
    expect(await v2Files()).toEqual([]);
    expect(
      await dataSource.query('SELECT count(*)::int AS n FROM bills'),
    ).toEqual([{ n: 0 }]);
  });

  it('reports a missing source file before anything is written', async () => {
    await register('ana@example.com');
    const plan = await planFor(DUMP.replace("'p1.jpg'", "'missing.jpg'"));

    await expect(checkSources(plan, source)).rejects.toThrow('missing.jpg');
  });
});
