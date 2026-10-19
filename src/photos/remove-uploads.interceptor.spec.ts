import {
  Logger,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { RemoveUploadsInterceptor } from './remove-uploads.interceptor.js';

const rm = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ rm }));

describe('RemoveUploadsInterceptor', () => {
  const context = (files: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ files }) }),
    }) as ExecutionContext;
  const handler: CallHandler = { handle: () => of('done') };

  afterEach(() => vi.restoreAllMocks());

  it('removes every temp file once the request is done', async () => {
    rm.mockResolvedValue(undefined);

    await lastValueFrom(
      new RemoveUploadsInterceptor().intercept(
        context([{ path: '/tmp/a' }, { path: '/tmp/b' }]),
        handler,
      ),
    );

    expect(rm).toHaveBeenCalledWith('/tmp/a', { force: true });
    expect(rm).toHaveBeenCalledWith('/tmp/b', { force: true });
  });

  it('logs a failed delete instead of letting the rejection escape', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    rm.mockRejectedValue(new Error('EACCES'));

    await lastValueFrom(
      new RemoveUploadsInterceptor().intercept(
        context([{ path: '/tmp/a' }]),
        handler,
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);

    expect(warn).toHaveBeenCalledWith({
      event: 'photos.temp_delete_failed',
      error: 'Error: EACCES',
    });
    expect(unhandled).not.toHaveBeenCalled();
  });
});
