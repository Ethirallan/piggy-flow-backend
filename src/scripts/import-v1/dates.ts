import {
  CHARGE_TIME_ZONE,
  localToday,
} from '../../subscriptions/charge-schedule.js';

/** The web app's first commit: before it, only the mobile app wrote bills. */
export const WEB_APP_START = '2026-09-27';

const TOLERANCE_MS = 10 * 60_000;

/** Which rule decided how a v1 bill date was read (spec: "Bill dates"). */
export type DateRule =
  'same-as-created' | 'local-entry' | 'mobile-era' | 'web-era';

const WALL =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

function wallAsUtcMs(wall: string): number {
  const m = WALL.exec(wall);
  if (!m) {
    throw new Error(`Invalid v1 datetime "${wall}"`);
  }
  const [, y, mo, d, h, mi, s, frac = '0'] = m;
  const ms = Math.floor(Number(frac.padEnd(6, '0')) / 1000);
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, ms);
}

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: CHARGE_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Ljubljana's UTC offset (ms) at an instant. */
function offsetAt(instantMs: number): number {
  const parts = Object.fromEntries(
    PARTS.formatToParts(new Date(instantMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    +parts.year,
    +parts.month - 1,
    +parts.day,
    +parts.hour,
    +parts.minute,
    +parts.second,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** A v1 wall time (`YYYY-MM-DD HH:MM:SS[.ffffff]`) read as UTC or as Ljubljana time. */
export function wallTimeToInstant(wall: string, zone: 'utc' | 'local'): Date {
  const asUtc = wallAsUtcMs(wall);
  if (zone === 'utc') {
    return new Date(asUtc);
  }
  // Two passes settle the offset on either side of a DST change.
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant);
}

/** Reads a v1 bill date; `created` is MariaDB's UTC insert time. */
export function readBillDate(
  date: string,
  created: string,
): { instant: Date; rule: DateRule; daysDiffer: boolean } {
  const asUtc = wallTimeToInstant(date, 'utc');
  const asLocal = wallTimeToInstant(date, 'local');
  const createdMs = wallAsUtcMs(created);
  const offset = asUtc.getTime() - asLocal.getTime();
  const daysDiffer = localToday(asUtc) !== localToday(asLocal);
  if (Math.abs(asUtc.getTime() - createdMs) <= TOLERANCE_MS) {
    return { instant: asUtc, rule: 'same-as-created', daysDiffer };
  }
  if (Math.abs(asUtc.getTime() - createdMs - offset) <= TOLERANCE_MS) {
    return { instant: asLocal, rule: 'local-entry', daysDiffer };
  }
  return created < WEB_APP_START
    ? { instant: asLocal, rule: 'mobile-era', daysDiffer }
    : { instant: asUtc, rule: 'web-era', daysDiffer };
}

/** decimal(10,2) text → integer cents, without floating point. */
export function toCents(price: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(price);
  if (!m) {
    throw new Error(`Invalid v1 price "${price}"`);
  }
  const [, sign, whole, fraction = ''] = m;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}

/** At most `max` code points (Postgres counts code points). */
export function cutCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}
