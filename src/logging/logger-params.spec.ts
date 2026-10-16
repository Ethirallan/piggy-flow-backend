import { Writable } from 'node:stream';
import { pino } from 'pino';
import type { Options } from 'pino-http';
import { buildLoggerParams, requestIdFrom } from './logger-params.js';

function httpOptions(env: NodeJS.ProcessEnv): Options {
  return buildLoggerParams(env).pinoHttp as Options;
}

function captureLogger(options: Options) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: pino({ redact: options.redact }, stream), lines };
}

describe('buildLoggerParams', () => {
  it('redacts secret fields and auth headers', () => {
    const { logger, lines } = captureLogger(httpOptions({ NODE_ENV: 'test' }));

    logger.info({
      password: 'hunter22-secret',
      dto: { refreshToken: 'refresh-secret', newPassword: 'new-secret' },
      req: { headers: { authorization: 'Bearer access-secret' } },
    });

    const output = lines.join('');
    expect(output).not.toMatch(
      /hunter22-secret|refresh-secret|new-secret|access-secret/,
    );
    expect(output).toContain('[REDACTED]');
  });

  it('uses LOG_LEVEL, defaulting to info', () => {
    expect(httpOptions({ NODE_ENV: 'test', LOG_LEVEL: 'warn' }).level).toBe(
      'warn',
    );
    expect(httpOptions({ NODE_ENV: 'test' }).level).toBe('info');
  });

  it('pretty-prints only outside production and tests', () => {
    expect(httpOptions({ NODE_ENV: 'production' }).transport).toBeUndefined();
    expect(httpOptions({ NODE_ENV: 'test' }).transport).toBeUndefined();
    expect(httpOptions({}).transport).toMatchObject({ target: 'pino-pretty' });
  });
});

describe('requestIdFrom', () => {
  it('keeps a well-formed incoming id', () => {
    expect(requestIdFrom('abc-123_x.y')).toBe('abc-123_x.y');
  });

  it.each([
    ['missing', undefined],
    ['repeated header', ['a', 'b']],
    ['unsafe characters', 'a b<script>'],
    ['too long', 'a'.repeat(129)],
  ])('generates a new id when the header is %s', (_case, header) => {
    expect(requestIdFrom(header)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
