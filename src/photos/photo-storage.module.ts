import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { PhotoStorage, UPLOADS_DIR } from './photo-storage.js';

@Module({
  providers: [
    {
      provide: UPLOADS_DIR,
      // `/app/uploads` in the container (WORKDIR /app).
      useFactory: () => resolve(process.env.UPLOADS_DIR || 'uploads'),
    },
    PhotoStorage,
  ],
  exports: [PhotoStorage],
})
export class PhotoStorageModule {}
