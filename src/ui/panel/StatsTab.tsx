import { Mountain, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flag } from '../../geo/reverse';
import { setHoverPoint } from '../../map/MapView';
import { MODE_META, STACK_ORDER, type Journey, type Mode } from '../../model/types';
import { profileFor, type Profile } from '../../stats/elevation';
import { groupByDay } from '../../trail/days';
import { journeyStats } from '../../trail/journey';
import { ModeIcon } from '../icons';
import { formatKm } from '../ModeChip';

const GROUND: Mode[] = ['walk', 'bike', 'car', 'bus', 'train'];
const W = 320;
const H = 120;

/** Single-series elevation area chart with a crosshair tooltip that also marks the map. */
function ElevationChart({ profile }: { profile: Profile }) {
  const [hover, setHover] = useState<number>();
  const box = useRef<HTMLDivElement>(null);
  const { points, min, max } = profile;
  const total = points[points.length - 1].at || 1;
  const lo = Math.floor(min / 10) * 10;
  const hi = Math.max(lo + 20, Math.ceil(max / 10) * 10);
  const x = (at: number) => (at / total) * W;
  const y = (ele: number) => H - 6 - ((ele - lo) / (hi - lo)) * (H - 12);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.ele).toFixed(1)}`).join('');
  const area = `${line}L${W},${H}L0,${H}Z`;
  const hp = hover != null ? points[hover] : undefined;

  useEffect(() => () => setHoverPoint(undefined), []);

  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const at = ((e.clientX - r.left) / r.width) * total;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].at - at) < Math.abs(points[best].at - at)) best = i;
    setHover(best);
    setHoverPoint(points[best].coord);
  };

  return (
    <figure>
      <div className="flex text-[10px] text-slate-500 tabular-nums">
        <div className="flex w-10 shrink-0 flex-col justify-between py-0.5 pr-1.5 text-right" style={{ height: H }}>
          <span>{hi} m</span>
          <span>{lo} m</span>
        </div>
        <div
          ref={box}
          className="relative flex-1 touch-none"
          style={{ height: H }}
          onPointerMove={onMove}
          onPointerLeave={() => {
            setHover(undefined);
            setHoverPoint(undefined);
          }}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={`Elevation from ${Math.round(min)} to ${Math.round(max)} metres`}>
            <line x1={0} x2={W} y1={y(hi)} y2={y(hi)} stroke="rgb(148 163 184 / 0.15)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={W} y1={H} y2={H} stroke="rgb(148 163 184 / 0.3)" vectorEffect="non-scaling-stroke" />
            <path d={area} fill="#3987e5" fillOpacity={0.18} />
            <path d={line} fill="none" stroke="#3987e5" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {hp && <line x1={x(hp.at)} x2={x(hp.at)} y1={0} y2={H} stroke="rgb(226 232 240 / 0.5)" vectorEffect="non-scaling-stroke" />}
          </svg>
          {hp && (
            <>
              <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-[#3987e5]" style={{ left: `${(hp.at / total) * 100}%`, top: y(hp.ele) }} />
              <div
                className="glass-strong pointer-events-none absolute -top-9 z-10 rounded-md px-2 py-1 text-[11px] whitespace-nowrap text-slate-100 shadow-lg"
                style={{ left: `${(hp.at / total) * 100}%`, transform: `translateX(${hp.at / total > 0.6 ? '-100%' : '0'})` }}
              >
                <b className="font-semibold">{Math.round(hp.ele)} m</b> <span className="text-slate-400">at {formatKm(hp.at)}</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-1 flex justify-between pl-10 text-[10px] text-slate-500 tabular-nums">
        <span>0</span>
        <span>{formatKm(total)}</span>
      </div>
    </figure>
  );
}

function ElevationSection({ j }: { j: Journey }) {
  const days = useMemo(() => groupByDay(j).filter((d) => d.date), [j]);
  const [scope, setScope] = useState<string>('all');
  const [state, setState] = useState<{ key: string; profile?: Profile; loading: boolean }>({ key: '', loading: false });
  const segments = useMemo(() => {
    const stopIds = scope === 'all' ? undefined : new Set(days.find((d) => d.date === scope)?.stops.map((s) => s.stop.id));
    return j.segments.filter((s) => GROUND.includes(s.mode) && (!stopIds || stopIds.has(s.fromStopId)));
  }, [j, scope, days]);
  const key = `${scope}:${segments.map((s) => `${s.id}${s.geometry.coordinates.length}`).join()}`;

  useEffect(() => {
    if (!segments.length) return;
    let alive = true;
    setState({ key, loading: true });
    profileFor(segments).then((profile) => alive && setState({ key, profile, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="section-title mb-0 flex items-center gap-1.5">
          <Mountain size={13} /> Elevation
        </h3>
        {days.length > 1 && (
          <select className="input w-auto py-0.5 text-xs" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Elevation range">
            <option value="all">Whole journey</option>
            {days.map((d) => (
              <option key={d.date} value={d.date}>
                Day {d.dayNumber}
              </option>
            ))}
          </select>
        )}
      </div>
      {!segments.length ? (
        <p className="text-xs text-slate-500">No ground legs to profile (flights and boats are skipped).</p>
      ) : state.loading || state.key !== key ? (
        <div className="h-[140px] animate-pulse rounded-lg bg-white/[0.04]" />
      ) : state.profile ? (
        <>
          <div className="mb-3 flex gap-4 text-xs text-slate-300 tabular-nums">
            <span className="inline-flex items-center gap-1">
              <TrendingUp size={13} className="text-slate-400" /> {Math.round(state.profile.ascent)} m up
            </span>
            <span className="inline-flex items-center gap-1">
              <TrendingDown size={13} className="text-slate-400" /> {Math.round(state.profile.descent)} m down
            </span>
            <span className="text-slate-500">
              {Math.round(state.profile.min)}–{Math.round(state.profile.max)} m
            </span>
          </div>
          <ElevationChart profile={state.profile} />
        </>
      ) : (
        <p className="text-xs text-slate-500">Elevation data couldn't be loaded.</p>
      )}
    </section>
  );
}

/** Distance share per mode: one stacked bar in the palette's validated order, with a labelled legend. */
function ModeBreakdown({ byMode, totalM }: { byMode: Map<Mode, number>; totalM: number }) {
  const [hover, setHover] = useState<Mode>();
  const rows = STACK_ORDER.filter((m) => (byMode.get(m) ?? 0) > 0).map((m) => ({ mode: m, metres: byMode.get(m)! }));
  if (!rows.length) return null;
  return (
    <section>
      <h3 className="section-title">How you travelled</h3>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={rows.map((r) => `${MODE_META[r.mode].label} ${formatKm(r.metres)}`).join(', ')}>
        {rows.map((r) => (
          <div
            key={r.mode}
            onPointerEnter={() => setHover(r.mode)}
            onPointerLeave={() => setHover(undefined)}
            className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(r.metres / totalM) * 100}%`, minWidth: 4, background: MODE_META[r.mode].color, opacity: hover && hover !== r.mode ? 0.35 : 1 }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.mode} className={`flex items-center gap-2 transition-opacity ${hover && hover !== r.mode ? 'opacity-40' : ''}`} onPointerEnter={() => setHover(r.mode)} onPointerLeave={() => setHover(undefined)}>
            <ModeIcon mode={r.mode} size={13} />
            <span className="text-slate-300">{MODE_META[r.mode].label}</span>
            <span className="ml-auto text-slate-400 tabular-nums">
              {formatKm(r.metres)} <span className="text-slate-600">· {Math.round((r.metres / totalM) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const hm = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

export function StatsTab({ j }: { j: Journey }) {
  const st = journeyStats(j);
  const days = groupByDay(j).filter((d) => d.date);
  const countries = new Map<string, { name: string; code?: string; cities: Set<string> }>();
  for (const s of j.stops) {
    if (!s.place?.country) continue;
    const c = countries.get(s.place.country) ?? { name: s.place.country, code: s.place.countryCode, cities: new Set() };
    if (s.place.city) c.cities.add(s.place.city);
    countries.set(s.place.country, c);
  }

  return (
    <div className="space-y-7 p-4 pb-24">
      <ModeBreakdown byMode={st.byMode} totalM={st.totalKm * 1000} />

      {days.length > 0 && (
        <section>
          <h3 className="section-title">Day by day</h3>
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-[10px] tracking-wide text-slate-500 uppercase">
                <th className="pb-1.5 font-medium">Day</th>
                <th className="pb-1.5 text-right font-medium">Distance</th>
                <th className="pb-1.5 text-right font-medium">Out for</th>
                <th className="pb-1.5 text-right font-medium">Photos</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-white/5">
                  <td className="py-1.5">
                    <span className="text-slate-200">Day {d.dayNumber}</span>{' '}
                    <span className="text-slate-500">{new Date(`${d.date}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </td>
                  <td className="py-1.5 text-right text-slate-300">{d.metres ? formatKm(d.metres) : '—'}</td>
                  <td className="py-1.5 text-right text-slate-400">{d.spanMs ? hm(d.spanMs) : '—'}</td>
                  <td className="py-1.5 text-right text-slate-400">{d.photoCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <ElevationSection j={j} />

      <section>
        <h3 className="section-title">Places</h3>
        {countries.size === 0 ? (
          <p className="text-xs text-slate-500">Place names appear here as stops are looked up.</p>
        ) : (
          <ul className="space-y-2.5">
            {[...countries.values()].map((c) => (
              <li key={c.name}>
                <div className="text-sm text-slate-200">
                  <span className="mr-1.5">{flag(c.code)}</span>
                  {c.name}
                </div>
                {c.cities.size > 0 && <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{[...c.cities].join(' · ')}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
