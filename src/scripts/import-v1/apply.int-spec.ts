import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import { DataSource, type EntityManager } from 'typeorm';
import {
  createIntegrationModule,
  truncateTables,
  waitForLockWait,
} from '../../../test/db.js';
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
  checkFolders,
  checkTarget,
  IMPORT_LOCK,
  ImportError,
  loadV2Users,
  readDump,
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

const TWO_PHOTOS = DUMP.replace(
  "(1, 'IMG_1.jpg', 'p1.jpg', 'x', '2025-07-12 08:00:00.000000', 1);",
  "(1, 'IMG_1.jpg', 'p1.jpg', 'x', '2025-07-12 08:00:00.000000', 1),\n(2, 'IMG_2.jpg', 'p1.jpg', 'x', '2025-07-12 08:00:00.000000', 1);",
);
const WITH_BOB = DUMP.replace(
  "'Ana', '2025-01-01 10:00:00.000000', '2025-01-01 10:00:00.000000');",
  "'Ana', '2025-01-01 10:00:00.000000', '2025-01-01 10:00:00.000000'),\n(2, 'u2', 'bob@example.com', 'Bob', '2025-01-01 10:00:00.000000', '2025-01-01 10:00:00.000000');",
).replace(
  '1, NULL, NULL, NULL);\nCREATE TABLE `bill_photo`',
  "1, NULL, NULL, NULL),\n(3, '2026-10-05 06:00:00', 5.00, NULL, '2026-10-05 06:00:00.000000', '2026-10-05 06:00:00.000000', 2, NULL, NULL, NULL);\nCREATE TABLE `bill_photo`",
);

