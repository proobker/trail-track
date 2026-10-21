import { Check, ImagePlus, Link2, MapPin, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { JUNK_KINDS, KIND_LABEL, photoKind } from '../../import/photoKind';
import { thumbUrl } from '../../model/photos';
import { stopName, type Journey, type Photo } from '../../model/types';
import { attachLoose, openLightbox, removePhotos, setTool, useStore } from '../../store';

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
  const loose = (j.loosePhotoIds ?? []).map((id) => photos.get(id)).filter((p): p is Photo => !!p);
  const all = j.stops.flatMap((s) => s.photoIds);
  const nearestStop = (p: Photo) =>
    j.stops.filter((s) => s.arrivedAt != null).sort((a, b) => Math.abs(a.arrivedAt! - p.takenAt) - Math.abs(b.arrivedAt! - p.takenAt))[0] ?? j.stops[0];

  const everyId = [...all, ...(j.loosePhotoIds ?? [])];
  const byKind = JUNK_KINDS.map((k) => ({ kind: k, ids: everyId.filter((id) => { const p = photos.get(id); return p && photoKind(p) === k; }) })).filter((g) => g.ids.length);
  const pick = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const stopSelecting = () => (setSelecting(false), setPicked(new Set()));
  const open = (ids: string[], id: string) => (selecting ? pick(id) : openLightbox(ids, ids.indexOf(id)));

  return (
    <div className="space-y-6 p-4 pb-24">
      {everyId.length > 0 && (
        <div className="space-y-2">
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
              <button className="btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => setSelecting(true)}>
                <Check size={13} /> Select photos to remove
              </button>
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
          <p className="mb-3 text-xs leading-relaxed text-slate-500">These have no location, so they sit along the trail by the time they were taken (dashed on the map). Pin one exactly, or attach it to the closest stop in time.</p>
          <ul className="space-y-1.5">
            {loose.map((p) => {
              const near = j.stops.length ? nearestStop(p) : undefined;
              return (
                <li key={p.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-1.5">
                  <div className="w-12 shrink-0">
                    <Thumb photo={p} selected={picked.has(p.id)} onClick={() => open(j.loosePhotoIds ?? [], p.id)} />
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="truncate text-slate-200">{p.fileName}</div>
                    <div className="text-slate-500">{new Date(p.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
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
          <p className="text-xs text-slate-500">No photos on this journey yet.</p>
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
