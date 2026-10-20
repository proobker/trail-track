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
  thumbBlob?: Blob;
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
  photoIds: string[];
  origin: 'photo' | 'manual' | 'import';
}

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

export const MODE_META: Record<Mode, { label: string; icon: string; color: string; dash?: number[] }> = {
  walk: { label: 'Walk', icon: '🚶', color: '#22c55e' },
  bike: { label: 'Bike', icon: '🚲', color: '#eab308' },
  car: { label: 'Car', icon: '🚗', color: '#f97316' },
  bus: { label: 'Bus', icon: '🚌', color: '#ef4444' },
  train: { label: 'Train', icon: '🚆', color: '#a855f7', dash: [2, 1] },
  boat: { label: 'Boat', icon: '⛴️', color: '#06b6d4', dash: [1, 1] },
  flight: { label: 'Flight', icon: '✈️', color: '#38bdf8', dash: [0.5, 2] },
};

export const uid = () => crypto.randomUUID();
