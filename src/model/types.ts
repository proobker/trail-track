import type { LineString } from 'geojson';

export type PhotoSource = 'takeout' | 'upload' | 'picker';

export interface Photo {
  id: string;
  source: PhotoSource;
  /** Epoch milliseconds. */
  takenAt: number;
  lat?: number;
  lng?: number;
  people: string[];
  fileName: string;
  /** ~256px, for map markers and lists. */
  thumbBlob?: Blob;
  /** ~1280px, for the lightbox and playback cards. */
  previewBlob?: Blob;
}

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
