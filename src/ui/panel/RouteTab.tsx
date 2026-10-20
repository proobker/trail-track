import { ArrowDown, ArrowUp, Combine, ImageIcon, MapPinPlus, MoreHorizontal, Pencil, Split, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { flag } from '../../geo/reverse';
import { mapRef } from '../../map/MapView';
import { thumbUrl } from '../../model/photos';
import { stopName, type Journey, type Photo, type Stop } from '../../model/types';
import { deleteStop, mergeStop, openLightbox, reorderStop, setTool, splitStop, updateStop, useStore } from '../../store';
import { groupByDay } from '../../trail/days';
import { ModeIcon } from '../icons';
import { formatKm, ModeChip } from '../ModeChip';
import { MenuItem, Popover } from '../Popover';

const time = (t?: number) => (t == null ? '' : new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));

function AutoTextarea({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };
  useEffect(fit, []);
  return (
    <textarea
      ref={ref}
      rows={2}
      defaultValue={value}
      placeholder={placeholder}
      onInput={fit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      className="input resize-none text-[13px] leading-relaxed"
    />
  );
}

function StopRow({ stop, index, count, photos, selected }: { stop: Stop; index: number; count: number; photos: Map<string, Photo>; selected: boolean }) {
  const cover = stop.photoIds.map((id) => photos.get(id)).find((p) => p?.thumbBlob || p?.previewBlob);
  const url = thumbUrl(cover);
  const rowRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const place = [stop.place?.city, stop.place?.country].filter(Boolean).join(', ');

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const select = () => {
    useStore.setState({ selectedStopId: stop.id, selectedSegmentId: undefined });
    const map = mapRef.current;
    map?.flyTo({ center: [stop.lng, stop.lat], zoom: Math.max(map.getZoom(), 13), duration: 900 });
  };

  return (
    <div
      ref={rowRef}
      className={`group relative rounded-xl transition ${selected ? 'bg-emerald-400/[0.08] ring-1 ring-emerald-400/40' : 'hover:bg-white/[0.04]'}`}
    >
      <div className="flex cursor-pointer items-center gap-3 p-2" onClick={select}>
        <button
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-slate-800 bg-cover bg-center text-xs font-semibold text-slate-300 ${selected ? 'border-emerald-300' : 'border-white/80'}`}
          style={url ? { backgroundImage: `url(${url})` } : undefined}
          onClick={(e) => {
            if (!stop.photoIds.length) return;
            e.stopPropagation();
            openLightbox(stop.photoIds);
          }}
          aria-label={stop.photoIds.length ? `View ${stop.photoIds.length === 1 ? 'photo' : `${stop.photoIds.length} photos`}` : `Stop ${index + 1}`}
          tabIndex={stop.photoIds.length ? 0 : -1}
        >
          {!url && index + 1}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-100">{stopName(stop, index)}</div>
          <div className="flex items-center gap-1.5 truncate text-xs text-slate-500">
            {stop.arrivedAt != null && <span className="tabular-nums">{time(stop.arrivedAt)}</span>}
            {place && (
              <span className="truncate">
                {stop.arrivedAt != null && '· '}
                {flag(stop.place?.countryCode)} {place}
              </span>
            )}
            {stop.photoIds.length > 0 && (
              <span className="inline-flex shrink-0 items-center gap-0.5">
                · <ImageIcon size={11} /> {stop.photoIds.length}
              </span>
            )}
          </div>
        </div>
        <Popover
          label="Stop actions"
          align="right"
          triggerClassName={`icon-btn h-7 w-7 ${selected ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
          trigger={<MoreHorizontal size={16} />}
          className="w-52"
        >
          {(close) => (
            <>
              <MenuItem icon={<Pencil size={15} />} onClick={() => (select(), close(), setTimeout(() => nameRef.current?.focus(), 50))}>
                Rename
              </MenuItem>
              <MenuItem icon={<ArrowUp size={15} />} disabled={index === 0} onClick={() => (reorderStop(index, index - 1), close())}>
                Move earlier
              </MenuItem>
              <MenuItem icon={<ArrowDown size={15} />} disabled={index === count - 1} onClick={() => (reorderStop(index, index + 1), close())}>
                Move later
              </MenuItem>
              <MenuItem icon={<Combine size={15} />} disabled={index === count - 1} onClick={() => (mergeStop(stop.id), close())}>
                Merge with next stop
              </MenuItem>
              <MenuItem icon={<Split size={15} />} disabled={stop.photoIds.length < 2} onClick={() => (splitStop(stop.id), close())}>
                Split by time gap
              </MenuItem>
              <div className="my-1 h-px bg-white/10" />
              <MenuItem icon={<Trash2 size={15} />} danger onClick={() => (deleteStop(stop.id), close())}>
                Remove stop
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
      {selected && (
        <div className="space-y-2 px-2 pb-2.5 pl-[60px]">
          <input
            ref={nameRef}
            key={`${stop.id}-name`}
            className="input py-1 text-[13px]"
            defaultValue={stop.label ?? ''}
            placeholder={stopName({ ...stop, label: undefined }, index)}
            aria-label="Stop name"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            onBlur={(e) => e.target.value.trim() !== (stop.label ?? '') && updateStop(stop.id, { label: e.target.value.trim() || undefined })}
          />
          <AutoTextarea key={`${stop.id}-note`} value={stop.note ?? ''} placeholder="Write a note about this place…" onCommit={(v) => updateStop(stop.id, { note: v.trim() || undefined })} />
          {stop.photoIds.length > 1 && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {stop.photoIds.map((id, k) => {
                const u = thumbUrl(photos.get(id));
                return (
                  <button key={id} className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-slate-800 ring-white/40 hover:ring-2" onClick={() => openLightbox(stop.photoIds, k)} aria-label={`Photo ${k + 1}`}>
                    {u && <img src={u} alt="" className="h-full w-full object-cover" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RouteTab({ j, photos }: { j: Journey; photos: Map<string, Photo> }) {
  const selectedStopId = useStore((s) => s.selectedStopId);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const segFrom = new Map(j.segments.map((s) => [s.fromStopId, s]));
  const days = groupByDay(j);

  if (!j.stops.length) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
          <MapPinPlus size={22} />
        </div>
        <p className="text-sm text-slate-400">No stops yet. Click the map to drop them, or search for a place above.</p>
        <button className="btn-primary" onClick={() => setTool('add')}>
          Start adding stops
        </button>
      </div>
    );
  }

  return (
    <div className="pb-24">
      {days.map((d, di) => (
        <section key={d.date ?? `undated-${di}`}>
          {(days.length > 1 || d.date) && (
            <header className="glass-strong sticky top-0 z-10 flex items-baseline justify-between gap-2 border-b border-white/5 px-4 py-2">
              <div className="text-xs font-semibold tracking-wide text-slate-200 uppercase">
                {d.date ? `Day ${d.dayNumber}` : 'Undated'}
                {d.date && (
                  <span className="ml-2 font-normal tracking-normal text-slate-400 normal-case">
                    {new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 tabular-nums">
                {d.modes.map((m) => (
                  <ModeIcon key={m} mode={m} size={12} />
                ))}
                {d.metres > 0 && <span>{formatKm(d.metres)}</span>}
              </div>
            </header>
          )}
          <div className="px-2 py-1">
            {d.stops.map(({ stop, index }) => {
              const seg = segFrom.get(stop.id);
              return (
                <div key={stop.id}>
                  <StopRow stop={stop} index={index} count={j.stops.length} photos={photos} selected={stop.id === selectedStopId} />
                  {seg && index < j.stops.length - 1 && <ModeChip seg={seg} journeyId={j.id} selected={seg.id === selectedSegmentId} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
