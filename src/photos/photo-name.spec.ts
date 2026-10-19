import { photoDisplayName } from './photo-name.js';

describe('photoDisplayName', () => {
  it.each([
    ['receipt.jpg', 'receipt.jpg'],
    ['C:\\Users\\ana\\IMG_0001.HEIC', 'IMG_0001.HEIC'],
    ['../../etc/passwd', 'passwd'],
    ['  spaced.png  ', 'spaced.png'],
    ['bad\u0000\u001fname.jpg', 'badname.jpg'],
    ['', 'photo'],
    ['   ', 'photo'],
  ])('%j → %j', (input, expected) => {
    expect(photoDisplayName(input)).toBe(expected);
  });

  it('cuts to 255 code points', () => {
    expect([...photoDisplayName('😀'.repeat(300))]).toHaveLength(255);
  });
});
