/** A high-confidence OCR line. Bounding boxes are in the resized image's pixels. */
export interface TextLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Avoid excluding travel photos for a sign or a few labels; require substantial, spread-out text. */
export function isTextHeavy(lines: TextLine[], width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  const reliable = lines.filter((line) => line.confidence >= 55 && (line.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 3);
  if (reliable.length < 2) return false;
  const chars = reliable.reduce((n, line) => n + (line.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0), 0);
  const area = reliable.reduce((n, line) => n + Math.max(0, line.bbox.x1 - line.bbox.x0) * Math.max(0, line.bbox.y1 - line.bbox.y0), 0) / (width * height);
  const top = Math.min(...reliable.map((line) => line.bbox.y0));
  const bottom = Math.max(...reliable.map((line) => line.bbox.y1));
  const verticalSpan = (bottom - top) / height;
  return (chars >= 24 && area >= 0.18)
    || (chars >= 60 && reliable.length >= 4 && (area >= 0.07 || verticalSpan >= 0.4))
    || (chars >= 100 && reliable.length >= 6);
}

async function ocrImage(blob: Blob): Promise<{ image: Blob; width: number; height: number } | undefined> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return image ? { image, width: canvas.width, height: canvas.height } : undefined;
  } finally {
    bitmap.close();
  }
}

/** OCR workers run in parallel; each holds its own copy of the language data, so keep the pool small. */
const workerCount = () => Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)));

/** OCR runs in browser workers. Only OCR code and language data are downloaded; images stay local. */
export async function findTextHeavy(
  items: { id: string; getBlob: () => Promise<Blob | undefined> }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (!items.length) return flagged;
  const { createWorker } = await import('tesseract.js');
  const workers = await Promise.all(Array.from({ length: Math.min(workerCount(), items.length) }, () => createWorker('eng')));
  let next = 0;
  let scanned = 0;
  let done = 0;
  // One loop per worker, so only a few images are decoded at any time.
  const run = async (worker: (typeof workers)[number]) => {
    while (next < items.length) {
      const item = items[next++];
      try {
        const blob = await item.getBlob();
        const input = blob && await ocrImage(blob);
        if (input) {
          const { data } = await worker.recognize(input.image, {}, { text: true, blocks: true });
          scanned++;
          const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
          if (isTextHeavy(lines, input.width, input.height)) flagged.add(item.id);
        }
      } catch {
        // Unreadable formats stay in the import for manual review.
      }
      onProgress?.(++done, items.length);
    }
  };
  try {
    await Promise.all(workers.map(run));
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  if (!scanned) throw new Error('None of these photos could be scanned for text');
  return flagged;
}
