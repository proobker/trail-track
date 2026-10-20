import Dexie, { type EntityTable } from 'dexie';
import type { Journey, Photo } from './types';

export interface RouteCacheRow {
  key: string;
  coordinates: [number, number][];
}

export const db = new Dexie('trail-track') as Dexie & {
  photos: EntityTable<Photo, 'id'>;
  journeys: EntityTable<Journey, 'id'>;
  routeCache: EntityTable<RouteCacheRow, 'key'>;
};

db.version(1).stores({
  photos: 'id, takenAt, source',
  journeys: 'id, updatedAt',
  routeCache: 'key',
});
