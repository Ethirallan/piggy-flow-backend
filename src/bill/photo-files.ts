import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { diskStorage } from 'multer';

export const PHOTO_EXTENSIONS: readonly string[] = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const UPLOADS_DIR = './uploads';

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
    destination: UPLOADS_DIR,
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

export async function deletePhotoFiles(
  paths: string[],
  isReferenced: (path: string) => Promise<boolean>,
  root = UPLOADS_DIR,
  log: (msg: string) => void = console.warn,
): Promise<void> {
  const rootAbs = resolve(root);
  for (const path of paths) {
    try {
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
