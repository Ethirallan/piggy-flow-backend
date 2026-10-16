import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';

const SECRET_FIELDS = [
  'password',
  'currentPassword',
  'newPassword',
  'refreshToken',
  'accessToken',
];

/** Paths pino replaces with [REDACTED]: auth headers, and secret fields at the top level or one level down. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SECRET_FIELDS.flatMap((field) => [field, `*.${field}`]),
];

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuses a well-formed incoming X-Request-Id, otherwise makes a new one. */
export function requestIdFrom(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header)
    ? header
    : randomUUID();
}

export function buildLoggerParams(env: NodeJS.ProcessEnv = process.env): Params {
  const pretty = env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test';
  return {
    pinoHttp: {
      level: env.LOG_LEVEL ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      genReqId: (req, res) => {
        const id = requestIdFrom(req.headers['x-request-id']);
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url === '/health',
      },
      transport: pretty
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
    },
  };
}
