import { main, parseArgs } from './migrate-accounts';

describe('migrate-accounts CLI', () => {
  let err: jest.SpyInstance;
  beforeEach(() => {
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => err.mockRestore());

  it('defaults to a dry run', () => {
    expect(parseArgs([])).toEqual({ mode: 'plan', yes: false, logs: [] });
    expect(parseArgs(['--'])).toMatchObject({ mode: 'plan' });
  });

  it('parses run, verify logs and several rollback logs', () => {
    expect(parseArgs(['--run', '--yes-i-have-a-backup'])).toMatchObject({
      mode: 'run',
      yes: true,
    });
    expect(parseArgs(['--verify', '--log', 'a', 'b'])).toEqual({
      mode: 'verify',
      yes: false,
      logs: ['a', 'b'],
    });
    expect(parseArgs(['--rollback', 'a', 'b'])).toEqual({
      mode: 'rollback',
      yes: false,
      logs: ['a', 'b'],
    });
  });

  it('rejects unknown, conflicting or misplaced flags', () => {
    expect(() => parseArgs(['--rn'])).toThrow(/Unknown/);
    expect(() => parseArgs(['constructor'])).toThrow(/Unknown/);
    expect(() => parseArgs(['--run', '--verify'])).toThrow(/one mode/);
    expect(() => parseArgs(['--rollback'])).toThrow(/log file/);
    expect(() => parseArgs(['--verify', '--yes-i-have-a-backup'])).toThrow();
    expect(() => parseArgs(['--rollback', 'a', '--log', 'b'])).toThrow();
  });

  it('exits 2 with usage on an unknown flag', async () => {
    expect(await main(['--bogus'])).toBe(2);
    expect(err.mock.calls[0][0]).toMatch(
      /Unknown argument: --bogus[\s\S]*Usage/,
    );
  });

  it('refuses --run without the backup flag, before touching the database', async () => {
    expect(await main(['--run'])).toBe(1);
    expect(err.mock.calls[0][0]).toMatch(/Refusing[\s\S]*mysqldump/);
  });
});
