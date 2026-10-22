import { reverseGeocode } from '../geo/reverse';
import type { Photo, Stop } from '../model/types';
import { loadOnDevice } from './device';

/**
 * StreetCLIP is a CLIP model trained for geolocation. It ranks a short list of place names for a
 * photo; it runs on this device and is downloaded once (~430 MB) into the browser cache.
 * Licence: CC BY-NC 4.0.
 */
const MODEL = 'onnx-community/StreetCLIP-ONNX';

export interface PlaceGuess {
  photoId: string;
  /** Index into the labels the photo was ranked against. */
  candidateIndex: number;
  /** Softmax probability over those labels. */
  score: number;
  /** Lead over the second-best label. */
  margin: number;
}

export interface GeoQuery {
  photo: Photo;
  labels: string[];
}

/** Ranks candidate place labels for each photo. StreetCLIP today; a local Ollama model can implement it later. */
export interface GeoEngine {
  rank(queries: GeoQuery[], onProgress?: (done: number, total: number) => void): Promise<PlaceGuess[]>;
  /** Starts loading the model early, e.g. while place names are looked up. */
  preload?(): void;
  /** Frees the model once an import is done with it. */
  release?(): Promise<void>;
}

const BATCH = 8;
const template = (label: string) => `A photo taken in ${label}.`;

/** Softmax over one photo's own labels, picked out of a row of logits for every label in the batch. */
export function rankLabels(logits: ArrayLike<number>, indexes: number[]): { candidateIndex: number; score: number; margin: number } {
  const own = indexes.map((i) => logits[i]);
  const max = Math.max(...own);
  const exp = own.map((x) => Math.exp(x - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  const probs = exp.map((x) => x / sum);
  const order = probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
  return { candidateIndex: order[0].i, score: order[0].p, margin: order[0].p - (order[1]?.p ?? 0) };
}

type StreetClip = Awaited<ReturnType<typeof loadStreetClip>>;
let loaded: Promise<StreetClip> | undefined;

async function loadStreetClip() {
  const t = await import('@huggingface/transformers');
  const [processor, tokenizer, model] = await Promise.all([
    t.AutoProcessor.from_pretrained(MODEL),
    t.AutoTokenizer.from_pretrained(MODEL),
    loadOnDevice((device) => t.CLIPModel.from_pretrained(MODEL, { dtype: 'q8', device })),
  ]);
  return { RawImage: t.RawImage, processor, tokenizer, model };
}

function streetClip() {
  if (!loaded) {
    loaded = loadStreetClip();
    loaded.catch(() => (loaded = undefined));
  }
  return loaded;
}

export const streetClipEngine: GeoEngine = {
  preload() {
    streetClip().catch(() => undefined);
  },
  async release() {
    const model = loaded;
    loaded = undefined;
    await (await model?.catch(() => undefined))?.model.dispose();
  },
  async rank(queries, onProgress) {
    const usable = queries.filter((q) => q.photo.previewBlob && q.labels.length >= 2);
    const guesses: PlaceGuess[] = [];
    if (!usable.length) return guesses;
    const { RawImage, processor, tokenizer, model } = await streetClip();

    for (let at = 0; at < usable.length; at += BATCH) {
      const decoded = await Promise.all(usable.slice(at, at + BATCH).map(async (q) => {
        try {
          return { q, image: await RawImage.fromBlob(q.photo.previewBlob!) };
        } catch {
          // A single unsupported image should not stop the rest.
          return undefined;
        }
      }));
      const batch = decoded.filter((d) => !!d);
      if (batch.length) {
        try {
          // Each label in the batch is encoded once, not once per photo.
          const labelIndex = new Map<string, number>();
          for (const { q } of batch) for (const label of q.labels) if (!labelIndex.has(label)) labelIndex.set(label, labelIndex.size);
          const text = tokenizer([...labelIndex.keys()].map(template), { padding: true, truncation: true });
          const { pixel_values } = await processor(batch.map((d) => d.image));
          const { logits_per_image } = await model({ ...text, pixel_values });
          const width = labelIndex.size;
          const data = logits_per_image.data as Float32Array;
          batch.forEach(({ q }, row) => {
            const ranked = rankLabels(data.subarray(row * width, (row + 1) * width), q.labels.map((l) => labelIndex.get(l)!));
            guesses.push({ photoId: q.photo.id, ...ranked });
          });
        } catch {
          // Leave this batch unranked; its photos stay under "Needs a place".
        }
      }
      onProgress?.(Math.min(at + BATCH, usable.length), usable.length);
    }
    return guesses;
  },
};

/** Fills in missing place names, which become the labels the model chooses from. */
export async function nameStops(stops: Stop[], onProgress?: (done: number, total: number) => void, only?: Set<string>): Promise<Stop[]> {
  const wanted = (s: Stop) => !s.place && (!only || only.has(s.id));
  const missing = stops.filter(wanted).length;
  let done = 0;
  const out: Stop[] = [];
  for (const s of stops) {
    if (!wanted(s)) {
      out.push(s);
      continue;
    }
    const place = await reverseGeocode(s.lng, s.lat);
    out.push(place ? { ...s, place } : s);
    onProgress?.(++done, missing);
  }
  return out;
}
