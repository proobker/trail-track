/** Fields of a Google Takeout photo sidecar JSON that we use. */
export interface TakeoutSidecar {
  title?: string;
  photoTakenTime?: { timestamp?: string };
  creationTime?: { timestamp?: string };
  geoData?: { latitude?: number; longitude?: number };
  geoDataExif?: { latitude?: number; longitude?: number };
  people?: { name?: string }[];
}

export interface SidecarInfo {
  title?: string;
  takenAt: number;
  lat?: number;
  lng?: number;
  people: string[];
}

const validGeo = (g?: { latitude?: number; longitude?: number }) =>
  g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude) && !(g.latitude === 0 && g.longitude === 0) ? g : undefined;

/** Returns undefined when the JSON is not a photo sidecar (e.g. album metadata.json). */
export function parseSidecar(json: unknown): SidecarInfo | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const s = json as TakeoutSidecar;
  const ts = s.photoTakenTime?.timestamp ?? s.creationTime?.timestamp;
  if (!ts || !Number.isFinite(Number(ts))) return undefined;
  const geo = validGeo(s.geoDataExif) ?? validGeo(s.geoData);
  return {
    title: s.title,
    takenAt: Number(ts) * 1000,
    lat: geo?.latitude,
    lng: geo?.longitude,
    people: (s.people ?? []).map((p) => p.name?.trim()).filter((n): n is string => !!n),
  };
}

/**
 * Finds the image a sidecar describes among files in the same folder. Handles
 * `a.jpg.json`, `a.jpg.supplemental-metadata.json` (and its truncations), `a.jpg(1).json`
 * for `a(1).jpg`, and titles that Takeout truncated in the image filename.
 */
export function matchImageName(jsonName: string, title: string | undefined, siblings: Set<string>): string | undefined {
  let base = jsonName.replace(/\.json$/i, '');
  const dup = base.match(/\((\d+)\)$/);
  if (dup) base = base.slice(0, -dup[0].length);
  base = base.replace(/\.s(u(p(p(l(e(m(e(n(t(a(l)?)?)?)?)?)?)?)?)?)?)?(-[a-z-]*)?$/i, '');
  const withDup = (name: string) => {
    if (!dup) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}${dup[0]}${name.slice(dot)}` : `${name}${dup[0]}`;
  };
  for (const c of [title, base]) {
    if (c && siblings.has(withDup(c))) return withDup(c);
  }
  // Takeout truncates long image names (about 47 characters before the extension).
  const stem = (title ?? base).replace(/\.[^.]+$/, '');
  if (stem.length >= 40) {
    const prefix = stem.slice(0, 40);
    for (const s of siblings) if (s.startsWith(prefix) && !s.toLowerCase().endsWith('.json')) return s;
  }
  return undefined;
}
