import { useEffect } from 'react';
import { create } from 'zustand';
import { db } from './db';
import type { Journey, Photo } from './types';

/** In-memory cache of photo records and their thumbnail object URLs. */
const usePhotoCache = create<{ photos: Map<string, Photo> }>(() => ({ photos: new Map() }));
const urls = new Map<string, string>();

function blobUrl(key: string, blob?: Blob): string | undefined {
  if (!blob) return undefined;
  let url = urls.get(key);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(key, url);
  }
  return url;
}

/** Small image for markers and lists. */
export const thumbUrl = (p?: Photo) => (p ? blobUrl(`t:${p.id}`, p.thumbBlob ?? p.previewBlob) : undefined);

/** Large image for the lightbox and playback; falls back to the thumbnail for older imports. */
export const previewUrl = (p?: Photo) => (p ? (blobUrl(`p:${p.id}`, p.previewBlob) ?? thumbUrl(p)) : undefined);

/** Everything currently cached, keyed by photo id. */
export const journeyPhotos = () => usePhotoCache.getState().photos;

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
