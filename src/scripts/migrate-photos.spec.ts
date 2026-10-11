import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { backupInstructions, parseArgs } from './migrate-photos';

describe('migrate-photos CLI arguments', () => {
  it('defaults to a dry run', () => {
    expect(parseArgs([])).toMatchObject({ mode: 'plan', yes: false });
    expect(parseArgs(['--'])).toMatchObject({ mode: 'plan' });
  });

  it('parses run, cleanup and the backup flag', () => {
    expect(parseArgs(['--run'])).toMatchObject({ mode: 'run', yes: false });
    expect(parseArgs(['--run', '--yes-i-have-a-backup'])).toMatchObject({
      mode: 'run',
      yes: true,
    });
    expect(parseArgs(['--cleanup'])).toMatchObject({
      mode: 'cleanup',
      yes: false,
    });
  });

  it('collects several --log files', () => {
    expect(
      parseArgs(['--verify', '--log', 'a.jsonl', 'b.jsonl']),
    ).toMatchObject({ mode: 'verify', logs: ['a.jsonl', 'b.jsonl'] });
  });

  it('takes the rollback log', () => {
    expect(parseArgs(['--rollback', 'x.jsonl'])).toMatchObject({
      mode: 'rollback',
      rollbackLog: 'x.jsonl',
    });
  });

  it('rejects unknown, conflicting or misplaced flags', () => {
    expect(() => parseArgs(['--rn'])).toThrow(/Unknown/);
    expect(() => parseArgs(['--run', '--cleanup'])).toThrow(/one mode/);
    expect(() => parseArgs(['--rollback'])).toThrow(/log file/);
    expect(() => parseArgs(['--verify', '--yes-i-have-a-backup'])).toThrow();
    expect(() => parseArgs(['--yes-i-have-a-backup'])).toThrow();
    expect(() => parseArgs(['--run', '--log', 'a.jsonl'])).toThrow();
  });

  describe('backup instructions', () => {
    let base: string;
    beforeEach(async () => {
      base = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'photo-bak-')),
      );
    });
    afterEach(() => fs.rm(base, { recursive: true, force: true }));

    it('prints mysqldump and a copy of the real uploads dir', async () => {
      await fs.mkdir(path.join(base, 'uploads'));
      const text = await backupInstructions(path.join(base, 'uploads'));
      expect(text).toMatch(/mysqldump .* > piggy-flow-\d{4}-\d{2}-\d{2}\.sql/);
      const date = text.match(/piggy-flow-(\d{4}-\d{2}-\d{2})\.sql/)![1];
      const backup = path.join(base, `uploads-backup-${date}`);
      expect(text).toContain(
        `mkdir -p '${backup}' && cp -a '${base}/uploads/.' '${backup}/'`,
      );
      expect(text).not.toMatch(/symbolic link/);
    });

    it('follows a symlinked uploads dir and warns about it', async () => {
      const real = path.join(base, 'data', 'photos');
      await fs.mkdir(real, { recursive: true });
      await fs.mkdir(path.join(base, 'app'));
      const link = path.join(base, 'app', 'uploads');
      await fs.symlink(real, link);

      const text = await backupInstructions(link);

      const date = text.match(/piggy-flow-(\d{4}-\d{2}-\d{2})\.sql/)![1];
      const backup = path.join(base, 'data', `photos-backup-${date}`);
      expect(text).toMatch(/Warning: .*symbolic link/);
      expect(text).toContain(
        `mkdir -p '${backup}' && cp -a '${real}/.' '${backup}/'`,
      );
    });
  });
});
