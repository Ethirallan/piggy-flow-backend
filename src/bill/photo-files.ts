import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { encode } from 'blurhash';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { diskStorage } from 'multer';

export const PHOTO_EXTENSIONS: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_CREATE_PHOTO_BYTES = 50 * 1024 * 1024;
export const UPLOADS_DIR = './uploads';

/**
 * The uploads directory: `UPLOADS_DIR` from the environment (used by tests),
 * otherwise `./uploads`. Read on every call so uploads, deletes and reads
 * always agree on one directory.
 */
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR || UPLOADS_DIR;
}

const RANDOM_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function photoExtension(originalName: string): string | null {
  const ext = extname(originalName).slice(1).toLowerCase();
  return PHOTO_EXTENSIONS.includes(ext) ? ext : null;
}

export function photoFilename(originalName: string): string {
  const ext = photoExtension(originalName);
  if (!ext) {
    throw new BadRequestException('Photos must be JPG, PNG, GIF or WebP.');
  }
  return `${randomUUID()}.${ext}`;
}

export function isRandomPhotoName(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  return RANDOM_NAME.test(stem);
}

export function photoFileFilter(
  req: any,
  file: { originalname: string },
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (photoExtension(file.originalname)) {
    cb(null, true);
  } else {
    cb(new BadRequestException('Photos must be JPG, PNG, GIF or WebP.'), false);
  }
}

export const photoUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      const dir = uploadsDir();
      mkdir(dir, { recursive: true }).then(
        () => cb(null, dir),
        (e) => cb(e, dir),
      );
    },
    filename: (req, file, cb) => {
      try {
        cb(null, photoFilename(file.originalname));
      } catch (e) {
        cb(e as Error, '');
      }
    },
  }),
  fileFilter: photoFileFilter,
  limits: { fileSize: MAX_PHOTO_BYTES },
};

/**
 * Upload options for `POST /bill`. Same storage as
 * `photoUploadOptions`, but with a larger size limit (the mobile app ignores
 * response codes, so a rejected photo would silently lose the bill) and a
 * disallowed file is skipped instead of failing the request, as the mobile
 * app has always relied on.
 */
export const photoCreateUploadOptions: MulterOptions = {
  ...photoUploadOptions,
  limits: { fileSize: MAX_CREATE_PHOTO_BYTES },
  fileFilter: (req, file, cb) =>
    cb(null, photoExtension(file.originalname) !== null),
};

export async function deletePhotoFiles(
  paths: string[],
  isReferenced: (path: string) => Promise<boolean>,
  root = uploadsDir(),
  log: (msg: string) => void = console.warn,
): Promise<void> {
  const rootAbs = resolve(root);
  for (const path of paths) {
    try {
      if (
        path === '' ||
        path === '.' ||
        path === '..' ||
        path.includes('\\') ||
        basename(path) !== path
      ) {
        log(`Refusing to delete non-filename photo path: ${path}`);
        continue;
      }
      const target = resolve(rootAbs, path);
      const rel = relative(rootAbs, target);
      if (
        rel === '' ||
        rel === '..' ||
        rel.startsWith('..' + '/') ||
        rel.startsWith('..\\') ||
        isAbsolute(rel)
      ) {
        log(`Refusing to delete photo outside uploads: ${path}`);
        continue;
      }
      if (await isReferenced(path)) continue;
      await unlink(target);
    } catch (e) {
      log(`Failed to delete photo ${path}: ${(e as Error)?.message ?? e}`);
    }
  }
}

// sharp is loaded on first use, so modules importing this file (and their
// tests) don't need its native binary. A load failure rejects, and callers
// fall back to the '000000' blurhash.
export const encodeImageToBlurhash = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp: typeof import('sharp') = require('sharp');
    sharp(path)
      .rotate()
      .raw()
      .ensureAlpha()
      .resize(32, 32, { fit: 'inside' })
      .toBuffer((err, buffer, info) => {
        if (err) return reject(err);

        const { width, height } = info;
        if (typeof width !== 'number' || typeof height !== 'number') {
          return reject(new Error('Invalid image dimensions'));
        }

        resolve(encode(new Uint8ClampedArray(buffer), width, height, 7, 7));
      });
  });
