import type { BillPhoto } from '../bill-photo.entity.js';

export class PhotoResponseDto {
  id: string;
  /** The uploaded file's name. */
  name: string;
  /** As displayed, in pixels. */
  width: number;
  /** As displayed, in pixels. */
  height: number;
  /** The stored JPEG's size. */
  sizeBytes: number;
  createdAt: Date;

  static from(photo: BillPhoto): PhotoResponseDto {
    return {
      id: photo.id,
      name: photo.name,
      width: photo.width,
      height: photo.height,
      sizeBytes: photo.sizeBytes,
      createdAt: photo.createdAt,
    };
  }
}
