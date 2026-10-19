import { inlineJpegDisposition } from './content-disposition.js';

describe('inlineJpegDisposition', () => {
  it.each([
    [
      'receipt.png',
      `inline; filename="photo.jpg"; filename*=UTF-8''receipt.jpg`,
    ],
    [
      'račun (1).HEIC',
      `inline; filename="photo.jpg"; filename*=UTF-8''ra%C4%8Dun%20%281%29.jpg`,
    ],
    [
      "it's*.jpg",
      `inline; filename="photo.jpg"; filename*=UTF-8''it%27s%2A.jpg`,
    ],
    ['.hidden', `inline; filename="photo.jpg"; filename*=UTF-8''photo.jpg`],
    [
      'no-extension',
      `inline; filename="photo.jpg"; filename*=UTF-8''no-extension.jpg`,
    ],
  ])('%j', (name, expected) => {
    expect(inlineJpegDisposition(name)).toBe(expected);
  });
});
