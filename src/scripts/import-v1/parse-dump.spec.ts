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
          String.raw`(1, 'it\'s ''ok'' \"q\" back\\slash \b\nline\r\ttab \0 \Z \% \_ 🧑‍🔧 ☕️ (a), (b);');`,
      ),
    );

    expect(tables.get('bill')?.[0].comment).toBe(
      "it's 'ok' \"q\" back\\slash \b\nline\r\ttab \0 \x1a \\% \\_ 🧑‍🔧 ☕️ (a), (b);",
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
    ['INSERT IGNORE', 'INSERT IGNORE INTO `bill` (`id`) VALUES\n(1);', 11],
    ['REPLACE INTO', 'REPLACE INTO `bill` (`id`) VALUES\n(1);', 11],
    [
      'a repeated column',
      'INSERT INTO `bill` (`id`, `id`) VALUES\n(1, 2);',
      11,
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

  it('parses lowercase and oddly spaced keywords', () => {
    const tables = parseDump(
      dump(
        'insert  into `bill` (`id`) values\n(1);\nInsert Into `bill` (`id`) VALUES\n(2);',
      ),
    );

    expect(tables.get('bill')).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('skips quotes and semicolons inside CREATE TABLE and ALTER statements', () => {
    const sql = [
      "CREATE TABLE `t` (`a` int COMMENT 'it''s; (x)', `b` text COMMENT 'a\\'b;') ENGINE=InnoDB;",
      "ALTER TABLE `t` COMMENT = 'x; y';",
      'INSERT INTO `t` (`a`) VALUES\n(1);',
    ].join('\n');

    expect(parseDump(sql).get('t')).toEqual([{ a: '1' }]);
  });

  it('counts lines in a CRLF dump', () => {
    const crlf = dump(
      'INSERT INTO `bill` (`id`) VALUES\n(1),\n(x);',
    ).replaceAll('\n', '\r\n');
    const error: unknown = (() => {
      try {
        parseDump(crlf);
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(DumpParseError);
    expect((error as DumpParseError).line).toBe(13);
    expect(
      parseDump(
        dump('INSERT INTO `bill` (`id`) VALUES\n(1);').replaceAll('\n', '\r\n'),
      ).get('bill'),
    ).toEqual([{ id: '1' }]);
  });

  it('names an unsupported statement', () => {
    expect(() =>
      parseDump(dump('INSERT IGNORE INTO `bill` (`id`) VALUES\n(1);')),
    ).toThrow('unsupported statement "INSERT IGNORE"');
  });

  it('reports the end of the dump inside an insert', () => {
    expect(() => parseDump('INSERT INTO `t` (`a`) VALUES\n(1')).toThrow(
      'end of dump',
    );
    expect(() => parseDump('INSERT INTO `t` (`a`) VALUES\n(1)')).toThrow(
      'end of dump',
    );
  });
});
