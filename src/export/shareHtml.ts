import { getPhoto } from '../model/photos';
import type { Journey } from '../model/types';

/** MapLibre 5 ships a UMD build with an inlined worker, so it works from file:// too. */
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.6.0/dist';

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Builds one self-contained HTML file that replays the journey in any browser. */
export async function buildShareHtml(j: Journey): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}share-viewer.js`);
  if (!res.ok) throw new Error('The share viewer is missing. Run `npm run build:share`.');
  const viewer = await res.text();
  const images: Record<string, string> = {};
  for (const id of j.stops.flatMap((s) => s.photoIds)) {
    const p = getPhoto(id);
    const blob = p?.previewBlob ?? p?.thumbBlob;
    if (blob) images[id] = await blobToDataUrl(blob);
  }
  // Loose photos aren't placed on the trail, so they're left out of the share.
  const journey: Journey = { ...j, loosePhotoIds: [] };
  const data = JSON.stringify({ journey, images }).replace(/</g, '\\u003c');
  const script = viewer.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(j.title)} · Trail Track</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
</head>
<body>
<script>window.TT_DATA=${data};</script>
<script>${script}</script>
</body>
</html>
`;
}
