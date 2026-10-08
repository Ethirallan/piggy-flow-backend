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

  it('prints mysqldump and uploads copy commands', () => {
    const text = backupInstructions('./uploads');
    expect(text).toMatch(/mysqldump .* > piggy-flow-\d{4}-\d{2}-\d{2}\.sql/);
    expect(text).toMatch(
      /cp -a \.\/uploads \.\/uploads-backup-\d{4}-\d{2}-\d{2}/,
    );
  });
});
