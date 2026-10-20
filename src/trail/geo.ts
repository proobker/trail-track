import type { LineString } from 'geojson';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in metres between [lng, lat] points. */
export function metres(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function lineMetres(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += metres(coords[i - 1], coords[i]);
  return total;
}

export const straightLine = (a: [number, number], b: [number, number]): LineString => ({ type: 'LineString', coordinates: [a, b] });
