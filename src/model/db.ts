import Dexie, { type EntityTable } from 'dexie';
import type { Journey, Photo, Place } from './types';

export interface RouteCacheRow {
  key: string;
  coordinates: [number, number][];
}

export interface GeocacheRow {
  key: string;
  place: Place;
}

export interface TrailCacheRow {
  key: string;
  fetchedAt: number;
  elements: unknown[];
  usgsFeatures?: unknown[];
}

export const db = new Dexie('trail-track') as Dexie & {
  photos: EntityTable<Photo, 'id'>;
  journeys: EntityTable<Journey, 'id'>;
  routeCache: EntityTable<RouteCacheRow, 'key'>;
  geocache: EntityTable<GeocacheRow, 'key'>;
  trailCache: EntityTable<TrailCacheRow, 'key'>;
};

db.version(1).stores({
  photos: 'id, takenAt, source',
  journeys: 'id, updatedAt',
  routeCache: 'key',
});

db.version(2).stores({ geocache: 'key' });
db.version(3).stores({ trailCache: 'key' });
