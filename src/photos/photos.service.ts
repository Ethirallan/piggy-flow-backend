import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BillsService } from '../bills/bills.service.js';
import { BillPhoto } from './bill-photo.entity.js';
import { photoDisplayName } from './photo-name.js';
import {
  processPhoto,
  type ProcessedPhoto,
  TooManyPixelsError,
  UnsupportedImageError,
} from './photo-processing.js';
import { PhotoStorage, type StoredPhoto } from './photo-storage.js';

export const PHOTO_NOT_FOUND = 'Photo not found';
export const NO_PHOTOS = 'No photos';
export const MAX_PHOTOS_PER_BILL = 10;
export const TOO_MANY_PHOTOS = `A bill can have at most ${MAX_PHOTOS_PER_BILL} photos`;

/** An uploaded file waiting in the incoming directory. */
export interface PhotoUpload {
  path: string;
  originalName: string;
}

@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @InjectRepository(BillPhoto)
    private readonly photos: Repository<BillPhoto>,
    private readonly bills: BillsService,
    private readonly storage: PhotoStorage,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Adds photos to a bill, all or nothing. The images are processed first,
   * outside any transaction; then the bill row is locked so concurrent
   * uploads can't push it past MAX_PHOTOS_PER_BILL.
   */
  async add(
    userId: string,
    billId: string,
    uploads: PhotoUpload[],
  ): Promise<BillPhoto[]> {
    if (uploads.length === 0) {
      throw new BadRequestException(NO_PHOTOS);
    }
    const processed: { name: string; photo: ProcessedPhoto }[] = [];
    for (const upload of uploads) {
      processed.push({
        name: photoDisplayName(upload.originalName),
        photo: await asHttpError(processPhoto(upload.path)),
      });
    }

    const written: string[] = [];
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.bills.lockForMember(billId, userId, manager);
        const repo = manager.getRepository(BillPhoto);
        const existing = await repo.countBy({ billId });
        if (existing + processed.length > MAX_PHOTOS_PER_BILL) {
          throw new ConflictException(TOO_MANY_PHOTOS);
        }
        const saved: BillPhoto[] = [];
        // now() is the transaction's start, the same for the whole batch;
        // one millisecond apart keeps the upload order when listing.
        const startedAt = Date.now();
        for (const [index, { name, photo }] of processed.entries()) {
          const row = await repo.save(
            repo.create({
              billId,
              name,
              width: photo.width,
              height: photo.height,
              sizeBytes: photo.jpeg.length,
              createdById: userId,
              createdAt: new Date(startedAt + index),
            }),
          );
          await this.storage.write(row.id, photo.jpeg);
          written.push(row.id);
          saved.push(row);
        }
        return saved;
      });
    } catch (error) {
      await this.discard(written);
      throw error;
    }
  }

  /** The photo and its file, if the caller can see the bill; otherwise 404. */
  async open(
    userId: string,
    billId: string,
    photoId: string,
  ): Promise<{ photo: BillPhoto; file: StoredPhoto }> {
    await this.bills.findForMember(billId, userId);
    const photo = await this.photos.findOneBy({ id: photoId, billId });
    if (!photo) {
      throw new NotFoundException(PHOTO_NOT_FOUND);
    }
    const file = await this.storage.open(photo.id);
    if (!file) {
      this.logger.error({ event: 'photos.file_missing', photoId: photo.id });
      throw new NotFoundException(PHOTO_NOT_FOUND);
    }
    return { photo, file };
  }

  /**
   * Deletes the row, then the file (a failed file delete only leaves an
   * unreferenced file). Storage only sees the id the database holds: a route
   * param may be upper case, storage accepts lower case only.
   */
  async remove(userId: string, billId: string, photoId: string): Promise<void> {
    await this.bills.findForMember(billId, userId);
    const photo = await this.photos.findOneBy({ id: photoId, billId });
    if (!photo) {
      throw new NotFoundException(PHOTO_NOT_FOUND);
    }
    const { affected } = await this.photos.delete({ id: photo.id, billId });
    if (!affected) {
      throw new NotFoundException(PHOTO_NOT_FOUND);
    }
    await this.deleteFile(photo.id);
  }

  /** Files written by a request whose rows didn't commit. */
  private async discard(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        // A commit can fail after it succeeded server-side; keep referenced files.
        if (!(await this.photos.existsBy({ id }))) {
          await this.storage.delete(id);
        }
      } catch (error) {
        this.logger.warn({
          event: 'photos.discard_failed',
          photoId: id,
          error: String(error),
        });
      }
    }
  }

  private async deleteFile(photoId: string): Promise<void> {
    try {
      await this.storage.delete(photoId);
    } catch (error) {
      this.logger.warn({
        event: 'photos.file_delete_failed',
        photoId,
        error: String(error),
      });
    }
  }
}

async function asHttpError<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (
      error instanceof UnsupportedImageError ||
      error instanceof TooManyPixelsError
    ) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
