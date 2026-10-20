import type { ApplyResult } from './apply.js';
import type { Plan } from './plan.js';

const euros = (cents: number) => (cents / 100).toFixed(2);

/** The dry-run / apply summary for the terminal. */
export function formatReport(
  plan: Plan,
  extra: { unreferenced: string[]; applied?: ApplyResult },
): string {
  const r = plan.report;
  const lines: string[] = [];
  const section = (title: string) => lines.push('', `== ${title}`);
  const nameOf = new Map(plan.accounts.map((a) => [a.id, a.name]));
  const accountName = (id: string) =>
    nameOf.get(id) ?? `Personal (${id.slice(0, 8)})`;
  const emailOf = new Map(r.users.map((u) => [u.v2UserId, u.v1Email]));

  section('Users');
  for (const u of r.users) lines.push(`${u.v1Email} → v2 user ${u.v2UserId}`);
  if (r.leftOut.users.length > 0) {
    lines.push(
      `Left out: ${r.leftOut.users.join(', ')} (accounts: ${r.leftOut.accounts.join(', ') || 'none'}; ` +
        `${r.leftOut.bills} bills, ${r.leftOut.subscriptions} subscriptions, ${r.leftOut.photos} photos)`,
    );
  }

  section('Accounts');
  const count = (rows: { accountId: string }[], id: string) =>
    rows.filter((row) => row.accountId === id).length;
  const billAccount = new Map(plan.bills.map((b) => [b.id, b.accountId]));
  const photoRows = plan.photos.map((p) => ({
    accountId: billAccount.get(p.billId)!,
  }));
  const accountIds = new Set([
    ...plan.accounts.map((a) => a.id),
    ...plan.expected.map((e) => e.accountId),
    ...[...plan.shops, ...plan.categories, ...plan.subscriptions].map(
      (row) => row.accountId,
    ),
  ]);
  for (const id of accountIds) {
    const totals = plan.expected.find((e) => e.accountId === id);
    const members = plan.members
      .filter((m) => m.accountId === id)
      .map((m) => emailOf.get(m.userId) ?? m.userId);
    lines.push(
      `${accountName(id)}${members.length > 0 ? ` [${members.join(', ')}]` : ''}: ` +
        `${totals?.bills ?? 0} bills, ${euros(totals?.cents ?? 0)} €, ` +
        `${count(plan.subscriptions, id)} subscriptions, ${count(plan.shops, id)} shops, ` +
        `${count(plan.categories, id)} categories, ${count(photoRows, id)} photos`,
    );
  }
  lines.push(`Photos: ${plan.photos.length}`);

  section('Merged shops and categories');
  for (const m of r.merged)
    lines.push(
      `${m.kind} "${m.name}" in ${accountName(m.accountId)} ← v1 ${m.v1Ids.join(', ')}`,
    );
  if (r.merged.length === 0) lines.push('none');

  section('Bill dates');
  for (const [rule, n] of Object.entries(r.dateRules))
    lines.push(`${rule}: ${n}`);
  lines.push(
    `Web-era bills whose day depends on the reading: ${r.borderline.length}`,
  );
  for (const b of r.borderline)
    lines.push(
      `  bill ${b.billId} ${b.date}: as UTC ${b.asUtc}, as local ${b.asLocal} (imported as UTC)`,
    );

  section('Subscriptions');
  for (const s of r.subscriptions) {
    lines.push(
      `"${s.name ?? '(no name)'}" in ${accountName(s.accountId)}: ${s.matches} charges, latest ${s.latest ?? 'none'}, last charged month ${s.lastChargedMonth}`,
    );
  }

  section('Fix-ups');
  lines.push(...(r.fixUps.length > 0 ? r.fixUps : ['none']));

  section('Photo files without a row (ignored)');
  lines.push(
    extra.unreferenced.length > 0
      ? `${extra.unreferenced.length}: ${extra.unreferenced.join(', ')}`
      : 'none',
  );

  if (extra.applied) {
    const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
    section('Applied');
    lines.push(
      `${extra.applied.photos} photos, ${mb(extra.applied.bytesBefore)} MB → ${mb(extra.applied.bytesAfter)} MB`,
    );
  } else {
    section('Dry run');
    lines.push('Nothing was written. Run again with --apply to import.');
  }
  return lines.join('\n').trimStart();
}
