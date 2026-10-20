import { Pause, Play, Video, VideoOff } from 'lucide-react';
import { useMemo } from 'react';
import { buildTimeline } from '../animate/timeline';
import { previewUrl, useJourneyPhotos } from '../model/photos';
import { MODE_META, stopName } from '../model/types';
import { activeJourney, openLightbox, setPlayer, togglePlay, useStore } from '../store';
import { localDay } from '../trail/days';
import { ModeIcon } from './icons';
import { useIsMobile } from './useMedia';

const SPEEDS = [0.5, 1, 2, 4];

export function PlayerBar() {
  const j = useStore(activeJourney);
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const player = useStore((s) => s.player);
  const playhead = useStore((s) => s.playhead);
  const mobile = useIsMobile();

  // Stop ticks and day dividers along the scrubber, from the same timeline the map animates.
  const marks = useMemo(() => {
    if (!j) return { stops: [], days: [] };
    const tl = buildTimeline(j);
    const stops: { at: number; photos: boolean }[] = [];
    const days: number[] = [];
    let lastDay: string | undefined;
    for (const it of tl.items) {
      if (it.kind !== 'stop') continue;
      const s = j.stops[it.stop];
      stops.push({ at: it.start / tl.total, photos: s.photoIds.length > 0 });
      const d = s.arrivedAt != null ? localDay(s.arrivedAt) : lastDay;
      if (lastDay && d !== lastDay) days.push(it.start / tl.total);
      lastDay = d;
    }
    return { stops, days };
  }, [j]);

  if (!j || view !== 'journey' || j.segments.length === 0 || tool !== 'view') return null;
  const active = player.playing || player.progress < 1;

  return (
    <div
      className={`glass-strong absolute left-1/2 z-10 flex w-[min(620px,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-2xl px-3 py-2.5 shadow-2xl ${mobile ? 'bottom-[180px]' : 'bottom-5'}`}
    >
      <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-slate-950 shadow-[0_0_20px_rgba(52,211,153,0.45)] transition hover:scale-105" onClick={togglePlay} aria-label={player.playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
        {player.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex h-4 items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {active && playhead?.mode && <ModeIcon mode={playhead.mode} size={13} />}
            {active && playhead?.mode && <span className="text-slate-300">{MODE_META[playhead.mode].label}</span>}
            {active && playhead?.pauseStop != null && <span className="truncate text-slate-200">{stopName(j.stops[playhead.pauseStop], playhead.pauseStop)}</span>}
            {!active && <span>Press play to relive the trip</span>}
          </span>
          {active && playhead?.time != null && <span className="shrink-0">{new Date(playhead.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
        </div>
        <div className="relative h-4">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${player.progress * 100}%` }} />
          </div>
          {marks.days.map((d) => (
            <span key={`d${d}`} className="pointer-events-none absolute top-0 h-4 w-px bg-white/40" style={{ left: `${d * 100}%` }} />
          ))}
          {marks.stops.map((s, i) => (
            <span
              key={i}
              className={`pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${s.at <= player.progress ? 'bg-slate-950' : s.photos ? 'bg-white/70' : 'bg-white/30'}`}
              style={{ left: `${s.at * 100}%` }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(player.progress * 1000)}
            onChange={(e) => setPlayer({ progress: Number(e.target.value) / 1000 })}
            className="scrubber absolute inset-0 w-full"
            aria-label="Playback position"
          />
        </div>
      </div>
      <button className="btn-ghost w-11 shrink-0 px-1 text-xs tabular-nums" onClick={() => setPlayer({ speed: SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length] })} title="Playback speed" aria-label={`Speed ${player.speed}×`}>
        {player.speed}×
      </button>
      <button className={`icon-btn h-9 w-9 shrink-0 ${player.follow ? 'text-emerald-300' : ''}`} onClick={() => setPlayer({ follow: !player.follow })} title={player.follow ? 'Camera follows the trail' : 'Camera stays put'} aria-label="Toggle camera follow" aria-pressed={player.follow}>
        {player.follow ? <Video size={17} /> : <VideoOff size={17} />}
      </button>
    </div>
  );
}

/** Shows the photos and note of the stop the animation is pausing at. */
export function PlaybackCard() {
  const j = useStore(activeJourney);
  const playhead = useStore((s) => s.playhead);
  const photos = useJourneyPhotos(j);
  const mobile = useIsMobile();
  const stop = playhead?.pauseStop != null ? j?.stops[playhead.pauseStop] : undefined;
  if (!stop || (stop.photoIds.length === 0 && !stop.note)) return null;
  const shown = stop.photoIds.slice(0, 2);
  const place = [stop.place?.city, stop.place?.country].filter(Boolean).join(', ');
  return (
    <div
      key={stop.id}
      className={`pop-in glass-strong absolute z-10 w-[min(300px,calc(100%-1.5rem))] rounded-2xl p-2 shadow-2xl ${mobile ? 'top-16 left-3' : 'bottom-28 left-4'}`}
    >
      {shown.length > 0 && (
        <button className={`grid w-full gap-1.5 ${shown.length > 1 ? 'grid-cols-2' : ''}`} onClick={() => openLightbox(stop.photoIds)} aria-label="Open photos">
          {shown.map((id) => {
            const url = previewUrl(photos.get(id));
            return url ? <img key={id} src={url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" /> : null;
          })}
        </button>
      )}
      <div className="px-1.5 pt-2 pb-1">
        <div className="font-medium text-white">{stopName(stop, playhead!.pauseStop!)}</div>
        <div className="text-xs text-slate-400">{[place, stop.photoIds.length > 2 ? `+${stop.photoIds.length - 2} more` : ''].filter(Boolean).join(' · ')}</div>
        {stop.note && <p className="mt-1.5 line-clamp-4 text-[13px] leading-relaxed text-slate-300">{stop.note}</p>}
      </div>
    </div>
  );
}
