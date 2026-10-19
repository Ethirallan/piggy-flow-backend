import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { rm } from 'node:fs/promises';
import { finalize, type Observable } from 'rxjs';

/**
 * Deletes the request's multer temp files once the request is done —
 * after success, a validation error (pipes run inside this), or any other
 * failure. Must run inside the FilesInterceptor.
 */
@Injectable()
export class RemoveUploadsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RemoveUploadsInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      finalize(() => {
        const files = Array.isArray(request.files) ? request.files : [];
        for (const file of files) {
          // A failed delete must never become an unhandled rejection.
          rm(file.path, { force: true }).catch((error: unknown) =>
            this.logger.warn({
              event: 'photos.temp_delete_failed',
              error: String(error),
            }),
          );
        }
      }),
    );
  }
}
