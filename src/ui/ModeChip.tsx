import { Loader2, PenLine, RotateCcw, Route } from 'lucide-react';
import { MODE_META, MODES, type Mode, type Segment } from '../model/types';
import { relabelSegment, routeSegments, setSegmentMode, setTool, useStore } from '../store';
import { lineMetres } from '../trail/geo';
import { ModeIcon } from './icons';
import { MenuItem, Popover } from './Popover';

export const formatKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : m < 100_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`);

const ROUTABLE: Mode[] = ['walk', 'bike', 'car', 'bus'];

const ROUTING_LABEL: Record<Segment['routing'], string> = {
  routed: 'on roads',
  straight: 'straight',
  arc: 'arc',
  imported: 'track',
  manual: 'drawn',
};

/** One leg of the route: a coloured pill that opens a mode picker and leg actions. */
export function ModeChip({ seg, journeyId, selected }: { seg: Segment; journeyId: string; selected: boolean }) {
  const routing = useStore((s) => s.routing.has(seg.id));
  const meta = MODE_META[seg.mode];
  const keepsShape = seg.routing === 'imported' || seg.routing === 'manual';
  const unrouted = seg.routing === 'straight' && ROUTABLE.includes(seg.mode);
  const choose = (m: Mode) => (keepsShape ? relabelSegment(seg.id, m) : setSegmentMode(seg.id, m));

  return (
    <div className="flex items-stretch gap-3 pl-[19px]">
      <div className="w-[3px] shrink-0 rounded-full" style={{ background: `linear-gradient(${meta.color}, ${meta.color}aa)`, boxShadow: `0 0 8px ${meta.color}88` }} />
      <div className="my-1.5 flex min-w-0 flex-1 items-center gap-2">
        <Popover
          label={`Change how you travelled (${meta.label})`}
          triggerClassName={`group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pr-2.5 pl-2 text-xs font-medium transition hover:bg-white/10 ${selected ? 'ring-2 ring-white/30' : ''}`}
          trigger={
            <span
              className="inline-flex items-center gap-1.5"
              style={{ color: meta.color }}
              onClick={() => useStore.setState({ selectedSegmentId: seg.id, selectedStopId: undefined })}
            >
              <ModeIcon mode={seg.mode} size={14} />
              {meta.label}
            </span>
          }
          className="w-56"
        >
          {(close) => (
            <>
              <div className="grid grid-cols-4 gap-1 p-1">
                {MODES.map((m) => (
                  <button
                    key={m}
                    title={MODE_META[m].label}
                    onClick={() => {
                      choose(m);
                      close();
                    }}
                    className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] text-slate-300 transition hover:bg-white/10 ${seg.mode === m ? 'bg-white/15 text-white' : ''}`}
                  >
                    <ModeIcon mode={m} size={18} />
                    {MODE_META[m].label}
                  </button>
                ))}
              </div>
              <div className="my-1 h-px bg-white/10" />
              {ROUTABLE.includes(seg.mode) && (
                <MenuItem icon={<Route size={15} />} onClick={() => (routeSegments(journeyId, [seg.id]), close())}>
                  Follow roads again
                </MenuItem>
              )}
              <MenuItem
                icon={<PenLine size={15} />}
                onClick={() => {
                  useStore.setState({ selectedSegmentId: seg.id, selectedStopId: undefined });
                  setTool('draw');
                  close();
                }}
              >
                Draw the path by hand
              </MenuItem>
              {keepsShape && (
                <MenuItem icon={<RotateCcw size={15} />} onClick={() => (setSegmentMode(seg.id, seg.mode), close())}>
                  Reset path
                </MenuItem>
              )}
            </>
          )}
        </Popover>
        <span className="truncate text-xs text-slate-500 tabular-nums">
          {formatKm(lineMetres(seg.geometry.coordinates as [number, number][]))}
          {routing ? (
            <Loader2 size={12} className="ml-1.5 inline animate-spin text-emerald-300" aria-label="Finding route" />
          ) : (
            <span className={unrouted ? 'text-amber-300/90' : ''}> · {ROUTING_LABEL[seg.routing]}</span>
          )}
        </span>
      </div>
    </div>
  );
}
