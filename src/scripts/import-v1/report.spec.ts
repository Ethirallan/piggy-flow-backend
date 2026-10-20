import { planImport, type V2User } from './plan.js';
import { formatReport } from './report.js';
import { v1Tables } from './testing/v1-tables.js';
import { toSnapshot } from './v1-snapshot.js';

const v2Ana: V2User = {
  id: 'ana',
  email: 'ana@example.com',
  personalAccountId: 'ana-personal',
};

describe('formatReport', () => {
  let n = 0;
  const plan = planImport(toSnapshot(v1Tables()), [v2Ana], {
    dismissedEmails: [],
    today: '2026-10-20',
    newId: () => `id-${++n}`,
  });

  it('lists every account the import writes to, also one without bills', () => {
    const lines = formatReport(plan, { unreferenced: ['orphan.jpg'] }).split(
      '\n',
    );

    expect(lines).toContain(
      'Car [ana@example.com]: 1 bills, 27.62 €, 0 subscriptions, 1 shops, 1 categories, 1 photos',
    );
    expect(lines).toContain(
      'Personal (ana-pers): 0 bills, 0.00 €, 1 subscriptions, 0 shops, 0 categories, 0 photos',
    );
    expect(lines).toContain(
      '"Netflix" in Personal (ana-pers): 0 charges, latest none, last charged month 2026-10-01',
    );
    expect(lines).toContain('1: orphan.jpg');
    expect(lines.slice(-2)).toEqual([
      '== Dry run',
      'Nothing was written. Run again with --apply to import.',
    ]);
  });

  it('ends with the photo sizes after an apply', () => {
    const lines = formatReport(plan, {
      unreferenced: [],
      applied: { photos: 1, bytesBefore: 3_145_728, bytesAfter: 524_288 },
    }).split('\n');

    expect(lines.slice(-2)).toEqual([
      '== Applied',
      '1 photos, 3.0 MB → 0.5 MB',
    ]);
  });
});
