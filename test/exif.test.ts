import { expect, it } from 'vitest';
import { scanUploads } from '../src/import/exifUpload';

/** Minimal little-endian TIFF with a GPS IFD (27°42′ N, 85°18′ E). */
function gpsTiff() {
  const bytes = new Uint8Array(128);
  const v = new DataView(bytes.buffer);
  const u16 = (at: number, n: number) => v.setUint16(at, n, true);
  const u32 = (at: number, n: number) => v.setUint32(at, n, true);
  bytes.set([0x49, 0x49, 42, 0]);
  u32(4, 8);
  u16(8, 1);
  u16(10, 0x8825); u16(12, 4); u32(14, 1); u32(18, 26);
  u16(26, 4);
  const tag = (at: number, id: number, type: number, count: number, value: number) => {
    u16(at, id); u16(at + 2, type); u32(at + 4, count); u32(at + 8, value);
  };
  tag(28, 1, 2, 2, 78); // N
  tag(40, 2, 5, 3, 80);
  tag(52, 3, 2, 2, 69); // E
  tag(64, 4, 5, 3, 104);
  [27, 42, 0, 85, 18, 0].forEach((n, i) => { u32(80 + i * 8, n); u32(84 + i * 8, 1); });
  return bytes;
}

it('retains embedded GPS when reading uploaded photos', async () => {
  const [candidate] = await scanUploads([new File([gpsTiff()], 'IMG_20261017_120000.tif', { type: 'image/tiff' })]);
  expect(candidate.photo.lat).toBeCloseTo(27.7);
  expect(candidate.photo.lng).toBeCloseTo(85.3);
});

it('records where an uploaded photo’s time came from', async () => {
  const [named, bare] = await scanUploads([
    new File([gpsTiff()], 'IMG_20261017_120000.tif', { type: 'image/tiff' }),
    new File([gpsTiff()], 'shared.tif', { type: 'image/tiff' }),
  ]);
  expect(named.photo.timeSource).toBe('filename');
  expect(bare.photo.timeSource).toBe('file');
});
