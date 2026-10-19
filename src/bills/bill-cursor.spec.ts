import { decodeBillCursor, encodeBillCursor } from './bill-cursor.js';

const id = '3f2b8c1e-6c4a-4f7e-9a1d-2b5c8e9f0a1b';

describe('bill cursor', () => {
  it('round-trips a date and an id', () => {
    const date = new Date('2026-10-16T11:26:00.123Z');

    expect(decodeBillCursor(encodeBillCursor({ date, id }))).toEqual({
      date,
      id,
    });
  });

  it.each([
    ['garbage', 'not-a-cursor'],
    ['empty', ''],
    ['an object', Buffer.from('{"d":1}').toString('base64url')],
    [
      'a bad date',
      Buffer.from(JSON.stringify(['nope', id])).toString('base64url'),
    ],
    [
      'a bad id',
      Buffer.from(JSON.stringify(['2026-10-16T11:26:00.000Z', 'x'])).toString(
        'base64url',
      ),
    ],
    [
      'three parts',
      Buffer.from(JSON.stringify(['2026-10-16T11:26:00.000Z', id, 1])).toString(
        'base64url',
      ),
    ],
  ])('rejects %s', (_case, token) => {
    expect(decodeBillCursor(token)).toBeNull();
  });
});
