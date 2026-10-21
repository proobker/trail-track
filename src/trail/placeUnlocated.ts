import type { Journey, Photo, Stop } from '../model/types';

export interface Placement {
  photoId: string;
  lat: number;
  lng: number;
  /** Stop the photo was snapped to, if it fell outside any travel window. */
  stopId?: string;
  method: 'route' | 'straight' | 'stop';
}

/**
 * Places photos without GPS on the trail by their timestamp: between two timed stops the
 * position is linearly interpolated; before the first / after the last it snaps to that stop.
 */
export function placeUnlocated(photos: Photo[], journeyOrStops: Journey | Stop[]): Placement[] {
  const stops = Array.isArray(journeyOrStops) ? journeyOrStops : journeyOrStops.stops;
  const segments = Array.isArray(journeyOrStops) ? [] : journeyOrStops.segments;
  const timed = stops.filter((s) => s.arrivedAt != null).sort((a, b) => a.arrivedAt! - b.arrivedAt!);
  if (timed.length === 0) return [];
  return photos.map((p) => {
    const t = p.takenAt;
    if (t <= timed[0].arrivedAt!) return snap(p, timed[0]);
    const last = timed[timed.length - 1];
    if (t >= last.arrivedAt!) return snap(p, last);
    let i = 1;
    while (timed[i].arrivedAt! < t) i++;
    const a = timed[i - 1];
    const b = timed[i];
    const f = (t - a.arrivedAt!) / (b.arrivedAt! - a.arrivedAt!);
    const segment = segments.find((s) => s.fromStopId === a.id && s.toStopId === b.id);
    const point = segment && segment.routing !== 'straight' && segment.routing !== 'arc'
      ? pointAlong(segment.geometry.coordinates, f) : undefined;
    return point
      ? { photoId: p.id, lat: point[1], lng: point[0], method: 'route' as const }
      : { photoId: p.id, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, method: 'straight' as const };
  });
}

function pointAlong(coords: number[][], fraction: number): [number, number] | undefined {
  if (coords.length < 2) return undefined;
  const lengths = coords.slice(1).map((p, i) => {
    const a = coords[i];
    const scale = Math.cos(((a[1] + p[1]) / 2) * Math.PI / 180);
    return Math.hypot((p[0] - a[0]) * scale, p[1] - a[1]);
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!total) return undefined;
  let distance = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? distance / lengths[i] : 0;
      return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
    }
    distance -= lengths[i];
  }
}

const snap = (p: Photo, s: Stop): Placement => ({ photoId: p.id, lat: s.lat, lng: s.lng, stopId: s.id, method: 'stop' });
