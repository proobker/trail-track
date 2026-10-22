import type { Photo } from '../model/types';
import { loadOnDevice } from './device';

/** The model is downloaded once into the browser cache; all photo inference runs on this device. */
const MODEL = 'Xenova/clip-vit-base-patch32';

export type SceneEmbeddings = Map<string, Float32Array>;

function unitVector(values: ArrayLike<number | bigint>): Float32Array | undefined {
  const out = Float32Array.from(Array.from(values, Number));
  let length = 0;
  for (const value of out) length += value * value;
  if (!Number.isFinite(length) || length === 0) return undefined;
  length = Math.sqrt(length);
  for (let i = 0; i < out.length; i++) out[i] /= length;
  return out;
}

const BATCH = 8;

/**
 * Extracts CLIP image embeddings from the already stored images. No picture is sent to the model host.
 * The 256 px thumbnail is enough for CLIP's 224 px input and much cheaper to decode than the preview.
 */
export async function analyzePhotoScenes(photos: Photo[], onProgress?: (done: number, total: number) => void): Promise<SceneEmbeddings> {
  const usable = photos.flatMap((p) => {
    const blob = p.thumbBlob ?? p.previewBlob;
    return blob ? [{ id: p.id, blob }] : [];
  });
  const embeddings: SceneEmbeddings = new Map();
  if (!usable.length) return embeddings;

  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await loadOnDevice((device) => pipeline('image-feature-extraction', MODEL, { dtype: 'q8', device }));
  const embed = async (batch: typeof usable) => {
    const result = await extractor(batch.map((b) => b.blob));
    const width = result.data.length / batch.length;
    batch.forEach((b, row) => {
      const vector = unitVector(result.data.slice(row * width, (row + 1) * width));
      if (vector) embeddings.set(b.id, vector);
    });
  };
  try {
    for (let at = 0; at < usable.length; at += BATCH) {
      const batch = usable.slice(at, at + BATCH);
      try {
        await embed(batch);
      } catch {
        // One unsupported image fails the whole batch; retry its photos one at a time.
        for (const one of batch) await embed([one]).catch(() => undefined);
      }
      onProgress?.(Math.min(at + BATCH, usable.length), usable.length);
    }
  } finally {
    await extractor.dispose();
  }
  return embeddings;
}
