import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { isRandomPhotoName } from '../bill/photo-files';
import {
  MigrationRunError,
  PhotoRow,
  PhotoStore,
  cleanup,
  planMigration,
  planTotals,
  rollback,
  runMigration,
  verify,
} from './photo-migration';

class MemStore implements PhotoStore {
  rows: PhotoRow[];
  onSetPath?: (id: number) => 'throw' | 'commit-then-throw' | 'changed' | void;
  /** Called before every list(), with the 1-based call number. */
  onList?: (call: number) => void;
  listCalls = 0;

  constructor(rows: PhotoRow[]) {
    this.rows = rows.map((r) => ({ ...r }));
  }

  async list(): Promise<PhotoRow[]> {
    this.onList?.(++this.listCalls);
    return this.rows.map((r) => ({ ...r }));
  }

  async setPath(id: number, expectedOldPath: string, newPath: string) {
    const hook = this.onSetPath?.(id);
    if (hook === 'throw') throw new Error(`db down on row ${id}`);
    if (hook === 'changed') return false;
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.path !== expectedOldPath) return false;
    row.path = newPath;
    if (hook === 'commit-then-throw') {
      throw new Error(`connection reset after commit on row ${id}`);
    }
    return true;
  }

  pathOf(id: number): string {
    return this.rows.find((r) => r.id === id)!.path;
  }
}

let root: string;
let outside: string;

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-mig-'));
  root = path.join(base, 'uploads');
  outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
});

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

const write = (name: string, content: string, dir = root) =>
  fs.writeFile(path.join(dir, name), content);
const read = (name: string) => fs.readFile(path.join(root, name), 'utf8');
const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

