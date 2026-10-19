import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
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
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      finalize(() => {
        const files = Array.isArray(request.files) ? request.files : [];
        for (const file of files) {
          void rm(file.path, { force: true });
        }
      }),
    );
  }
}
