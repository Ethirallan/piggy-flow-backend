import exifReader from 'exif-reader';
import sharp from 'sharp';
import { gif, jpeg, pngWithAlpha, webp } from '../../test/images.js';
import {
  processPhoto,
  TooManyPixelsError,
  UnsupportedImageError,
} from './photo-processing.js';

const exifOf = async (data: Buffer) => {
  const { exif } = await sharp(data).metadata();
  return exif ? exifReader(exif) : undefined;
};

describe('processPhoto', () => {
  it('keeps the EXIF orientation, drops camera and GPS tags, and reports displayed size', async () => {
    const result = await processPhoto(
      await jpeg(4000, 3000, { orientation: 6, gps: true }),
    );

    const meta = await sharp(result.jpeg).metadata();
    const exif = await exifOf(result.jpeg);
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([2560, 1920]); // stored as captured
    expect(meta.orientation).toBe(6);
    expect(exif?.Image).not.toHaveProperty('Make');
    expect(exif?.Image).not.toHaveProperty('Model');
    expect(exif).not.toHaveProperty('GPSInfo');
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect([result.width, result.height]).toEqual([1920, 2560]); // as displayed
  });

  it('does not enlarge a small image', async () => {
    const result = await processPhoto(await jpeg(640, 480));

    expect([result.width, result.height]).toEqual([640, 480]);
  });

  it.each([
    ['a PNG with transparency', () => pngWithAlpha()],
    ['a GIF', () => gif()],
    ['a WebP', () => webp()],
  ])('turns %s into a JPEG', async (_case, make) => {
    const result = await processPhoto(await make());

    expect((await sharp(result.jpeg).metadata()).format).toBe('jpeg');
  });

  it('rejects something that is not an image, whatever its name', async () => {
    await expect(
      processPhoto(Buffer.from('definitely not a jpeg')),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it('rejects an image over 50 megapixels', async () => {
    const huge = await sharp({
      create: { width: 7100, height: 7100, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 1 })
      .toBuffer();

    await expect(processPhoto(huge)).rejects.toBeInstanceOf(TooManyPixelsError);
  });
});
