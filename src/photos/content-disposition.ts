/**
 * `inline` with the photo's name as a .jpg (it's always stored as JPEG):
 * an ASCII fallback plus the RFC 5987 UTF-8 form.
 */
export function inlineJpegDisposition(name: string): string {
  const stem = name.replace(/\.[^.]*$/, '') || 'photo';
  const encoded = encodeURIComponent(`${stem}.jpg`).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="photo.jpg"; filename*=UTF-8''${encoded}`;
}