/** Every file under `dir`, recursively, with its content. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out[path.relative(dir, p)] = await fs.readFile(p, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

const logPath = (name = 'photos-test.jsonl') =>
  path.join(root, '.migration', name);

async function readLog(file: string) {
  const text = await fs.readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

const V4 = '3f2b8c1e-9a7d-4e21-8b3c-5d6e7f8a9b0c';
const V5 = '3f2b8c1e-9a7d-5e21-8b3c-5d6e7f8a9b0c';

async function legacySetup() {
  await write(`${V5}.jpg`, 'photo-one');
  await write('IMG_2.JPG', 'photo-two!');
  await write('shared.png', 'shared-bytes');
  await write(`${V4}.jpg`, 'already');
  return new MemStore([
    { id: 1, path: `${V5}.jpg` },
    { id: 2, path: 'IMG_2.JPG' },
    { id: 3, path: 'shared.png' },
    { id: 4, path: 'shared.png' },
    { id: 5, path: `${V4}.jpg` },
    { id: 6, path: 'gone.jpg' },
    { id: 7, path: '../outside/evil.jpg' },
  ]);
}

describe('planMigration', () => {
  it('classifies rows, marks shared files and writes nothing', async () => {
    const store = await legacySetup();
    await write('evil.jpg', 'outside', outside);
    const before = await snapshot(path.dirname(root));
    const rowsBefore = await store.list();

    const plan = await planMigration(store, root);

    const byId = Object.fromEntries(plan.map((p) => [p.rowId, p]));
    expect(byId[1].status).toBe('migrate');
    expect(byId[2].status).toBe('migrate');
    expect(byId[3]).toMatchObject({ status: 'migrate', shared: true });
    expect(byId[4]).toMatchObject({ status: 'migrate', shared: true });
    expect(byId[1].shared).toBe(false);
    expect(byId[5]).toMatchObject({ status: 'already-random', newPath: null });
    expect(byId[6]).toMatchObject({ status: 'missing-file', newPath: null });
    expect(byId[7]).toMatchObject({ status: 'invalid-path', newPath: null });

    expect(isRandomPhotoName(byId[1].newPath!)).toBe(true);
    expect(byId[2].newPath).toMatch(/\.jpg$/);
    expect(byId[3].newPath).not.toBe(byId[4].newPath);

    expect(await snapshot(path.dirname(root))).toEqual(before);
    expect(await store.list()).toEqual(rowsBefore);
  });

  it('computes totals', async () => {
    const store = await legacySetup();
    const totals = planTotals(await planMigration(store, root));
    expect(totals).toEqual({
      rows: 7,
      distinctFiles: 6,
      sharedFiles: 1,
      toMigrate: 4,
      alreadyMigrated: 1,
      missingFiles: 1,
      invalidPaths: 1,
    });
  });
});

describe('runMigration', () => {
  it('copies each row to its own new file, keeps originals and logs every row', async () => {
    const store = await legacySetup();
    const log = logPath();

    const summary = await runMigration(store, root, log);

    expect(summary.migrated).toBe(4);
    expect(summary.alreadyRandom).toBe(1);
    expect(summary.missing.map((m) => m.rowId)).toEqual([6]);
    expect(summary.invalid.map((m) => m.rowId)).toEqual([7]);
    expect(summary.skipped).toEqual([]);

    const original: Record<number, string> = {
      1: 'photo-one',
      2: 'photo-two!',
      3: 'shared-bytes',
      4: 'shared-bytes',
    };
    for (const id of [1, 2, 3, 4]) {
      const p = store.pathOf(id);
      expect(isRandomPhotoName(p)).toBe(true);
      expect(await read(p)).toBe(original[id]);
    }
    expect(store.pathOf(2)).toMatch(/\.jpg$/);
    // Shared rows now own different files.
    expect(store.pathOf(3)).not.toBe(store.pathOf(4));
    // Originals are all still there, unchanged.
    expect(await read(`${V5}.jpg`)).toBe('photo-one');
    expect(await read('IMG_2.JPG')).toBe('photo-two!');
    expect(await read('shared.png')).toBe('shared-bytes');
    // Untouched rows.
    expect(store.pathOf(5)).toBe(`${V4}.jpg`);
    expect(store.pathOf(6)).toBe('gone.jpg');
    expect(store.pathOf(7)).toBe('../outside/evil.jpg');

    const lines = await readLog(log);
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      expect(Object.keys(l).sort()).toEqual(
        ['newPath', 'oldPath', 'rowId', 'size'].sort(),
      );
      expect(store.pathOf(l.rowId)).toBe(l.newPath);
      expect(l.size).toBe(original[l.rowId].length);
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    const store = await legacySetup();
    await runMigration(store, root, logPath('a.jsonl'));
    const files = await snapshot(root);
    const rows = await store.list();

    const second = await runMigration(store, root, logPath('b.jsonl'));

    expect(second.migrated).toBe(0);
    expect(await store.list()).toEqual(rows);
    expect(await snapshot(root)).toEqual(files);
    expect(await exists(logPath('b.jsonl'))).toBe(false);
  });

  it('finishes an interrupted run on rerun without duplicating copies', async () => {
    await write('a.jpg', 'aaa');
    await write('b.jpg', 'bbbb');
    await write('c.jpg', 'ccccc');
    const store = new MemStore([
      { id: 1, path: 'a.jpg' },
      { id: 2, path: 'b.jpg' },
      { id: 3, path: 'c.jpg' },
    ]);
    store.onSetPath = (id) => (id === 2 ? 'throw' : undefined);

    const err = await runMigration(store, root, logPath('1.jsonl')).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MigrationRunError);
    expect(err.message).toContain('db down on row 2');
    const orphan: string = err.summary.orphanCopies[0];
    expect(err.summary.orphanCopies).toHaveLength(1);
    expect(err.message).toMatch(/row 2/);
    expect(err.message).toContain('b.jpg');
    expect(err.message).toContain(orphan);
    expect(err.summary.migrated).toBe(1);
    expect(err.summary.logFile).toBe(logPath('1.jsonl'));

    const first = store.pathOf(1);
    expect(isRandomPhotoName(first)).toBe(true);
    expect(store.pathOf(2)).toBe('b.jpg');
    expect(store.pathOf(3)).toBe('c.jpg');
    expect(await readLog(logPath('1.jsonl'))).toEqual([
      { rowId: 1, oldPath: 'a.jpg', newPath: first, size: 3 },
    ]);
    // The copy made for row 2 is never deleted after a throw (the UPDATE
    // might have committed); it's left as a reported orphan.
    expect(Object.keys(await snapshot(root)).sort()).toEqual(
      ['.migration/1.jsonl', 'a.jpg', 'b.jpg', 'c.jpg', first, orphan].sort(),
    );

    store.onSetPath = undefined;
    const rerun = await runMigration(store, root, logPath('2.jsonl'));

    expect(rerun.migrated).toBe(2);
    expect(rerun.alreadyRandom).toBe(1);
    expect(store.pathOf(1)).toBe(first);
    const lines = await readLog(logPath('2.jsonl'));
    expect(lines.map((l) => l.rowId)).toEqual([2, 3]);
    const files = Object.keys(await snapshot(root)).filter(
      (f) => !f.startsWith('.migration'),
    );
    // 3 originals + exactly one copy per row + the reported orphan.
    expect(files).toHaveLength(7);
    expect(files).toContain(orphan);
    expect(await read(store.pathOf(2))).toBe('bbbb');
    expect(await read(store.pathOf(3))).toBe('ccccc');
  });

  it('keeps the copy and logs the row when setPath throws after committing', async () => {
    await write('a.jpg', 'aaa');
    await write('b.jpg', 'bbb');
    const store = new MemStore([
      { id: 1, path: 'a.jpg' },
      { id: 2, path: 'b.jpg' },
    ]);
    store.onSetPath = (id) => (id === 1 ? 'commit-then-throw' : undefined);

    const err = await runMigration(store, root, logPath()).catch((e) => e);

    expect(err).toBeInstanceOf(MigrationRunError);
    const newPath = store.pathOf(1);
    expect(isRandomPhotoName(newPath)).toBe(true);
    expect(err.message).toMatch(/row 1\b/);
    expect(err.message).toContain('a.jpg');
    expect(err.message).toContain(newPath);
    expect(await read(newPath)).toBe('aaa');
    expect(await read('a.jpg')).toBe('aaa');
    expect(await readLog(logPath())).toEqual([
      { rowId: 1, oldPath: 'a.jpg', newPath, size: 3 },
    ]);
    expect(err.summary.migrated).toBe(1);
    expect(err.summary.orphanCopies).toEqual([]);
    // The run stopped: row 2 was not attempted.
    expect(store.pathOf(2)).toBe('b.jpg');
  });

  it('leaves the copy as an orphan when the re-read after a throw fails', async () => {
    await write('a.jpg', 'aaa');
    const store = new MemStore([{ id: 1, path: 'a.jpg' }]);
    store.onSetPath = () => 'throw';
    store.onList = (n) => {
      if (n > 1) throw new Error('still down');
    };

    const err = await runMigration(store, root, logPath()).catch((e) => e);

    expect(err).toBeInstanceOf(MigrationRunError);
    const orphan = err.summary.orphanCopies[0];
    expect(isRandomPhotoName(orphan)).toBe(true);
    expect(await read(orphan)).toBe('aaa');
    expect(store.pathOf(1)).toBe('a.jpg');
    expect(await exists(logPath())).toBe(false);
  });

  it('reports a source that vanished before its copy as missing and continues', async () => {
    await write('a.jpg', 'aaa');
    await write('b.jpg', 'bbb');
    const store = new MemStore([
      { id: 1, path: 'a.jpg' },
      { id: 2, path: 'b.jpg' },
    ]);

    const summary = await runMigration(store, root, logPath(), {
      copy: async (src, dst) => {
        if (src.endsWith('a.jpg')) await fs.unlink(src);
        await fs.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
      },
    });

    expect(summary.missing.map((m) => [m.rowId, m.status])).toEqual([
      [1, 'missing-file'],
    ]);
    expect(summary.migrated).toBe(1);
    expect(store.pathOf(1)).toBe('a.jpg');
    expect(Object.keys(await snapshot(root)).sort()).toEqual(
      ['.migration/photos-test.jsonl', 'b.jpg', store.pathOf(2)].sort(),
    );
  });

  it('deletes its copy and skips the row when the row changed meanwhile', async () => {
    await write('a.jpg', 'aaa');
    await write('b.jpg', 'bbb');
    const store = new MemStore([
      { id: 1, path: 'a.jpg' },
      { id: 2, path: 'b.jpg' },
    ]);
    store.onSetPath = (id) => (id === 1 ? 'changed' : undefined);

    const summary = await runMigration(store, root, logPath());

    expect(summary.skipped.map((s) => s.rowId)).toEqual([1]);
    expect(summary.migrated).toBe(1);
    expect(store.pathOf(1)).toBe('a.jpg');
    expect(Object.keys(await snapshot(root)).sort()).toEqual(
      [
        '.migration/photos-test.jsonl',
        'a.jpg',
        'b.jpg',
        store.pathOf(2),
      ].sort(),
    );
    expect((await readLog(logPath())).map((l) => l.rowId)).toEqual([2]);
  });

  it('stops on a size mismatch, deletes the copy and leaves the row alone', async () => {
    await write('a.jpg', 'full-content');
    const store = new MemStore([{ id: 1, path: 'a.jpg' }]);

    await expect(
      runMigration(store, root, logPath(), {
        copy: async (_src, dst) => fs.writeFile(dst, 'short', { flag: 'wx' }),
      }),
    ).rejects.toThrow(/size/i);

    expect(store.pathOf(1)).toBe('a.jpg');
    expect(await snapshot(root)).toEqual({ 'a.jpg': 'full-content' });
  });

  it('never deletes a file that already existed at the target name', async () => {
    await write('a.jpg', 'aaa');
    const store = new MemStore([{ id: 1, path: 'a.jpg' }]);
    let target = '';

    await expect(
      runMigration(store, root, logPath(), {
        copy: async (src, dst) => {
          target = dst;
          await fs.writeFile(dst, 'someone else');
          await fs.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
        },
      }),
    ).rejects.toThrow();

    expect(await fs.readFile(target, 'utf8')).toBe('someone else');
    expect(store.pathOf(1)).toBe('a.jpg');
    expect(await read('a.jpg')).toBe('aaa');
  });
});

describe('verify', () => {
  it('is ok after a run and lists unreferenced files, ignoring dotfiles', async () => {
    const store = await legacySetup();
    await fs.unlink(path.join(root, `${V4}.jpg`)); // keep the setup healthy
    store.rows = store.rows.filter(
      (r) => r.id !== 5 && r.id !== 6 && r.id !== 7,
    );
    await write('.DS_Store', 'x');
    await write('stray.jpg', 'stray');
    const log = logPath();
    await runMigration(store, root, log);

    const result = await verify(store, root, [log]);

    expect(result.problems).toEqual([]);
    expect(result.missingBeforeMigration).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.unreferencedFiles.sort()).toEqual(
      [`${V5}.jpg`, 'IMG_2.JPG', 'shared.png', 'stray.jpg'].sort(),
    );
  });

  it('reports a size mismatch against the log', async () => {
    await write('a.jpg', 'aaaa');
    const store = new MemStore([{ id: 1, path: 'a.jpg' }]);
    await runMigration(store, root, logPath());
    await fs.truncate(path.join(root, store.pathOf(1)), 2);

    const result = await verify(store, root, [logPath()]);

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/row 1.*size/i);
  });

  it('reports a missing migrated file', async () => {
    await write('a.jpg', 'aaaa');
    const store = new MemStore([{ id: 1, path: 'a.jpg' }]);
    await runMigration(store, root, logPath());
    await fs.unlink(path.join(root, store.pathOf(1)));

    const result = await verify(store, root, [logPath()]);

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/row 1.*missing/i);
  });

  it('reports files missing before the migration separately, and is not ok', async () => {
    const store = new MemStore([{ id: 6, path: 'gone.jpg' }]);
    const result = await verify(store, root, []);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([]);
    expect(result.missingBeforeMigration).toEqual([
      expect.stringMatching(/row 6.*gone\.jpg/),
    ]);
  });

  it('reports empty files and invalid paths', async () => {
    await write('empty.jpg', '');
    const store = new MemStore([
      { id: 1, path: 'empty.jpg' },
      { id: 2, path: 'a/b.jpg' },
    ]);
    const result = await verify(store, root, []);
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toMatch(/row 1.*empty/i);
    expect(result.problems.join('\n')).toMatch(/row 2.*a\/b\.jpg/);
  });

  it('lists unmigrated rows and is not ok until they are migrated', async () => {
    await write('a.jpg', 'aaa');
    await write(`${V4}.jpg`, 'bbb');
    const store = new MemStore([
      { id: 1, path: 'a.jpg' },
      { id: 2, path: `${V4}.jpg` },
      { id: 3, path: '../x.jpg' },
    ]);

    const result = await verify(store, root, []);

    expect(result.ok).toBe(false);
    expect(result.unmigrated).toEqual([expect.stringMatching(/row 1.*a\.jpg/)]);
    expect(result.problems.join('\n')).toMatch(/row 3/);
  });

  it('treats a migrated row whose log line was lost as healthy', async () => {
    await write(`${V4}.jpg`, 'copied');
    await write('old.jpg', 'copied');
    const store = new MemStore([{ id: 1, path: `${V4}.jpg` }]);
    const result = await verify(store, root, []);
    expect(result.ok).toBe(true);
    expect(result.unreferencedFiles).toEqual(['old.jpg']);
  });

  it('fails on a missing or malformed log file', async () => {
    const store = new MemStore([]);
    await fs.mkdir(path.join(root, '.migration'));
    await fs.writeFile(logPath('bad.jsonl'), '{"rowId":1,"oldPa');
    expect((await verify(store, root, [logPath('bad.jsonl')])).ok).toBe(false);
    expect((await verify(store, root, [logPath('nope.jsonl')])).ok).toBe(false);
  });
});

describe('cleanup', () => {
  async function migrated() {
    await write('a.jpg', 'aaa');
    await write('b.jpg', 'bbb');
    await write('stray.jpg', 'not in any log');
    const store = new MemStore([
      { id: 1, path: 'a.jpg' },
      { id: 2, path: 'b.jpg' },
    ]);
    await runMigration(store, root, logPath());
    return store;
  }

  it('deletes nothing in a dry run', async () => {
    const store = await migrated();
    const before = await snapshot(root);

    const result = await cleanup(store, root, [logPath()], { dryRun: true });

    expect(result.refused).toBe(false);
    expect(result.deleted).toEqual([]);
    expect(result.wouldDelete.sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(await snapshot(root)).toEqual(before);
  });

  it('deletes logged old files that no row references, and nothing else', async () => {
    const store = await migrated();

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.deleted.sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(await exists(path.join(root, 'a.jpg'))).toBe(false);
    expect(await exists(path.join(root, 'b.jpg'))).toBe(false);
    expect(await read('stray.jpg')).toBe('not in any log');
    expect(await read(store.pathOf(1))).toBe('aaa');
    expect(await read(store.pathOf(2))).toBe('bbb');
    expect(await exists(logPath())).toBe(true);
  });

  it('keeps a logged old file that a row still references', async () => {
    const store = await migrated();
    // A row appears between verify's read and cleanup's own fresh read.
    const calls = store.listCalls;
    store.onList = (n) => {
      if (n === calls + 2) store.rows.push({ id: 3, path: 'a.jpg' });
    };

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.deleted).toEqual(['b.jpg']);
    expect(result.kept).toEqual([
      { path: 'a.jpg', reason: expect.stringMatching(/referenced/) },
    ]);
    expect(await read('a.jpg')).toBe('aaa');
  });

  it('treats a case-insensitive match as still referenced', async () => {
    const store = await migrated();
    const calls = store.listCalls;
    store.onList = (n) => {
      if (n === calls + 2) store.rows.push({ id: 3, path: 'A.JPG' });
    };

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.deleted).toEqual(['b.jpg']);
    expect(await exists(path.join(root, 'a.jpg'))).toBe(true);
  });

  it('refuses while any row is still unmigrated', async () => {
    const store = await migrated();
    store.rows.push({ id: 3, path: 'a.jpg' });
    const before = await snapshot(root);

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.refused).toBe(true);
    expect(result.reasons.join('\n')).toMatch(/row 3/);
    expect(await snapshot(root)).toEqual(before);
  });

  it('never deletes a random-named oldPath', async () => {
    const store = new MemStore([]);
    await write(`${V4}.jpg`, 'random');
    await write('copy.jpg', 'random');
    await fs.mkdir(path.join(root, '.migration'));
    await fs.writeFile(
      logPath(),
      JSON.stringify({
        rowId: 1,
        oldPath: `${V4}.jpg`,
        newPath: 'copy.jpg',
        size: 6,
      }) + '\n',
    );

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([
      { path: `${V4}.jpg`, reason: expect.stringMatching(/random/) },
    ]);
    expect(await read(`${V4}.jpg`)).toBe('random');
  });

  it('keeps an oldPath whose logged newPath file is gone', async () => {
    const store = new MemStore([]);
    await write('old.jpg', 'old');
    await fs.mkdir(path.join(root, '.migration'));
    await fs.writeFile(
      logPath(),
      JSON.stringify({
        rowId: 1,
        oldPath: 'old.jpg',
        newPath: `${V4}.jpg`,
        size: 3,
      }) + '\n',
    );

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.deleted).toEqual([]);
    expect(result.kept).toEqual([
      { path: 'old.jpg', reason: expect.stringMatching(/new file/) },
    ]);
    expect(await read('old.jpg')).toBe('old');
  });

  it('refuses and deletes nothing when verify fails', async () => {
    const store = await migrated();
    await fs.unlink(path.join(root, store.pathOf(2)));
    const before = await snapshot(root);

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.refused).toBe(true);
    expect(result.deleted).toEqual([]);
    expect(await snapshot(root)).toEqual(before);
  });

  it('never deletes paths outside root, dotfiles or non-plain names from a log', async () => {
    const store = new MemStore([]);
    await write('evil.jpg', 'outside', outside);
    await write('.keep', 'dot');
    await fs.mkdir(path.join(root, '.migration'));
    const entries = [
      '../outside/evil.jpg',
      '.keep',
      '..',
      '.migration',
      'x\\y.jpg',
      '',
    ].map((oldPath, i) =>
      JSON.stringify({ rowId: i + 1, oldPath, newPath: `${V4}.jpg`, size: 1 }),
    );
    await fs.writeFile(logPath(), entries.join('\n') + '\n');

    const result = await cleanup(store, root, [logPath()], { dryRun: false });

    expect(result.deleted).toEqual([]);
    expect(await read('.keep')).toBe('dot');
    expect(await fs.readFile(path.join(outside, 'evil.jpg'), 'utf8')).toBe(
      'outside',
    );
    expect(await exists(path.join(root, '.migration'))).toBe(true);
  });

  it('keeps every logged file when no log is given', async () => {
    const store = await migrated();
    const result = await cleanup(store, root, [], { dryRun: false });
    expect(result.deleted).toEqual([]);
    expect(await exists(path.join(root, 'a.jpg'))).toBe(true);
  });
});

describe('rollback', () => {
  it('restores rows still on newPath whose old file exists, and deletes nothing', async () => {
    await write('a.jpg', 'aaa');
    await write('b.jpg', 'bbb');
    await write('c.jpg', 'ccc');
    const store = new MemStore([
      { id: 1, path: 'a.jpg' },
      { id: 2, path: 'b.jpg' },
      { id: 3, path: 'c.jpg' },
    ]);
    await runMigration(store, root, logPath());
    const newC = store.pathOf(3);
    store.rows.find((r) => r.id === 2)!.path = 'changed-by-user.jpg';
    await fs.unlink(path.join(root, 'c.jpg')); // old file already cleaned up
    const before = await snapshot(root);

    const result = await rollback(store, root, logPath());

    expect(result).toMatchObject({ restored: 1, skipped: 2 });
    expect(store.pathOf(1)).toBe('a.jpg');
    expect(store.pathOf(2)).toBe('changed-by-user.jpg');
    expect(store.pathOf(3)).toBe(newC);
    expect(await snapshot(root)).toEqual(before);
  });
});
