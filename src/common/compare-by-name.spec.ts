import { compareByName } from './compare-by-name.js';

const named = (name: string, day: number) => ({
  name,
  createdAt: new Date(Date.UTC(2026, 9, day)),
});

describe('compareByName', () => {
  it('sorts by name ignoring case, accents counting, then oldest first', () => {
    const rows = [
      named('spar', 1),
      named('Lidl', 3),
      named('lidl', 2),
      named('Špar', 4),
      named('Hofer', 5),
    ];

    expect(
      rows
        .sort(compareByName)
        .map((r) => `${r.name} ${r.createdAt.getUTCDate()}`),
    ).toEqual(['Hofer 5', 'lidl 2', 'Lidl 3', 'spar 1', 'Špar 4']);
  });
});
