import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MAX_PHOTO_BYTES,
  PHOTO_EXTENSIONS,
  deletePhotoFiles,
  isRandomPhotoName,
  photoExtension,
  photoFileFilter,
  photoFilename,
  photoUploadOptions,
} from './photo-files';

describe('photo-files', () => {
  describe('photoExtension', () => {
    it('lowercases allowed extensions', () => {
      expect(photoExtension('IMG.JPG')).toBe('jpg');
    });
    it('rejects disallowed or missing extensions', () => {
      expect(photoExtension('a.HEIC')).toBeNull();
      expect(photoExtension('noext')).toBeNull();
    });
  });

  describe('photoFilename', () => {
    it('generates a random v4 name with lowercase ext', () => {
      const a = photoFilename('IMG_1.JPG');
      expect(a).toMatch(/^[0-9a-f-]{36}\.jpg$/);
      expect(photoFilename('IMG_1.JPG')).not.toBe(a);
      expect(isRandomPhotoName(a)).toBe(true);
    });
    it('throws for disallowed types', () => {
      expect(() => photoFilename('a.pdf')).toThrow();
    });
  });

  describe('isRandomPhotoName', () => {
    it('is false for v5 uuids and non-uuid names', () => {
      expect(
        isRandomPhotoName('4ff67211-6e54-5e88-b478-1f2da73f00b2.jpg'),
      ).toBe(false);
      expect(isRandomPhotoName('x.jpg')).toBe(false);
    });
  });

  describe('photoFileFilter', () => {
    it('accepts .Png', () => {
      const cb = jest.fn();
      photoFileFilter({}, { originalname: 'a.Png' }, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });
    it('rejects .pdf with BadRequestException', () => {
      const cb = jest.fn();
      photoFileFilter({}, { originalname: 'a.pdf' }, cb);
      const err = cb.mock.calls[0][0];
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Photos must be JPG, PNG, GIF or WebP.');
    });
  });

  describe('config', () => {
    it('exposes limits and extensions', () => {
      expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
      expect(PHOTO_EXTENSIONS).toEqual(['jpg', 'jpeg', 'png', 'gif', 'webp']);
      expect(photoUploadOptions.limits?.fileSize).toBe(MAX_PHOTO_BYTES);
      expect(photoUploadOptions.fileFilter).toBe(photoFileFilter);
    });
  });

  describe('deletePhotoFiles', () => {
    let base: string;
    let root: string;
    const never = async () => false;
    const exists = (p: string) =>
      fs.access(p).then(
        () => true,
        () => false,
      );

    beforeEach(async () => {
      base = await fs.mkdtemp(path.join(os.tmpdir(), 'photos-'));
      root = path.join(base, 'uploads');
      await fs.mkdir(root);
    });
    afterEach(() => fs.rm(base, { recursive: true, force: true }));

    it('deletes an unreferenced file', async () => {
      await fs.writeFile(path.join(root, 'a.jpg'), 'x');
      await deletePhotoFiles(['a.jpg'], never, root, jest.fn());
      expect(await exists(path.join(root, 'a.jpg'))).toBe(false);
    });

    it('keeps a referenced file', async () => {
      await fs.writeFile(path.join(root, 'a.jpg'), 'x');
      await deletePhotoFiles(['a.jpg'], async () => true, root, jest.fn());
      expect(await exists(path.join(root, 'a.jpg'))).toBe(true);
    });

    it('refuses ../ traversal and logs', async () => {
      const outside = path.join(base, 'outside.txt');
      await fs.writeFile(outside, 'x');
      const log = jest.fn();
      await deletePhotoFiles(['../outside.txt'], never, root, log);
      expect(await exists(outside)).toBe(true);
      expect(log).toHaveBeenCalled();
    });

    it('refuses absolute paths outside the root', async () => {
      const outside = path.join(base, 'abs.txt');
      await fs.writeFile(outside, 'x');
      const log = jest.fn();
      await deletePhotoFiles([outside], never, root, log);
      expect(await exists(outside)).toBe(true);
      expect(log).toHaveBeenCalled();
    });

    it('refuses the root itself and sibling dirs sharing its prefix', async () => {
      const sibling = path.join(base, 'uploads-backup');
      await fs.mkdir(sibling);
      await fs.writeFile(path.join(sibling, 'a.jpg'), 'x');
      const log = jest.fn();
      await deletePhotoFiles(
        ['../uploads-backup/a.jpg', '', '.'],
        never,
        root,
        log,
      );
      expect(await exists(path.join(sibling, 'a.jpg'))).toBe(true);
      expect(await exists(root)).toBe(true);
    });

    it('does not throw for a missing file and logs', async () => {
      const log = jest.fn();
      await expect(
        deletePhotoFiles(['missing.jpg'], never, root, log),
      ).resolves.toBeUndefined();
      expect(log).toHaveBeenCalled();
    });

    it('does not throw when isReferenced fails, and keeps the file', async () => {
      await fs.writeFile(path.join(root, 'a.jpg'), 'x');
      const log = jest.fn();
      await deletePhotoFiles(
        ['a.jpg'],
        async () => {
          throw new Error('db down');
        },
        root,
        log,
      );
      expect(await exists(path.join(root, 'a.jpg'))).toBe(true);
      expect(log).toHaveBeenCalled();
    });

    it('continues after a failure on one path', async () => {
      await fs.writeFile(path.join(root, 'b.jpg'), 'x');
      await deletePhotoFiles(['../x', 'b.jpg'], never, root, jest.fn());
      expect(await exists(path.join(root, 'b.jpg'))).toBe(false);
    });
  });
});
