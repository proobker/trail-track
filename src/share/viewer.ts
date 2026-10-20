/**
 * Standalone replay page embedded in "Share as HTML" exports. It runs without the app:
 * MapLibre comes from a CDN script tag (global `maplibregl`), and the journey plus its
 * photos are inlined as `window.TT_DATA`.
 */
import type { Map as MlMap, Marker } from 'maplibre-gl';
import { buildTimeline, frameTime, sample } from '../animate/timeline';
import { addTrailLayers, setData, stopsData, trailData } from '../map/layers';
import { MODE_META, stopName, type Journey } from '../model/types';
import { journeyStats } from '../trail/journey';

interface ShareData {
  journey: Journey;
  images: Record<string, string>;
}

declare const maplibregl: typeof import('maplibre-gl');
declare global {
  interface Window {
    TT_DATA: ShareData;
  }
}

const CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0b1020;color:#e2e8f0;font:14px/1.4 Inter,system-ui,sans-serif}
#map{position:fixed;inset:0}
.glass{background:rgba(15,23,42,.82);backdrop-filter:blur(14px);border:1px solid rgba(148,163,184,.16);border-radius:16px}
#hdr{position:fixed;top:16px;left:16px;right:16px;max-width:520px;padding:14px 18px;z-index:2}
#hdr h1{margin:0;font:600 22px 'Space Grotesk',Inter,sans-serif;color:#fff}#hdr p{margin:2px 0 0;color:#94a3b8;font-size:13px}
#bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);width:min(560px,calc(100% - 32px));display:flex;gap:12px;align-items:center;padding:10px 14px;z-index:2}
#play{width:42px;height:42px;border-radius:50%;border:0;background:#34d399;color:#022c22;font-size:16px;cursor:pointer;flex:none}
#seek{flex:1;accent-color:#34d399}#clock{font-size:12px;color:#94a3b8;min-width:92px;text-align:right;font-variant-numeric:tabular-nums}
#card{position:fixed;left:16px;bottom:84px;width:min(300px,calc(100% - 32px));padding:10px;z-index:2;display:none}
#card img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;display:block}#card b{display:block;margin-top:8px;color:#fff}#card span{color:#94a3b8;font-size:12px}
.stop{width:26px;height:26px;border-radius:50%;border:2px solid #fff;background:#0f172a center/cover;color:#fff;font:600 11px/22px Inter,sans-serif;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.5);cursor:pointer;padding:0;transition:opacity .4s,transform .3s}
.stop.photo{width:44px;height:44px;border-width:3px}.stop.pending{opacity:.15;transform:scale(.7)}
.head{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:2px solid #fff;box-shadow:0 0 22px var(--c)}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:5;cursor:zoom-out}#lb img{max-width:94vw;max-height:90vh;border-radius:10px}
#credit{position:fixed;right:12px;top:12px;z-index:2;font-size:11px;color:#64748b}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function start() {
  const { journey: j, images } = window.TT_DATA;
  document.head.append(el('style', {}, CSS));
  const st = journeyStats(j);
  const dates = st.start ? new Date(st.start).toLocaleDateString(undefined, { dateStyle: 'medium' }) + (st.end && new Date(st.end).toDateString() !== new Date(st.start).toDateString() ? ` – ${new Date(st.end).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : '') : '';
  const km = st.totalKm < 10 ? st.totalKm.toFixed(1) : Math.round(st.totalKm).toLocaleString();
  document.body.append(
    el('div', { id: 'map' }),
    el('header', { id: 'hdr', class: 'glass' }, `<h1>${esc(j.title)}</h1><p>${[dates, `${km} km`, `${j.stops.length} stops`].filter(Boolean).join(' · ')}</p>`),
    el('div', { id: 'bar', class: 'glass' }, '<button id="play" aria-label="Play">▶</button><input id="seek" type="range" min="0" max="1000" value="1000" aria-label="Position"><span id="clock"></span>'),
    el('div', { id: 'card', class: 'glass' }),
    el('div', { id: 'lb' }, '<img alt="">'),
    el('div', { id: 'credit' }, 'Made with Trail Track'),
  );

  const map: MlMap = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/dark', center: [0, 20], zoom: 1.5, attributionControl: { compact: true } });
  const tl = buildTimeline(j);
  const markers: Marker[] = [];
  const play = document.getElementById('play') as HTMLButtonElement;
  const seek = document.getElementById('seek') as HTMLInputElement;
  const clock = document.getElementById('clock')!;
  const card = document.getElementById('card')!;
  const lb = document.getElementById('lb')!;
  lb.onclick = () => (lb.style.display = 'none');
  let progress = 1;
  let playing = false;
  let ready = false;
  let shownCard: number | undefined;

  const headEl = el('div', { class: 'head' });
  const head = new maplibregl.Marker({ element: headEl });
  let headOn = false;

  const fit = (animate: boolean) => {
    const b = new maplibregl.LngLatBounds();
    for (const s of j.stops) b.extend([s.lng, s.lat]);
    for (const s of j.segments) for (const c of s.geometry.coordinates) b.extend(c as [number, number]);
    if (!b.isEmpty()) map.fitBounds(b, { padding: { top: 120, bottom: 120, left: 50, right: 50 }, maxZoom: 15, duration: animate ? 1500 : 0 });
  };

  map.on('load', () => {
    addTrailLayers(map);
    setData(map, 'trail', trailData(j));
    setData(map, 'stops', stopsData(j));
    setData(map, 'drawn', trailData(j));
    j.stops.forEach((s, i) => {
      const img = s.photoIds.map((id) => images[id]).find(Boolean);
      const b = el('button', { class: `stop${img ? ' photo' : ''}`, title: stopName(s, i), 'data-i': String(i) }, img ? '' : String(i + 1));
      if (img) b.style.backgroundImage = `url(${img})`;
      b.onclick = (e) => {
        e.stopPropagation();
        if (!img) return;
        (lb.firstElementChild as HTMLImageElement).src = img;
        lb.style.display = 'flex';
      };
      markers.push(new maplibregl.Marker({ element: b }).setLngLat([s.lng, s.lat]).addTo(map));
    });
    fit(false);
    ready = true;
  });

  const render = () => {
    if (!ready) return;
    if (!playing && progress >= 1) {
      setData(map, 'drawn', trailData(j));
      setData(map, 'head', { type: 'FeatureCollection', features: [] });
      markers.forEach((m) => m.getElement().classList.remove('pending'));
      if (headOn) head.remove();
      headOn = false;
      card.style.display = 'none';
      shownCard = undefined;
      clock.textContent = '';
      return;
    }
    const f = sample(tl, progress);
    setData(map, 'drawn', f.drawn);
    markers.forEach((m) => m.getElement().classList.toggle('pending', Number(m.getElement().dataset.i) > f.reachedStop));
    if (f.head) {
      headEl.style.setProperty('--c', MODE_META[f.head.mode].color);
      headEl.style.background = MODE_META[f.head.mode].color;
      headEl.textContent = MODE_META[f.head.mode].icon;
      head.setLngLat(f.head.coord);
      if (!headOn) head.addTo(map);
      headOn = true;
      if (playing) map.jumpTo({ center: f.head.coord, zoom: map.getZoom() + (Math.min(14, Math.max(3, map.getZoom())) - map.getZoom()) * 0.05 });
    }
    const t = frameTime(j, tl, f);
    clock.textContent = t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const pause = f.pauseStop != null && j.stops[f.pauseStop].photoIds.some((id) => images[id]) ? f.pauseStop : undefined;
    if (pause !== shownCard) {
      shownCard = pause;
      if (pause == null) card.style.display = 'none';
      else {
        const s = j.stops[pause];
        const img = s.photoIds.map((id) => images[id]).find(Boolean)!;
        card.innerHTML = `<img src="${img}" alt=""><b>${esc(stopName(s, pause))}</b><span>${esc([s.place?.city, s.place?.country].filter(Boolean).join(', '))}</span>${s.note ? `<p style="margin:6px 0 0;font-size:13px;color:#cbd5e1">${esc(s.note)}</p>` : ''}`;
        card.style.display = 'block';
      }
    }
  };

  play.onclick = () => {
    playing = !playing;
    if (playing && progress >= 1) progress = 0;
    play.textContent = playing ? '❚❚' : '▶';
  };
  seek.oninput = () => {
    progress = Number(seek.value) / 1000;
    render();
  };
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      progress = Math.min(1, progress + dt / Math.max(tl.total, 0.001));
      seek.value = String(Math.round(progress * 1000));
      if (progress >= 1) {
        playing = false;
        play.textContent = '▶';
        fit(true);
      }
      render();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
