import type { LineString } from 'geojson';

export type PhotoSource = 'takeout' | 'upload' | 'picker';
export type LocationSource = 'exif' | 'takeout-exif' | 'takeout-edited' | 'timeline-path' | 'timeline-visit' | 'manual'
  | 'inferred-visual' | 'inferred-ai' | 'inferred-time' | 'inferred-guess';
/**
 * Where `takenAt` came from. Shared or downloaded copies often lose EXIF, so a file time or a
 * date-only file name says little about when the photo was really taken.
 */
export type TimeSource = 'exif-offset' | 'exif' | 'sidecar' | 'filename' | 'filename-date' | 'file';

export interface Photo {
  id: string;
  source: PhotoSource;
  /** Epoch milliseconds. */
  takenAt: number;
  lat?: number;
  lng?: number;
  /** Provenance and reported quality of the mapped coordinate. Older saved photos may omit these. */
  locationSource?: LocationSource;
  locationAccuracyM?: number;
  locationAccuracyLevel?: '68' | '95' | 'unspecified';
  /** Gap to the nearest Timeline observation for an inferred location. */
  locationTimeGapMs?: number;
  /** Original embedded/sidecar coordinate, kept apart from later inferred placement. */
  originalLocation?: { lat: number; lng: number };
  people: string[];
  fileName: string;
  /**
   * True when `takenAt` is a camera clock time with no known time zone (EXIF without an offset, or a
   * file-name date). It was read as if taken in this browser's zone.
   */
  wallClock?: boolean;
  /** Older saved photos omit this and are treated as untrusted. */
  timeSource?: TimeSource;
  /** `takenAt` was copied from the stop the photo was placed at, not read from the photo. */
  timeEstimated?: boolean;
  /** Confidence (0–1) of an inferred location. */
  placementScore?: number;
  /** Set when the location was filled in from Google Timeline rather than the photo itself. */
  locatedBy?: 'timeline';
  /** Phone folder the photo was uploaded from (Takeout only), e.g. "Screenshots" or "WhatsApp Images". */
  folder?: string;
  /** ~256px, for map markers and lists. */
  thumbBlob?: Blob;
  /** ~1280px, for the lightbox and playback cards. */
  previewBlob?: Blob;
  /** Local difference hash of the image; only near-duplicate scenes are comparable. */
  visualHash?: string;
}

const TRUSTED_TIME: ReadonlySet<TimeSource> = new Set(['exif-offset', 'exif', 'sidecar', 'filename']);
export const trustedTime = (p: Photo) => p.timeSource != null && TRUSTED_TIME.has(p.timeSource) && !p.timeEstimated;

export const MODES = ['walk', 'bike', 'car', 'bus', 'train', 'boat', 'flight'] as const;
export type Mode = (typeof MODES)[number];

export type Routing = 'routed' | 'straight' | 'arc' | 'imported' | 'manual';

export interface Stop {
  id: string;
  lat: number;
  lng: number;
  arrivedAt?: number;
  label?: string;
  /** Filled in by reverse geocoding. */
  place?: Place;
  note?: string;
  photoIds: string[];
  origin: 'photo' | 'manual' | 'import';
}

export interface Place {
  name?: string;
  city?: string;
  country?: string;
  countryCode?: string;
}

export const stopName = (s: Stop, index: number) => s.label ?? s.place?.name ?? s.place?.city ?? `Stop ${index + 1}`;

export interface Segment {
  id: string;
  fromStopId: string;
  toStopId: string;
  mode: Mode;
  geometry: LineString;
  routing: Routing;
}

export type PersonFilter = { mode: 'any' } | { mode: 'none' } | { mode: 'person'; name: string };

export interface Journey {
  id: string;
  title: string;
  /** A named trail confirmed by the user; the journey geometry remains independent. */
  namedTrail?: { source: 'osm' | 'usgs'; type: 'relation' | 'way' | 'feature'; id: number; name: string; ref?: string };
  /** Keep the title in sync with visited locations; false preserves an explicit name. */
  autoTitle?: boolean;
  dateFrom?: string;
  dateTo?: string;
  personFilter: PersonFilter;
  stops: Stop[];
  segments: Segment[];
  /** Photos without GPS, shown at a position interpolated from their timestamp until pinned. */
  loosePhotoIds?: string[];
  updatedAt: number;
}

/**
 * Mode colours come from a validated categorical palette (dark steps). Any chart that puts
 * modes side by side must use STACK_ORDER, the order the palette was validated in.
 */
export const MODE_META: Record<Mode, { label: string; icon: string; color: string; dash?: number[] }> = {
  walk: { label: 'Walk', icon: '🚶', color: '#199e70' },
  bike: { label: 'Bike', icon: '🚲', color: '#c98500' },
  car: { label: 'Car', icon: '🚗', color: '#d95926' },
  bus: { label: 'Bus', icon: '🚌', color: '#e66767' },
  train: { label: 'Train', icon: '🚆', color: '#9085e9', dash: [2, 1] },
  boat: { label: 'Boat', icon: '⛴️', color: '#3987e5', dash: [1, 1] },
  flight: { label: 'Flight', icon: '✈️', color: '#d55181', dash: [0.5, 2] },
};

export const STACK_ORDER: Mode[] = ['boat', 'car', 'walk', 'bike', 'flight', 'train', 'bus'];

export const uid = () => crypto.randomUUID();
