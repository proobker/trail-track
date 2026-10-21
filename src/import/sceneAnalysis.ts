import type { Photo } from '../model/types';

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

/** Extracts CLIP image embeddings from the already stored previews. No picture is sent to the model host. */
export async function analyzePhotoScenes(photos: Photo[], onProgress?: (done: number, total: number) => void): Promise<SceneEmbeddings> {
  const usable = photos.filter((p) => p.previewBlob);
  const embeddings: SceneEmbeddings = new Map();
  if (!usable.length) return embeddings;

  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await pipeline('image-feature-extraction', MODEL, { dtype: 'q8' });
  try {
    for (let i = 0; i < usable.length; i++) {
      const p = usable[i];
      try {
        const result = await extractor(p.previewBlob!);
        const vector = unitVector(result.data);
        if (vector) embeddings.set(p.id, vector);
      } catch {
        // A single unsupported image should not stop the rest of the import.
      }
      onProgress?.(i + 1, usable.length);
    }
  } finally {
    await extractor.dispose();
  }
  return embeddings;
}
