import { useEffect } from 'react';
import { create } from 'zustand';
import { db } from './db';
import type { Journey, Photo } from './types';

/** In-memory cache of photo records and their thumbnail object URLs. */
const usePhotoCache = create<{ photos: Map<string, Photo> }>(() => ({ photos: new Map() }));
const urls = new Map<string, string>();

export function thumbUrl(p: Photo | undefined): string | undefined {
  if (!p?.thumbBlob) return undefined;
  let url = urls.get(p.id);
  if (!url) {
    url = URL.createObjectURL(p.thumbBlob);
    urls.set(p.id, url);
  }
  return url;
}

export async function savePhotos(photos: Photo[]) {
  await db.photos.bulkPut(photos);
  usePhotoCache.setState((s) => {
    const next = new Map(s.photos);
    for (const p of photos) next.set(p.id, p);
    return { photos: next };
  });
}

async function ensureLoaded(ids: string[]) {
  const have = usePhotoCache.getState().photos;
  const missing = ids.filter((id) => !have.has(id));
  if (!missing.length) return;
  const found = (await db.photos.bulkGet(missing)).filter((p): p is Photo => !!p);
  usePhotoCache.setState((s) => {
    const next = new Map(s.photos);
    for (const p of found) next.set(p.id, p);
    return { photos: next };
  });
}

export const journeyPhotoIds = (j?: Journey) => (j ? [...j.stops.flatMap((s) => s.photoIds), ...(j.loosePhotoIds ?? [])] : []);

/** All photo records referenced by a journey (stops and loose photos). */
export function useJourneyPhotos(j?: Journey): Map<string, Photo> {
  const ids = journeyPhotoIds(j);
  const key = ids.join(',');
  useEffect(() => {
    void ensureLoaded(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return usePhotoCache((s) => s.photos);
}

export function getPhoto(id: string) {
  return usePhotoCache.getState().photos.get(id);
}

export function usePhoto(id?: string): Photo | undefined {
  useEffect(() => {
    if (id) void ensureLoaded([id]);
  }, [id]);
  return usePhotoCache((s) => (id ? s.photos.get(id) : undefined));
}
