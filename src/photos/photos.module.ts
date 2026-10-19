import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillsModule } from '../bills/bills.module.js';
import { BillPhoto } from './bill-photo.entity.js';
import { PhotoStorageModule } from './photo-storage.module.js';
import { PhotosService } from './photos.service.js';

@Module({
  imports: [
    BillsModule,
    PhotoStorageModule,
    TypeOrmModule.forFeature([BillPhoto]),
  ],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