/** Fails to delete the first file it is asked to. */
class FlakyStorage extends PhotoStorage {
  failed = false;
  override async delete(id: string): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      throw new Error('disk gone');
    }
    await super.delete(id);
  }
}

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
    const progress: string[] = [];
    const result = await applyPlan(dataSource, plan, source, storage, (m) =>
      progress.push(m),
    );

    expect(result.photos).toBe(1);
    expect(progress).toEqual([
      'photos 1/1',
      'writing rows…',
      'verifying totals…',
      'committed',
    ]);
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
    plan.bills[0].priceCents += 1;

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

  it('rolls back when the bills match per account but not per user', async () => {
    await register('ana@example.com');
    const bob = await register('bob@example.com');
    const plan = await planFor(WITH_BOB);
    expect(WITH_BOB).toContain("(3, '2026-10-05 06:00:00', 5.00");
    // Same account (Ana's Personal), so only the per-user totals change.
    const netflix = plan.bills.find((b) => b.comment === 'Netflix')!;
    netflix.createdById = bob.id;
    netflix.updatedById = bob.id;

    await expect(applyPlan(dataSource, plan, source, storage)).rejects.toThrow(
      /Totals differ for user/,
    );
    expect(
      await dataSource.query('SELECT count(*)::int AS n FROM bills'),
    ).toEqual([{ n: 0 }]);
  });

  it('deletes every written photo even when one delete fails, and keeps the original error', async () => {
    await register('ana@example.com');
    const plan = await planFor(TWO_PHOTOS);
    plan.bills[0].priceCents += 1;
    const flaky = new FlakyStorage(storageDir);

    await expect(applyPlan(dataSource, plan, source, flaky)).rejects.toThrow(
      'Totals differ',
    );
    expect(flaky.failed).toBe(true);
    expect(await v2Files()).toHaveLength(1); // only the one whose delete failed
  });

  it('lets only one of two concurrent imports write', async () => {
    await register('ana@example.com');
    const [first, second] = [await planFor(), await planFor()];
    // Hold the import lock so both runs are inside their transactions at once.
    const holder = dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query('SELECT pg_advisory_xact_lock($1)', [IMPORT_LOCK]);
    const running = Promise.allSettled([
      applyPlan(dataSource, first, source, storage),
      applyPlan(dataSource, second, source, storage),
    ]);
    await waitForLockWait(dataSource);
    await holder.commitTransaction();
    await holder.release();
    const results = await running;

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(String(rejected?.reason)).toContain(
      'The v2 database already has data',
    );
    expect(
      await dataSource.query('SELECT count(*)::int AS n FROM bills'),
    ).toEqual([{ n: 2 }]);
    expect(await v2Files()).toHaveLength(1);
  });

  it('refuses v2-named photo files in the target folder, ignoring other files', async () => {
    await register('ana@example.com');
    await writeFile(join(storageDir, 'IMG_0001.jpg'), 'x');
    await checkTarget(storageDir); // not a v2 name: ignored
    const stale = `${randomUUID()}.jpg`;
    await writeFile(join(storageDir, stale), 'x');
    await writeFile(join(storageDir, `${randomUUID()}.jpg.tmp`), 'x');

    await expect(checkTarget(storageDir)).rejects.toThrow(
      `2 photo files are in ${storageDir} but v2 has no photos. ` +
        'If an interrupted import left them, delete them; if they are v1 originals, ' +
        'move them elsewhere and pass that folder as --uploads.',
    );
    await expect(
      applyPlan(dataSource, await planFor(), source, storage),
    ).rejects.toThrow(ImportError);
    expect(
      await dataSource.query('SELECT count(*)::int AS n FROM bills'),
    ).toEqual([{ n: 0 }]);
    expect((await v2Files()).sort()).toEqual(['IMG_0001.jpg', stale].sort());
  });

  it('refuses the same or nested folders for the v1 photos and the v2 uploads', async () => {
    const message =
      '--uploads and UPLOADS_DIR must be different folders; copy the v1 photos elsewhere and pass that as --uploads';
    const link = join(storageDir, 'link-to-source');
    await symlink(source, link);

    await expect(checkFolders(source, source)).rejects.toThrow(message);
    await expect(checkFolders(source, link)).rejects.toThrow(message);
    await expect(checkFolders(source, join(source, 'v2'))).rejects.toThrow(
      message,
    );
    await mkdir(join(storageDir, 'v1'));
    await expect(
      checkFolders(join(storageDir, 'v1'), storageDir),
    ).rejects.toThrow(message);
    expect(await readdir(source)).not.toContain('v2'); // nothing created
    await expect(checkFolders(source, join(source, 'a', 'b'))).rejects.toThrow(
      message,
    );
    await expect(
      checkFolders(source, join(storageDir, 'new', 'uploads')),
    ).resolves.toBeUndefined();
    await mkdir(`${source}-sibling`);
    await expect(
      checkFolders(source, `${source}-sibling`),
    ).resolves.toBeUndefined();
    await expect(checkFolders(source, storageDir)).resolves.toBeUndefined();

    await register('ana@example.com');
    await expect(
      applyPlan(dataSource, await planFor(), source, new PhotoStorage(source)),
    ).rejects.toThrow(message);
    await rm(`${source}-sibling`, { recursive: true });
  });

  it('keeps the photo files when the transaction committed but reported an error', async () => {
    await register('ana@example.com');
    // The commit succeeds, then the call fails (e.g. the connection drops on the reply).
    const flaky = new Proxy(dataSource, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (run: (manager: EntityManager) => Promise<unknown>) => {
            await target.transaction(run);
            throw new Error('connection lost');
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    await expect(
      applyPlan(flaky, await planFor(), source, storage),
    ).rejects.toThrow(/the import committed .*connection lost/s);
    expect(
      await dataSource.query('SELECT count(*)::int AS n FROM bills'),
    ).toEqual([{ n: 2 }]);
    expect(await v2Files()).toHaveLength(1);
  });

  it('reads the dump as strict UTF-8', async () => {
    const good = join(source, 'good.sql');
    const bad = join(source, 'bad.sql');
    await writeFile(good, Buffer.from('\uFEFF-- ⛽ dump', 'utf8'));
    await writeFile(bad, Buffer.from([0x2d, 0x2d, 0x20, 0xc3, 0x28]));

    await expect(readDump(good)).resolves.toBe('-- ⛽ dump');
    await expect(readDump(bad)).rejects.toThrow(
      `The dump ${bad} is not valid UTF-8`,
    );
  });

  it('creates a missing target folder', async () => {
    const target = join(storageDir, 'nested', 'uploads');
    await checkTarget(target);
    expect(await readdir(target)).toEqual([]);
    await rm(join(storageDir, 'nested'), { recursive: true });
  });

  it('reports a source file that is not a supported image in the dry run', async () => {
    await register('ana@example.com');
    await writeFile(join(source, 'bad.jpg'), 'not an image');
    const plan = await planFor(
      TWO_PHOTOS.replace("'IMG_2.jpg', 'p1.jpg'", "'IMG_2.jpg', 'bad.jpg'"),
    );

    await expect(checkSources(plan, source)).rejects.toThrow(
      `Photo files that can't be converted in ${source}: bad.jpg`,
    );
  });

  it('reports a missing source file before anything is written', async () => {
    await register('ana@example.com');
    const plan = await planFor(DUMP.replace("'p1.jpg'", "'missing.jpg'"));

    await expect(checkSources(plan, source)).rejects.toThrow('missing.jpg');
  });
});
