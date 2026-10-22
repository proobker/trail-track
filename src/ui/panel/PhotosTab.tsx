import { Check, ImagePlus, Link2, MapPin, MapPinned, ScanSearch, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { JUNK_KINDS, KIND_LABEL, photoKind } from '../../import/photoKind';
import { makeLocator, readTimelineFiles } from '../../import/timeline';
import { findTextHeavy } from '../../import/textHeavy';
import { scanUploads } from '../../import/exifUpload';
import { materialize } from '../../import/candidate';
import { matchOriginals } from '../../trail/repair';
import { nameStops, streetClipEngine } from '../../import/geolocate';
import { candidateStopIds, inferPlaces, placeQueries, type PlaceSuggestion } from '../../trail/inferPlaces';
import { matchUnlocated } from '../../trail/matchUnlocated';
import { savePhotos } from '../../model/photos';
import { restoreJourneyPhotos } from '../../store';
import { thumbUrl } from '../../model/photos';
import { stopName, type Journey, type Photo } from '../../model/types';
import { applyInferredPlaces, attachLoose, notify, openLightbox, placeLoosePhotos, removePhotos, setTool, undo, useStore } from '../../store';
import { pickFiles } from '../pickFiles';
import { TimelineHelp } from '../TimelineHelp';

function Thumb({ photo, onClick, selected }: { photo?: Photo; onClick?: () => void; selected?: boolean }) {
  const url = thumbUrl(photo);
  return (
    <button
      className={`relative aspect-square w-full overflow-hidden rounded-lg bg-slate-800 ring-emerald-300/70 transition hover:ring-2 ${selected ? 'ring-2 ring-rose-400' : ''}`}
      onClick={onClick}
      aria-label={photo?.fileName ?? 'Photo'}
      aria-pressed={selected}
    >
      {url ? <img src={url} alt="" loading="lazy" className={`h-full w-full object-cover ${selected ? 'opacity-50' : ''}`} /> : <ImagePlus size={18} className="m-auto text-slate-600" />}
      {selected && (
        <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white">
          <Check size={13} />
        </span>
      )}
    </button>
  );
}

export function PhotosTab({ j, photos }: { j: Journey; photos: Map<string, Photo> }) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [placeProgress, setPlaceProgress] = useState('');
  const [suggestions, setSuggestions] = useState<Map<string, PlaceSuggestion>>(() => new Map());
  const loose = (j.loosePhotoIds ?? []).map((id) => photos.get(id)).filter((p): p is Photo => !!p);
  const all = j.stops.flatMap((s) => s.photoIds);
  const nearestStop = (p: Photo) =>
    j.stops.filter((s) => s.arrivedAt != null).sort((a, b) => Math.abs(a.arrivedAt! - p.takenAt) - Math.abs(b.arrivedAt! - p.takenAt))[0] ?? j.stops[0];

  const everyId = [...all, ...(j.loosePhotoIds ?? [])];
  const unavailable = everyId.filter((id) => !photos.has(id));
  const byKind = JUNK_KINDS.map((k) => ({ kind: k, ids: everyId.filter((id) => { const p = photos.get(id); return p && photoKind(p) === k; }) })).filter((g) => g.ids.length);
  const pick = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const stopSelecting = () => (setSelecting(false), setPicked(new Set()));
  const restoreOriginals = async () => {
    const files = await pickFiles('image/*,.heic,.heif,.tif,.tiff');
    if (!files.length) return;
    setBusy(true);
    try {
      const scanned = await scanUploads(files);
      const names = new Set(everyId.flatMap((id) => photos.get(id)?.fileName ?? []));
      const originals = await materialize(scanned.filter((c) => names.has(c.photo.fileName)));
      const existing = everyId.flatMap((id) => photos.get(id) ?? []);
      const restored = matchOriginals(existing, originals);
      if (!restored.length) return notify('No unique matching filenames found. Choose the original files for these photos.');
      const placed = await restoreJourneyPhotos(j.id, restored);
      notify(`Restored ${restored.length} photos; ${placed ?? 0} gained a map location. Unmatched or ambiguous filenames were skipped.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectTextHeavy = async () => {
    const candidates = everyId.flatMap((id) => {
      const p = photos.get(id);
      const blob = p?.previewBlob ?? p?.thumbBlob;
      return blob ? [{ id, getBlob: async () => blob }] : [];
    });
    if (!candidates.length) return notify('These photos have no readable previews to scan');
    setBusy(true);
    setScanProgress('Loading text scanner…');
    try {
      const found = await findTextHeavy(candidates, (done, total) => setScanProgress(`Checking photos… ${done} / ${total}`));
      if (!found.size) return notify('No text-heavy photos found');
      setPicked(found);
      setSelecting(true);
      notify(`Selected ${found.size} text-heavy photo${found.size === 1 ? '' : 's'}. Review them before removing.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      setScanProgress('');
    }
  };
  const placeWithTimeline = async () => {
    const files = await pickFiles('.json');
    if (!files.length) return;
    setBusy(true);
    try {
      const locate = makeLocator(await readTimelineFiles(files));
      const placed = loose.flatMap((p) => {
        const at = locate(p);
        return at ? [{ ...p, lat: at.lat, lng: at.lng, locatedBy: 'timeline' as const, locationSource: at.via === 'visit' ? 'timeline-visit' as const : 'timeline-path' as const, locationAccuracyM: at.accuracyM, locationAccuracyLevel: at.accuracyM != null ? 'unspecified' as const : undefined, locationTimeGapMs: at.timeGapMs }] : [];
      });
      if (!placed.length) return notify('None of these photos fall within your Timeline data');
      await placeLoosePhotos(placed);
      notify(`Placed ${placed.length} of ${loose.length} photos from your Timeline`, { label: 'Undo', run: undo });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const autoPlace = async (useModel: boolean) => {
    setBusy(true);
    setPlaceProgress(useModel ? 'Looking up place names…' : 'Placing photos…');
    try {
      const journeyPhotos = everyId.flatMap((id) => photos.get(id) ?? []);
      if (!useModel) {
        const result = inferPlaces(journeyPhotos, j.stops, { segments: j.segments, autoPin: true });
        await applyInferredPlaces(j.id, result);
        const n = result.updated.length;
        notify(n ? `Placed ${n} photo${n === 1 ? '' : 's'}${result.counts.guess ? ` (${result.counts.guess} as rough guesses)` : ''}` : 'Nothing to place yet', n ? { label: 'Undo', run: undo } : undefined);
        return;
      }
      // Photos a located shot already explains don't need the place model.
      const unmatched = new Set(matchUnlocated(journeyPhotos, j.stops).looseIds);
      const toRank = loose.filter((p) => unmatched.has(p.id));
      streetClipEngine.preload?.();
      // Place names are the choices the model picks from; only the ones some photo can use are looked up.
      const stops = await nameStops(j.stops, (d, t) => setPlaceProgress(`Looking up place names… ${d} / ${t}`), candidateStopIds(toRank, j.stops));
      const queries = placeQueries(toRank, stops);
      setPlaceProgress('Loading on-device place model…');
      const guesses = queries.length ? await streetClipEngine.rank(queries, (d, t) => setPlaceProgress(`Recognising places… ${d} / ${t}`)) : [];
      const result = inferPlaces(journeyPhotos, stops, { segments: j.segments, queries, guesses, autoPin: true });
      await applyInferredPlaces(j.id, result);
      setSuggestions(new Map(result.suggestions.map((s) => [s.photoId, s])));
      const n = result.updated.length;
      notify(
        n ? `Placed ${n} of ${loose.length} photos (${result.counts.ai} recognised, ${result.counts.time} by time, ${result.counts.visual} by a matching photo, ${result.counts.guess} rough guesses)` : result.suggestions.length ? 'No confident matches; unsure guesses are shown below' : 'No places found for these photos',
        n ? { label: 'Undo', run: undo } : undefined,
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
      setPlaceProgress('');
      void streetClipEngine.release?.();
    }
  };
  const acceptSuggestion = (p: Photo, s: PlaceSuggestion) => {
    const stop = j.stops.find((x) => x.id === s.stopId);
    if (!stop) return;
    void savePhotos([{ ...p, lat: stop.lat, lng: stop.lng, locationSource: 'inferred-ai', placementScore: s.score }]);
    attachLoose(p.id, stop.id);
    setSuggestions((m) => {
      const next = new Map(m);
      next.delete(p.id);
      return next;
    });
  };
  const open = (ids: string[], id: string) => (selecting ? pick(id) : openLightbox(ids, ids.indexOf(id)));

  return (
    <div className="space-y-6 p-4 pb-24">
      {unavailable.length > 0 && <p role="status" className="text-xs text-amber-200">{unavailable.length} saved photo record{unavailable.length === 1 ? ' is' : 's are'} not loaded. If this persists, restore a backup containing the photos.</p>}
      {everyId.length > 0 && (
        <div className="space-y-2">
          <button className="btn-ghost w-full border border-white/10 text-xs" disabled={busy} onClick={restoreOriginals}>Restore GPS / previews from originals</button>
          <div className="flex items-center justify-between gap-2">
            {selecting ? (
              <>
                <span className="text-xs text-slate-400">{picked.size ? `${picked.size} selected` : 'Tap photos to select them'}</span>
                <div className="flex gap-1.5">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={stopSelecting}>
                    Cancel
                  </button>
                  <button className="btn-ghost border border-rose-400/40 px-2 py-1 text-xs text-rose-200" disabled={!picked.size} onClick={() => (removePhotos([...picked]), stopSelecting())}>
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              </>
            ) : (
              <div className="ml-auto flex flex-wrap justify-end gap-1.5">
                <button className="btn-ghost border border-white/10 px-2 py-1 text-xs" disabled={busy} onClick={selectTextHeavy}>
                  {scanProgress || 'Select text-heavy photos'}
                </button>
                <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => setSelecting(true)}>
                  <Check size={13} /> Select photos to remove
                </button>
              </div>
            )}
          </div>
          {selecting && byKind.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {byKind.map(({ kind, ids }) => (
                <button key={kind} className="btn-ghost border border-white/10 px-2 py-1 text-xs" onClick={() => setPicked((s) => new Set([...s, ...ids]))}>
                  + {KIND_LABEL[kind]} ({ids.length})
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {loose.length > 0 && (
        <section>
          <h3 className="section-title">Needs a place · {loose.length}</h3>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">{j.stops.length ? 'These photos have no location. Their estimated positions along the trail use the time they were taken. Pin one exactly, or attach it to a stop.' : 'These photos have no saved location, so this journey cannot be mapped or named by place yet. Use Google Timeline, pin photos on the map, or re-import original photos with GPS.'}</p>
          {!selecting && (
            <div className="mb-3 rounded-xl bg-white/[0.03] p-3">
              <button className="btn-ghost w-full border border-white/10 py-1.5 text-xs" disabled={busy} onClick={placeWithTimeline}>
                <MapPinned size={14} /> {busy ? 'Reading your Timeline…' : 'Find places with Google Timeline'}
              </button>
              <TimelineHelp />
              {j.stops.length > 0 && (
                <button className="btn-ghost mt-2 w-full border border-emerald-400/30 py-1.5 text-xs text-emerald-100" disabled={busy} onClick={() => autoPlace(false)}>
                  <MapPin size={14} /> {placeProgress || 'Place all automatically'}
                </button>
              )}
              {j.stops.length > 1 && (
                <>
                  <button className="btn-ghost mt-2 w-full border border-white/10 py-1.5 text-xs" disabled={busy} onClick={() => autoPlace(true)}>
                    <ScanSearch size={14} /> Place all with on-device AI
                  </button>
                  <p className="mt-1 text-[11px] leading-snug text-slate-500">Picks among this trip's places with the StreetCLIP model (about 430 MB, downloaded once; CC BY-NC 4.0). Photos stay on this device. File dates from shared copies are not used to place photos.</p>
                </>
              )}
            </div>
          )}
          <ul className="space-y-1.5">
            {loose.map((p) => {
              const near = j.stops.length ? nearestStop(p) : undefined;
              const suggestion = suggestions.get(p.id);
              const suggested = suggestion && j.stops.find((s) => s.id === suggestion.stopId);
              return (
                <li key={p.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-1.5">
                  <div className="w-12 shrink-0">
                    <Thumb photo={p} selected={picked.has(p.id)} onClick={() => open(j.loosePhotoIds ?? [], p.id)} />
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="truncate text-slate-200">{p.fileName}</div>
                    <div className="text-slate-500">{new Date(p.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
                    {suggestion && suggested && !selecting && (
                      <button className="mt-0.5 truncate text-left text-emerald-300 hover:underline" onClick={() => acceptSuggestion(p, suggestion)}>
                        Looks like {stopName(suggested, j.stops.indexOf(suggested))} · {Math.round(suggestion.score * 100)}% — accept
                      </button>
                    )}
                  </div>
                  {!selecting && (
                    <>
                      <button className="icon-btn h-8 w-8" title="Pin on the map" aria-label="Pin on the map" onClick={() => setTool('pin', p.id)}>
                        <MapPin size={15} />
                      </button>
                      {near && (
                        <button className="icon-btn h-8 w-8" title={`Attach to ${stopName(near, j.stops.indexOf(near))}`} aria-label="Attach to nearest stop" onClick={() => attachLoose(p.id, near.id)}>
                          <Link2 size={15} />
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section>
        <h3 className="section-title">On the trail · {all.length}</h3>
        {all.length === 0 ? (
          <p className="text-xs text-slate-500">{j.loosePhotoIds?.length ? 'This journey has saved photos waiting for a place.' : 'No photos on this journey yet.'}</p>
        ) : (
          <div className="grid grid-cols-4 gap-1.5">
            {all.map((id) => (
              <Thumb key={id} photo={photos.get(id)} selected={picked.has(id)} onClick={() => open(all, id)} />
            ))}
          </div>
        )}
      </section>
      <button className="btn-ghost w-full border border-white/10 py-2" onClick={() => useStore.setState({ wizardOpen: true })}>
        <ImagePlus size={16} /> Add more photos
      </button>
    </div>
  );
}
