import { db } from '../model/db';
import type { Place } from '../model/types';
import { makeThrottle } from '../util/throttle';

const throttled = makeThrottle(1000);

interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  osm_key?: string;
}

export function placeFromPhoton(p: PhotonProps): Place {
  const city = p.city ?? p.county ?? p.state;
  // Prefer a named feature (landmark, park, venue); fall back to the street or district.
  const name = p.name && p.name !== city ? p.name : (p.street ?? p.district ?? undefined);
  return { name, city, country: p.country, countryCode: p.countrycode?.toUpperCase() };
}

/** Reverse geocodes a point through Photon, cached by ~100 m grid cell. */
export async function reverseGeocode(lng: number, lat: number): Promise<Place | undefined> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = await db.geocache.get(key);
  if (hit) return hit.place;
  try {
    const res = await throttled(() => fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}&limit=1`));
    if (!res.ok) return undefined;
    const props: PhotonProps | undefined = (await res.json()).features?.[0]?.properties;
    if (!props) return undefined;
    const place = placeFromPhoton(props);
    await db.geocache.put({ key, place });
    return place;
  } catch {
    return undefined;
  }
}

export const flag = (countryCode?: string) =>
  countryCode && /^[A-Z]{2}$/.test(countryCode) ? String.fromCodePoint(...[...countryCode].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '';
