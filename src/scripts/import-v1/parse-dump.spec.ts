import { DumpParseError, parseDump } from './parse-dump.js';

const dump = (body: string) => `-- phpMyAdmin SQL Dump
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
/*!40101 SET NAMES utf8mb4 */;

CREATE TABLE \`bill\` (
  \`id\` int(11) NOT NULL,
  \`comment\` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

${body}
ALTER TABLE \`bill\`
  ADD PRIMARY KEY (\`id\`);
COMMIT;
`;

describe('parseDump', () => {
  it('reads multi-row inserts, batches, NULL and numbers as text', () => {
    const tables = parseDump(
      dump(`INSERT INTO \`bill\` (\`id\`, \`price\`, \`comment\`) VALUES
(1, 27.62, 'Spar'),
(2, -5, NULL);
INSERT INTO \`bill\` (\`id\`, \`price\`, \`comment\`) VALUES
(3, 0.50, '');`),
    );

    expect(tables.get('bill')).toEqual([
      { id: '1', price: '27.62', comment: 'Spar' },
      { id: '2', price: '-5', comment: null },
      { id: '3', price: '0.50', comment: '' },
    ]);
  });

  it('decodes every MySQL escape and keeps emoji and newlines', () => {
    const tables = parseDump(
      dump(
        String.raw`INSERT INTO ` +
          '`bill` (`id`, `comment`) VALUES\n' +
          String.raw`(1, 'it\'s ''ok'' \"q\" back\\slash\nline\r\ttab \0 \Z \% \_ 🧑‍🔧 ☕️ (a), (b);');`,
      ),
    );

    expect(tables.get('bill')?.[0].comment).toBe(
      "it's 'ok' \"q\" back\\slash\nline\r\ttab \0 \x1a \\% \\_ 🧑‍🔧 ☕️ (a), (b);",
    );
  });

  it('lists a table that has a CREATE TABLE but no rows', () => {
    expect(parseDump(dump('')).get('bill')).toEqual([]);
  });

  it.each([
    [
      'an unknown escape',
      "INSERT INTO `bill` (`id`, `comment`) VALUES\n(1, 'a\\qb');",
      12,
    ],
    [
      'a row with too few values',
      'INSERT INTO `bill` (`id`, `comment`) VALUES\n(1);',
      12,
    ],
    [
      'an unterminated string',
      "INSERT INTO `bill` (`id`, `comment`) VALUES\n(1, 'abc);",
      12,
    ],
    [
      'an unsupported value',
      'INSERT INTO `bill` (`id`, `comment`) VALUES\n(1, 0x41);',
      12,
    ],
  ])('fails with the line number on %s', (_case, body, line) => {
    const error: unknown = (() => {
      try {
        parseDump(dump(body));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(DumpParseError);
    expect((error as DumpParseError).line).toBe(line);
  });
});
