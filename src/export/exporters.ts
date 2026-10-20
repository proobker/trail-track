import type { FeatureCollection } from 'geojson';
import { db } from '../model/db';
import type { Journey, Photo } from '../model/types';

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
const iso = (t?: number) => (t != null ? new Date(t).toISOString() : undefined);
const stopName = (j: Journey, id: string) => {
  const i = j.stops.findIndex((s) => s.id === id);
  return j.stops[i]?.label ?? `Stop ${i + 1}`;
};

export function toGeoJSON(j: Journey): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...j.stops.map((s, i) => ({
        type: 'Feature' as const,
        properties: { kind: 'stop', name: s.label ?? `Stop ${i + 1}`, time: iso(s.arrivedAt), photos: s.photoIds.length },
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      })),
      ...j.segments.map((s) => ({
        type: 'Feature' as const,
        properties: { kind: 'segment', type: s.mode, name: `${stopName(j, s.fromStopId)} → ${stopName(j, s.toStopId)}` },
        geometry: s.geometry,
      })),
    ],
  };
}

export function toGPX(j: Journey): string {
  const wpts = j.stops
    .map((s, i) => `  <wpt lat="${s.lat}" lon="${s.lng}"><name>${esc(s.label ?? `Stop ${i + 1}`)}</name>${s.arrivedAt != null ? `<time>${iso(s.arrivedAt)}</time>` : ''}</wpt>`)
    .join('\n');
  const trks = j.segments
    .map(
      (s) =>
        `  <trk><name>${esc(`${stopName(j, s.fromStopId)} → ${stopName(j, s.toStopId)}`)}</name><type>${s.mode}</type><trkseg>\n${s.geometry.coordinates
          .map(([lng, lat]) => `    <trkpt lat="${lat}" lon="${lng}"/>`)
          .join('\n')}\n  </trkseg></trk>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trail Track" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${esc(j.title)}</name></metadata>\n${wpts}\n${trks}\n</gpx>\n`;
}

export function toKML(j: Journey): string {
  const pts = j.stops
    .map((s, i) => `    <Placemark><name>${esc(s.label ?? `Stop ${i + 1}`)}</name>${s.arrivedAt != null ? `<TimeStamp><when>${iso(s.arrivedAt)}</when></TimeStamp>` : ''}<Point><coordinates>${s.lng},${s.lat}</coordinates></Point></Placemark>`)
    .join('\n');
  const lines = j.segments
    .map(
      (s) =>
        `    <Placemark><name>${esc(`${stopName(j, s.fromStopId)} → ${stopName(j, s.toStopId)}`)}</name><ExtendedData><Data name="type"><value>${s.mode}</value></Data></ExtendedData><LineString><tessellate>1</tessellate><coordinates>${s.geometry.coordinates
          .map(([lng, lat]) => `${lng},${lat}`)
          .join(' ')}</coordinates></LineString></Placemark>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document><name>${esc(j.title)}</name>\n${pts}\n${lines}\n  </Document>\n</kml>\n`;
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

export async function backupJSON(journeys: Journey[]): Promise<string> {
  const ids = new Set(journeys.flatMap((j) => j.stops.flatMap((s) => s.photoIds)));
  const photos = (await db.photos.bulkGet([...ids])).filter((p): p is Photo => !!p);
  const serialised = await Promise.all(
    photos.map(async ({ thumbBlob, previewBlob, ...p }) => ({
      ...p,
      thumb: thumbBlob ? await blobToDataUrl(thumbBlob) : undefined,
      preview: previewBlob ? await blobToDataUrl(previewBlob) : undefined,
    })),
  );
  return JSON.stringify({ app: 'trail-track', version: 1, exportedAt: new Date().toISOString(), journeys, photos: serialised });
}

export async function restoreBackup(text: string): Promise<number> {
  const data = JSON.parse(text);
  if (data.app !== 'trail-track' || !Array.isArray(data.journeys)) throw new Error('This is not a Trail Track backup');
  const toBlob = async (u?: string) => (typeof u === 'string' && u.startsWith('data:image/') ? (await fetch(u)).blob() : undefined);
  const photos: Photo[] = await Promise.all(
    (data.photos ?? []).map(async ({ thumb, preview, ...p }: Photo & { thumb?: string; preview?: string }) => ({
      ...p,
      thumbBlob: await toBlob(thumb),
      previewBlob: await toBlob(preview),
    })),
  );
  await db.transaction('rw', db.photos, db.journeys, async () => {
    await db.photos.bulkPut(photos);
    await db.journeys.bulkPut(data.journeys);
  });
  return data.journeys.length;
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileSafe = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'journey';
