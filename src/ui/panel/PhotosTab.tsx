import { ImagePlus, Link2, MapPin } from 'lucide-react';
import { thumbUrl } from '../../model/photos';
import { stopName, type Journey, type Photo } from '../../model/types';
import { attachLoose, openLightbox, setTool, useStore } from '../../store';

function Thumb({ photo, onClick }: { photo?: Photo; onClick?: () => void }) {
  const url = thumbUrl(photo);
  return (
    <button className="aspect-square w-full overflow-hidden rounded-lg bg-slate-800 ring-emerald-300/70 transition hover:ring-2" onClick={onClick} aria-label={photo?.fileName ?? 'Photo'}>
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImagePlus size={18} className="m-auto text-slate-600" />}
    </button>
  );
}

export function PhotosTab({ j, photos }: { j: Journey; photos: Map<string, Photo> }) {
  const loose = (j.loosePhotoIds ?? []).map((id) => photos.get(id)).filter((p): p is Photo => !!p);
  const all = j.stops.flatMap((s) => s.photoIds);
  const nearestStop = (p: Photo) =>
    j.stops.filter((s) => s.arrivedAt != null).sort((a, b) => Math.abs(a.arrivedAt! - p.takenAt) - Math.abs(b.arrivedAt! - p.takenAt))[0] ?? j.stops[0];

  return (
    <div className="space-y-6 p-4 pb-24">
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
                    <Thumb photo={p} onClick={() => openLightbox(j.loosePhotoIds ?? [], (j.loosePhotoIds ?? []).indexOf(p.id))} />
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="truncate text-slate-200">{p.fileName}</div>
                    <div className="text-slate-500">{new Date(p.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </div>
                  <button className="icon-btn h-8 w-8" title="Pin on the map" aria-label="Pin on the map" onClick={() => setTool('pin', p.id)}>
                    <MapPin size={15} />
                  </button>
                  {near && (
                    <button className="icon-btn h-8 w-8" title={`Attach to ${stopName(near, j.stops.indexOf(near))}`} aria-label="Attach to nearest stop" onClick={() => attachLoose(p.id, near.id)}>
                      <Link2 size={15} />
                    </button>
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
            {all.map((id, i) => (
              <Thumb key={id} photo={photos.get(id)} onClick={() => openLightbox(all, i)} />
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
