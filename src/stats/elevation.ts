import type { Segment } from '../model/types';
import { lineMetres, metres } from '../trail/geo';

type LngLat = [number, number];

const ZOOM = 12;
const TILE = 256;
const TILE_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Terrarium encodes metres as R*256 + G + B/256 − 32768. */
export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Fractional Web-Mercator tile coordinates at zoom z. */
export function tileXY(lng: number, lat: number, z = ZOOM): [number, number] {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

const tiles = new Map<string, Promise<ImageData | undefined>>();

function loadTile(x: number, y: number): Promise<ImageData | undefined> {
  const key = `${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(TILE_URL(ZOOM, x, y));
        if (!res.ok) return undefined;
        const bmp = await createImageBitmap(await res.blob());
        const c = new OffscreenCanvas(TILE, TILE);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, TILE, TILE);
      } catch {
        return undefined;
      }
    })();
    tiles.set(key, p);
  }
  return p;
}

async function elevationAt([lng, lat]: LngLat): Promise<number | undefined> {
  const [fx, fy] = tileXY(lng, lat);
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const img = await loadTile(tx, ty);
  if (!img) return undefined;
  const px = Math.min(TILE - 1, Math.floor((fx - tx) * TILE));
  const py = Math.min(TILE - 1, Math.floor((fy - ty) * TILE));
  const i = (py * TILE + px) * 4;
  return decodeTerrarium(img.data[i], img.data[i + 1], img.data[i + 2]);
}

/** Points spaced evenly along a polyline. */
export function samplesAlong(coords: LngLat[], count: number): { at: number; coord: LngLat }[] {
  const total = lineMetres(coords);
  if (coords.length < 2 || total === 0) return coords.slice(0, 1).map((c) => ({ at: 0, coord: c }));
  const out: { at: number; coord: LngLat }[] = [];
  let seg = 1;
  let segStart = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    while (seg < coords.length - 1 && segStart + metres(coords[seg - 1], coords[seg]) < target) {
      segStart += metres(coords[seg - 1], coords[seg]);
      seg++;
    }
    const len = metres(coords[seg - 1], coords[seg]) || 1;
    const f = Math.min(1, Math.max(0, (target - segStart) / len));
    const [a, b] = [coords[seg - 1], coords[seg]];
    out.push({ at: target, coord: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] });
  }
  return out;
}

export interface ProfilePoint {
  at: number;
  ele: number;
  coord?: LngLat;
}

export interface Profile {
  points: ProfilePoint[];
  ascent: number;
  descent: number;
  min: number;
  max: number;
}

export function summarise(points: ProfilePoint[]): Profile {
  let ascent = 0;
  let descent = 0;
  // Ignore sub-3m wiggles, which are mostly DEM noise.
  let ref = points[0]?.ele ?? 0;
  for (const p of points) {
    const d = p.ele - ref;
    if (d > 3) {
      ascent += d;
      ref = p.ele;
    } else if (d < -3) {
      descent -= d;
      ref = p.ele;
    }
  }
  const eles = points.map((p) => p.ele);
  return { points, ascent, descent, min: Math.min(...eles), max: Math.max(...eles) };
}

/** Elevation profile along consecutive segments (treated as one continuous line). */
export async function profileFor(segments: Segment[], count = 200): Promise<Profile | undefined> {
  const coords = segments.flatMap((s) => s.geometry.coordinates as LngLat[]);
  if (coords.length < 2) return undefined;
  const samples = samplesAlong(coords, count);
  const eles = await Promise.all(samples.map((s) => elevationAt(s.coord)));
  const points = samples.flatMap((s, i) => (eles[i] == null ? [] : [{ at: s.at, ele: eles[i]!, coord: s.coord }]));
  return points.length > 1 ? summarise(points) : undefined;
}
