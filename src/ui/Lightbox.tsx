import { ChevronLeft, ChevronRight, MapPin, Trash2, Users, X } from 'lucide-react';
import { useEffect } from 'react';
import { mapRef } from '../map/MapView';
import { previewUrl, usePhoto } from '../model/photos';
import { stopName } from '../model/types';
import { activeJourney, removePhotos, useStore } from '../store';

export function Lightbox() {
  const lb = useStore((s) => s.lightbox);
  const j = useStore(activeJourney);
  const id = lb?.photoIds[lb.index];
  const photo = usePhoto(id);
  const stopIndex = j?.stops.findIndex((s) => id && s.photoIds.includes(id)) ?? -1;
  const stop = stopIndex >= 0 ? j!.stops[stopIndex] : undefined;
  const inJourney = !!stop || (!!id && !!j?.loosePhotoIds?.includes(id));

  useEffect(() => {
    if (!lb) return;
    const go = (d: number) => useStore.setState({ lightbox: { ...lb, index: (lb.index + d + lb.photoIds.length) % lb.photoIds.length } });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.setState({ lightbox: undefined });
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lb]);

  if (!lb) return null;
  const close = () => useStore.setState({ lightbox: undefined });
  const go = (d: number) => useStore.setState({ lightbox: { ...lb, index: (lb.index + d + lb.photoIds.length) % lb.photoIds.length } });
  const url = previewUrl(photo);
  const many = lb.photoIds.length > 1;

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-black/92 backdrop-blur" onClick={close} role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="flex items-center justify-between p-3 text-sm text-slate-300" onClick={(e) => e.stopPropagation()}>
        <span className="tabular-nums">{many ? `${lb.index + 1} / ${lb.photoIds.length}` : ''}</span>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-16">
        {url ? (
          <img key={id} src={url} alt={photo?.fileName ?? ''} className="pop-in max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        ) : (
          <div className="text-slate-500">No preview for this file</div>
        )}
        {many && (
          <>
            <button className="icon-btn absolute left-2 h-11 w-11 bg-white/10 sm:left-4" onClick={(e) => (e.stopPropagation(), go(-1))} aria-label="Previous photo">
              <ChevronLeft size={24} />
            </button>
            <button className="icon-btn absolute right-2 h-11 w-11 bg-white/10 sm:right-4" onClick={(e) => (e.stopPropagation(), go(1))} aria-label="Next photo">
              <ChevronRight size={24} />
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 p-4 text-sm text-slate-300" onClick={(e) => e.stopPropagation()}>
        {stop && <span className="font-medium text-white">{stopName(stop, stopIndex)}</span>}
        {photo && <span>{new Date(photo.takenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
        {photo && photo.people.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Users size={14} /> {photo.people.join(', ')}
          </span>
        )}
        {id && inJourney && (
          <button
            className="btn-ghost px-2 py-1 text-xs text-rose-200"
            onClick={() => {
              removePhotos([id]);
              const rest = lb.photoIds.filter((x) => x !== id);
              useStore.setState({ lightbox: rest.length ? { photoIds: rest, index: Math.min(lb.index, rest.length - 1) } : undefined });
            }}
          >
            <Trash2 size={14} /> Remove from journey
          </button>
        )}
        {stop && (
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => {
              close();
              useStore.setState({ selectedStopId: stop.id, selectedSegmentId: undefined });
              mapRef.current?.flyTo({ center: [stop.lng, stop.lat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 1200 });
            }}
          >
            <MapPin size={14} /> Show on map
          </button>
        )}
      </div>
    </div>
  );
}
