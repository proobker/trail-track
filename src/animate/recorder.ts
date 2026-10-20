import type { Map as MlMap } from 'maplibre-gl';
import { fitJourney, mapRef } from '../map/MapView';
import { getPhoto, previewUrl, thumbUrl } from '../model/photos';
import { MODE_META, stopName, type Journey } from '../model/types';
import { setPlayer, useStore } from '../store';
import { journeyStats } from '../trail/journey';
import { buildTimeline, frameTime, sample } from './timeline';

export type Aspect = '16:9' | '9:16';

const SIZE: Record<Aspect, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920] };
const TITLE_MS = 2200;
const END_MS = 2600;

const loadImage = (url?: string) =>
  new Promise<HTMLImageElement | undefined>((resolve) => {
    if (!url) return resolve(undefined);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = url;
  });

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

const fmtKm = (km: number) => (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString());

/**
 * Records the journey animation to a video. Each frame composites the map canvas with the
 * overlays that live in HTML on screen (photo bubbles, head icon, photo card), plus a title
 * card at the start and a stats card at the end.
 */
export async function recordJourney(j: Journey, aspect: Aspect, signal: AbortSignal, onPhase: (p: string) => void): Promise<Blob | undefined> {
  const map = mapRef.current;
  if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser');
  if (!map) throw new Error('The map is not ready yet. Try again in a moment.');
  const [W, H] = SIZE[aspect];

  // Resize the map to the output aspect, fitted inside the window.
  const wrap = map.getContainer().parentElement!;
  const scale = Math.min((window.innerWidth - 48) / W, (window.innerHeight - 140) / H);
  wrap.classList.add('recording');
  wrap.style.width = `${Math.round(W * scale)}px`;
  wrap.style.height = `${Math.round(H * scale)}px`;
  map.resize();
  fitJourney(map, j, false);

  // Preload images for bubbles and cards.
  const thumbs = new Map<string, HTMLImageElement | undefined>();
  const previews = new Map<string, HTMLImageElement | undefined>();
  await Promise.all(
    j.stops.flatMap((s) =>
      s.photoIds.slice(0, 4).map(async (id, k) => {
        const p = getPhoto(id);
        if (k === 0) thumbs.set(s.id, await loadImage(thumbUrl(p)));
        previews.set(id, await loadImage(previewUrl(p)));
      }),
    ),
  );

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  const mimeType = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

  const tl = buildTimeline(j);
  const st = journeyStats(j);
  const countries = new Set(j.stops.map((s) => s.place?.country).filter(Boolean)).size;
  const dates = st.start ? `${new Date(st.start).toLocaleDateString(undefined, { dateStyle: 'medium' })}${st.end && new Date(st.end).toDateString() !== new Date(st.start).toDateString() ? ` – ${new Date(st.end).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ''}` : '';
  // Unit scale: both presets have a 1080 px short side.
  const k = Math.min(W, H) / 1080;

  const drawMap = (m: MlMap) => {
    const src = m.getCanvas();
    ctx.drawImage(src, 0, 0, W, H);
  };

  const drawBubbles = (m: MlMap, reached: number) => {
    const sx = W / m.getContainer().clientWidth;
    const sy = H / m.getContainer().clientHeight;
    j.stops.forEach((s, i) => {
      if (i > reached) return;
      const p = m.project([s.lng, s.lat]);
      const img = thumbs.get(s.id);
      const r = (img ? 30 : 13) * k;
      const x = p.x * sx;
      const y = p.y * sy;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 14 * k;
      ctx.beginPath();
      ctx.arc(x, y, r + 4 * k, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      if (img) cover(ctx, img, x - r, y - r, r * 2, r * 2);
      else {
        ctx.fillStyle = '#0f172a';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `600 ${14 * k}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y + 1);
      }
      ctx.restore();
    });
  };

  const drawHead = (m: MlMap, coord: [number, number], mode: keyof typeof MODE_META) => {
    const p = m.project(coord);
    const x = p.x * (W / m.getContainer().clientWidth);
    const y = p.y * (H / m.getContainer().clientHeight);
    const r = 24 * k;
    ctx.save();
    ctx.shadowColor = MODE_META[mode].color;
    ctx.shadowBlur = 30 * k;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = MODE_META[mode].color;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 3 * k;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.font = `${22 * k}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(MODE_META[mode].icon, x, y + 1);
  };

  const drawCard = (stopIndex: number, time?: number) => {
    const s = j.stops[stopIndex];
    const ids = s.photoIds.filter((id) => previews.get(id)).slice(0, 2);
    // Landscape: a card in the corner. Portrait: full width along the bottom.
    const cw = aspect === '16:9' ? 600 * k : W - 80 * k;
    const imgH = ids.length ? cw * 0.62 : 0;
    const ch = imgH + 110 * k;
    const x = 40 * k;
    const y = H - ch - 40 * k;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 40 * k;
    roundRect(ctx, x, y, cw, ch, 22 * k);
    ctx.fillStyle = 'rgba(15,23,42,.92)';
    ctx.fill();
    ctx.restore();
    const pad = 14 * k;
    ids.forEach((id, n) => {
      const w = (cw - pad * 2 - (ids.length - 1) * 8 * k) / ids.length;
      ctx.save();
      roundRect(ctx, x + pad + n * (w + 8 * k), y + pad, w, imgH - pad, 14 * k);
      ctx.clip();
      cover(ctx, previews.get(id)!, x + pad + n * (w + 8 * k), y + pad, w, imgH - pad);
      ctx.restore();
    });
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${30 * k}px "Space Grotesk", Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(stopName(s, stopIndex), x + 24 * k, y + imgH + 46 * k, cw - 48 * k);
    ctx.fillStyle = '#94a3b8';
    ctx.font = `${20 * k}px Inter, sans-serif`;
    const sub = [time ? new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '', [s.place?.city, s.place?.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    ctx.fillText(sub, x + 24 * k, y + imgH + 80 * k, cw - 48 * k);
  };

  const drawSlate = (alpha: number, title: string, lines: string[]) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(11,16,32,.55)');
    g.addColorStop(1, 'rgba(11,16,32,.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#34d399';
    ctx.font = `600 ${22 * k}px Inter, sans-serif`;
    ctx.fillText('TRAIL TRACK', W / 2, H / 2 - 90 * k);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${78 * k}px "Space Grotesk", Inter, sans-serif`;
    ctx.fillText(title, W / 2, H / 2, W - 120 * k);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `${30 * k}px Inter, sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (64 + i * 44) * k, W - 120 * k));
    ctx.restore();
  };

  let phase: 'title' | 'play' | 'end' = 'title';
  let phaseAt = performance.now();
  let raf = 0;
  const done = new Promise<void>((resolve) => {
    const frame = (now: number) => {
      if (signal.aborted) return resolve();
      const s = useStore.getState();
      drawMap(map);
      if (phase === 'title') {
        drawSlate(1, j.title, [dates, `${fmtKm(st.totalKm)} km · ${j.stops.length} stops`].filter(Boolean));
        if (now - phaseAt > TITLE_MS) {
          phase = 'play';
          setPlayer({ playing: true, progress: 0, follow: true });
        }
      } else if (phase === 'play') {
        const f = sample(tl, s.player.progress);
        drawBubbles(map, f.reachedStop);
        if (f.head) drawHead(map, f.head.coord, f.head.mode);
        if (f.pauseStop != null && j.stops[f.pauseStop].photoIds.length) drawCard(f.pauseStop, frameTime(j, tl, f));
        if (!s.player.playing && s.player.progress >= 1) {
          phase = 'end';
          phaseAt = now;
          fitJourney(map, j, true);
        }
      } else {
        drawBubbles(map, Infinity);
        const a = Math.min(1, (now - phaseAt) / 600);
        drawSlate(a, j.title, [`${fmtKm(st.totalKm)} km · ${j.stops.length} stops · ${st.photoCount} photos`, countries ? `${countries} ${countries === 1 ? 'country' : 'countries'}` : ''].filter(Boolean));
        if (now - phaseAt > END_MS) return resolve();
      }
      onPhase(phase);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });

  setPlayer({ playing: false, progress: 0, follow: true });
  rec.start(250);
  await done;
  cancelAnimationFrame(raf);
  rec.stop();
  await stopped;
  setPlayer({ playing: false, progress: 1 });
  wrap.classList.remove('recording');
  wrap.style.width = '';
  wrap.style.height = '';
  map.resize();
  if (signal.aborted) return undefined;
  return new Blob(chunks, { type: rec.mimeType });
}
