import type { Photo } from '../model/types';

/** A photo found during an import scan; the image bytes are only read if it is kept. */
export interface PhotoCandidate {
  photo: Photo;
  getBlob?: () => Promise<Blob>;
}

const THUMB_PX = 256;
const PREVIEW_PX = 1280;

function scaled(bmp: ImageBitmap, px: number): Promise<Blob | undefined> {
  const scale = Math.min(1, px / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob((b) => r(b ?? undefined), 'image/jpeg', 0.82));
}

/** Decodes an image once and returns a marker-sized thumbnail and a lightbox-sized preview. */
export async function makeImages(blob: Blob): Promise<{ thumbBlob?: Blob; previewBlob?: Blob }> {
  try {
    const bmp = await createImageBitmap(blob);
    const [thumbBlob, previewBlob] = await Promise.all([scaled(bmp, THUMB_PX), scaled(bmp, PREVIEW_PX)]);
    bmp.close();
    return { thumbBlob, previewBlob };
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
