import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';
import { BillsModule } from '../bills/bills.module.js';
import { BillPhoto } from './bill-photo.entity.js';
import { PhotoStorage } from './photo-storage.js';
import { PhotoStorageModule } from './photo-storage.module.js';
import {
  MAX_FILES_PER_REQUEST,
  MAX_UPLOAD_BYTES,
  PhotosController,
} from './photos.controller.js';
import { PhotosService } from './photos.service.js';

@Module({
  imports: [
    BillsModule,
    PhotoStorageModule,
    TypeOrmModule.forFeature([BillPhoto]),
    MulterModule.registerAsync({
      imports: [PhotoStorageModule],
      inject: [PhotoStorage],
      useFactory: (storage: PhotoStorage) => ({
        // Streamed to disk, never held in memory; names are random.
        storage: diskStorage({
          destination: storage.incomingDir,
          filename: (_request, _file, done) => done(null, randomUUID()),
        }),
        // Browsers send file names as raw UTF-8; multer reads Latin-1 by default.
        defParamCharset: 'utf8',
        limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_REQUEST },
      }),
    }),
  ],
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
