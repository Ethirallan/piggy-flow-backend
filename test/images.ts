import sharp from 'sharp';

const red = { r: 204, g: 51, b: 51 };

/**
 * A JPEG, optionally with an EXIF orientation and with camera + GPS tags
 * (the metadata processing must drop).
 */
export async function jpeg(
  width = 64,
  height = 48,
  options: { orientation?: number; gps?: boolean } = {},
): Promise<Buffer> {
  let image = sharp({
    create: { width, height, channels: 3, background: red },
  }).jpeg();
  if (options.gps) {
    image = image.withExif({
      IFD0: { Make: 'Cam', Model: 'X1' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '46/1 3/1 0/1' },
    });
  }
  const base = await image.toBuffer();
  return options.orientation
    ? sharp(base)
        .withMetadata({ orientation: options.orientation })
        .keepExif()
        .jpeg()
        .toBuffer()
    : base;
}

export function pngWithAlpha(width = 32, height = 32): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

export function gif(width = 16, height = 16): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { ...red, alpha: 1 } },
  })
    .gif()
    .toBuffer();
}

export function webp(width = 16, height = 16): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: red } })
    .webp()
    .toBuffer();
}
