import sharp, { type Metadata, type OutputInfo } from 'sharp';

export const MAX_SIDE = 2560;
export const MAX_PIXELS = 50_000_000;
export const JPEG_QUALITY = 82;

export class UnsupportedImageError extends Error {
  constructor() {
    super('Unsupported image');
  }
}

export class TooManyPixelsError extends Error {
  constructor() {
    super('Image has too many pixels');
  }
}

export interface ProcessedPhoto {
  jpeg: Buffer;
  /** As displayed (after the EXIF orientation is applied). */
  width: number;
  height: number;
}

function isSupported(meta: Metadata): boolean {
  switch (meta.format) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'gif':
      return true;
    case 'heif':
      // AVIF only: the prebuilt Sharp can't decode HEIC (HEVC).
      return meta.compression === 'av1';
    default:
      return false;
  }
}

/** Throws what processPhoto throws for an image with this header. */
export function assertConvertible(meta: Metadata): void {
  if (!isSupported(meta)) {
    throw new UnsupportedImageError();
  }
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_PIXELS) {
    throw new TooManyPixelsError();
  }
}

/**
 * Re-encodes an upload as a JPEG that fits MAX_SIDE, keeping only the EXIF
 * Orientation tag (no GPS, camera or other metadata). Pixels aren't rotated:
 * browsers apply the orientation when they show the photo.
 */
export async function processPhoto(
  input: string | Buffer,
): Promise<ProcessedPhoto> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata(); // reads the header only
  } catch {
    throw new UnsupportedImageError();
  }
  assertConvertible(meta);
  const orientation = meta.orientation ?? 1;

  let out: { data: Buffer; info: OutputInfo };
  try {
    out = await sharp(input, { limitInputPixels: MAX_PIXELS, pages: 1 })
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .withExif({ IFD0: { Orientation: String(orientation) } })
      .toBuffer({ resolveWithObject: true });
  } catch {
    // A truncated or corrupt file that only looked like an image.
    throw new UnsupportedImageError();
  }

  const sideways = orientation >= 5;
  return {
    jpeg: out.data,
    width: sideways ? out.info.height : out.info.width,
    height: sideways ? out.info.width : out.info.height,
  };
}
