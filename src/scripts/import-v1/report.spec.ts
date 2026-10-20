import { planImport, type V2User } from './plan.js';
import { ImportError } from './apply.js';
import { DumpParseError } from './parse-dump.js';
import { formatError, formatReport } from './report.js';
import { v1Tables } from './testing/v1-tables.js';
import { toSnapshot } from './v1-snapshot.js';

const v2Ana: V2User = {
  id: 'ana',
  email: 'ana@example.com',
  personalAccountId: 'ana-personal',
};

const target = {
  host: 'localhost',
  port: 5432,
  database: 'piggy',
  uploads: '/srv/uploads',
};

describe('formatReport', () => {
  let n = 0;
  const plan = planImport(toSnapshot(v1Tables()), [v2Ana], {
    dismissedEmails: [],
    today: '2026-10-20',
    newId: () => `id-${++n}`,
  });

  it('lists every account the import writes to, also one without bills', () => {
    const lines = formatReport(plan, {
      target,
      users: [v2Ana],
      unreferenced: ['orphan.jpg'],
    }).split('\n');

    expect(lines).toContain(
      'Car [ana@example.com]: 1 bills, 27.62 €, 0 subscriptions, 1 shops, 1 categories, 1 photos',
    );
    expect(lines).toContain(
      'Personal (ana@example.com): 0 bills, 0.00 €, 1 subscriptions, 0 shops, 0 categories, 0 photos',
    );
    expect(lines).toContain(
      '"Netflix" in Personal (ana@example.com): 0 charges, latest none, last charged month 2026-10-01, will be charged at next startup: none',
    );
    expect(lines[0]).toBe(
      'Target: postgres localhost:5432/piggy, uploads /srv/uploads',
    );
    expect(lines).toContain('1: orphan.jpg');
    expect(lines.slice(-2)).toEqual([
      '== Dry run',
      'Nothing was written. Run again with --apply to import.',
    ]);
  });

  it('shows each subscription’s latest charge, due months and a warning for a month charged ahead', () => {
    const lines = formatReport(
      {
        ...plan,
        report: {
          ...plan.report,
          subscriptions: [
            {
              name: 'Old',
              accountId: 'ana-personal',
              matches: 3,
              latest: '2026-07-15T06:00:00.000Z',
              latestLocalDate: '2026-07-15',
              lastChargedMonth: '2026-07-01',
              dueAtStartup: ['2026-08-15', '2026-09-15', '2026-10-15'],
              chargedAhead: false,
            },
            {
              name: 'Ahead',
              accountId: 'ana-personal',
              matches: 1,
              latest: '2026-10-20T06:00:00.000Z',
              latestLocalDate: '2026-10-20',
              lastChargedMonth: '2026-10-01',
              dueAtStartup: [],
              chargedAhead: true,
            },
          ],
        },
      },
      { target, users: [v2Ana], unreferenced: [] },
    ).split('\n');

    expect(lines).toContain(
      '"Old" in Personal (ana@example.com): 3 charges, latest 2026-07-15T06:00:00.000Z (Ljubljana 2026-07-15), ' +
        'last charged month 2026-07-01, will be charged at next startup: 2026-08-15, 2026-09-15, 2026-10-15',
    );
    expect(lines).toContain(
      '  warning: the charge date of 2026-10-01’s month is after the import day; check that v1 really charged it',
    );
  });

  it('ends with the photo sizes after an apply', () => {
    const lines = formatReport(plan, {
      target,
      users: [v2Ana],
      unreferenced: [],
      applied: { photos: 1, bytesBefore: 3_145_728, bytesAfter: 524_288 },
    }).split('\n');

    expect(lines.slice(-2)).toEqual([
      '== Applied',
      '1 photos, 3.0 MB → 0.5 MB',
    ]);
  });
});

describe('formatError', () => {
  it('prints the import’s own errors as they are', () => {
    expect(
      formatError(new ImportError('The v2 database already has data')),
    ).toBe('The v2 database already has data');
    expect(formatError(new DumpParseError('unknown escape', 7))).toBe(
      'dump line 7: unknown escape',
    );
  });

  it('gives a reason for other errors, also without a message', () => {
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}`), {
        code: 'ECONNREFUSED',
      });

    expect(
      formatError(
        new AggregateError([refused('::1:5432'), refused('127.0.0.1:5432')]),
      ),
    ).toBe(
      'AggregateError\n' +
        '  Error (ECONNREFUSED): connect ECONNREFUSED ::1:5432\n' +
        '  Error (ECONNREFUSED): connect ECONNREFUSED 127.0.0.1:5432',
    );
    expect(formatError(Object.assign(new Error(''), { code: 'EACCES' }))).toBe(
      'Error (EACCES)',
    );
    expect(formatError('boom')).toBe('boom');
  });
});
