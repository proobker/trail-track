import type { Photo } from '../model/types';

/** A photo found during an import scan; the image bytes are only read if it is kept. */
export interface PhotoCandidate {
  photo: Photo;
  getBlob?: () => Promise<Blob>;
}

const THUMB_PX = 512;

export async function makeThumb(blob: Blob, px = THUMB_PX): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, px / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise<Blob | undefined>((r) => canvas.toBlob((b) => r(b ?? undefined), 'image/jpeg', 0.82));
  } catch {
    // Videos, HEIC and other formats the browser can't decode simply get no thumbnail.
    return undefined;
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
      let thumbBlob: Blob | undefined;
      if (c.getBlob) {
        try {
          thumbBlob = await makeThumb(await c.getBlob());
        } catch {
          thumbBlob = undefined;
        }
      }
      out[i] = { ...c.photo, thumbBlob };
      onProgress?.(++done, cands.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}
