const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a page ended: the last bill's date and id (the list's sort key). */
export interface BillCursor {
  date: Date;
  id: string;
}

export function encodeBillCursor({ date, id }: BillCursor): string {
  return Buffer.from(JSON.stringify([date.toISOString(), id])).toString(
    'base64url',
  );
}

/** The cursor, or null when the token isn't one this API issued. */
export function decodeBillCursor(token: string): BillCursor | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const [iso, id] = value as unknown[];
  if (typeof iso !== 'string' || typeof id !== 'string' || !UUID.test(id)) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : { date, id };
}
