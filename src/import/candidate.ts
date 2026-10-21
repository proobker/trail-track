import type { Photo } from '../model/types';

/** A photo found during an import scan; the image bytes are only read if it is kept. */
export interface PhotoCandidate {
  photo: Photo;
  getBlob?: () => Promise<Blob>;
}

const THUMB_PX = 256;
const PREVIEW_PX = 1280;

/** A small, local image fingerprint. It cannot identify a named place. */
function visualHash(bmp: ImageBitmap): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(bmp, 0, 0, 9, 8);
  const data = ctx.getImageData(0, 0, 9, 8).data;
  let bits = 0n;
  let on = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const at = (y * 9 + x) * 4;
      const next = at + 4;
      const light = (i: number) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const bit = light(at) > light(next) ? 1 : 0;
      bits = (bits << 1n) | BigInt(bit);
      on += bit;
    }
  }
  // Flat images and simple gradients otherwise look like false near-duplicates.
  return on >= 8 && on <= 56 ? bits.toString(16).padStart(16, '0') : undefined;
}

function scaled(bmp: ImageBitmap, px: number): Promise<Blob | undefined> {
  const scale = Math.min(1, px / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob((b) => r(b ?? undefined), 'image/jpeg', 0.82));
}

/** Decodes an image once and returns a marker-sized thumbnail and a lightbox-sized preview. */
export async function makeImages(blob: Blob): Promise<{ thumbBlob?: Blob; previewBlob?: Blob; visualHash?: string }> {
  try {
    const bmp = await createImageBitmap(blob);
    const hash = visualHash(bmp);
    const [thumbBlob, previewBlob] = await Promise.all([scaled(bmp, THUMB_PX), scaled(bmp, PREVIEW_PX)]);
    bmp.close();
    return { thumbBlob, previewBlob, visualHash: hash };
  } catch {
    // Videos, HEIC and other formats the browser can't decode simply get no images.
    return {};
  }
}

/** Reads and thumbnails the kept candidates, a few at a time. */
export async function materialize(cands: PhotoCandidate[], onProgress?: (done: number, total: number) => void): Promise<Photo[]> {
  const out: Photo[] = new Array(cands.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < cands.length) {
      const i = next++;
      const c = cands[i];
      let images = {};
      if (c.getBlob) {
        try {
          images = await makeImages(await c.getBlob());
        } catch {
          images = {};
        }
      }
      out[i] = { ...c.photo, ...images };
      onProgress?.(++done, cands.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}
