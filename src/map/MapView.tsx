import { LngLatBounds, Map as MlMap, Marker, NavigationControl, ScaleControl, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef } from 'react';
import type { FeatureCollection } from 'geojson';
import { buildTimeline, sample, type Timeline } from '../animate/timeline';
import { getPhoto, thumbUrl, useJourneyPhotos } from '../model/photos';
import type { Journey, Photo } from '../model/types';
import { activeJourney, addDraftPoint, addStop, moveStop, notify, pinPhoto, setPlayer, setTool, useStore } from '../store';
import { placeUnlocated } from '../trail/placeUnlocated';
import { addTrailLayers, FLOW_STEPS, setData, stopsData, trailData } from './layers';
import { usePrefs } from './prefs';
import { BASE_STYLES, DEM_SOURCE } from './styles';

// Vite pre-bundles maplibre into another folder, so its own worker lookup misses; point it at the real file.
setWorkerUrl(workerUrl);

export const mapRef: { current?: MlMap } = {};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function fitJourney(map: MlMap, j: Journey, animate = true) {
  const pts = [...j.stops.map((s) => [s.lng, s.lat]), ...j.segments.flatMap((s) => s.geometry.coordinates)];
  if (!pts.length) return;
  const b = new LngLatBounds();
  for (const p of pts) b.extend(p as [number, number]);
  map.fitBounds(b, { padding: { top: 80, bottom: 140, left: 60, right: 60 }, maxZoom: 15, duration: animate ? 1600 : 0 });
}

function applyTerrain(map: MlMap) {
  const { terrain, globe } = usePrefs.getState();
  map.setProjection({ type: globe ? 'globe' : 'mercator' });
  if (terrain) {
    if (!map.getSource('dem')) map.addSource('dem', DEM_SOURCE);
    map.setTerrain({ source: 'dem', exaggeration: 1.4 });
    map.setSky({ 'sky-color': '#0b1a3a', 'horizon-color': '#3b6ea8', 'fog-color': '#0b1020', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 });
    if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 800 });
  } else {
    map.setTerrain(null);
  }
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const journey = useStore(activeJourney);
  const selectedStopId = useStore((s) => s.selectedStopId);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const tool = useStore((s) => s.tool);
  const draft = useStore((s) => s.draft);
  const photos = useJourneyPhotos(journey);
  const prefs = usePrefs();
  const ready = useRef(false);
  const markers = useRef<Marker[]>([]);

  // Create the map once.
  useEffect(() => {
    const map = new MlMap({
      container: container.current!,
      style: BASE_STYLES[usePrefs.getState().base].style,
      center: [10, 25],
      zoom: 1.6,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new ScaleControl({}), 'bottom-left');
    map.on('style.load', () => {
      addTrailLayers(map);
      applyTerrain(map);
      ready.current = true;
      redraw(map, true);
    });

    map.on('click', (e: MapMouseEvent) => {
      const s = useStore.getState();
      const { lng, lat } = e.lngLat;
      if (!activeJourney(s)) return;
      if (s.tool === 'add') return addStop(lng, lat);
      if (s.tool === 'draw') return addDraftPoint(lng, lat);
      if (s.tool === 'pin' && s.pinPhotoId) {
        const p = getPhoto(s.pinPhotoId);
        return pinPhoto(s.pinPhotoId, p?.takenAt ?? Date.now(), lng, lat);
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: ['trail-hit'] })[0];
      useStore.setState({ selectedSegmentId: hit?.properties?.id, selectedStopId: undefined });
    });
    map.on('mouseenter', 'trail-hit', () => {
      if (useStore.getState().tool === 'view') map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'trail-hit', () => {
      if (useStore.getState().tool === 'view') map.getCanvas().style.cursor = '';
    });

    // Animation loop: drives playback, the camera and the flowing dashes.
    let raf = 0;
    let last = performance.now();
    let flowAt = 0;
    let flowStep = 0;
    let shown: { j?: Journey; progress: number; reached?: number } = { progress: -1 };
    let timeline: { j?: Journey; tl?: Timeline } = {};
    const zoomCache = new Map<string, number>();
    const tlFor = (j: Journey) => {
      if (timeline.j !== j) timeline = { j, tl: buildTimeline(j) };
      return timeline.tl!;
    };

    function redraw(m: MlMap, force = false) {
      const s = useStore.getState();
      const j = activeJourney(s);
      if (!ready.current) return;
      const { progress, playing, follow } = s.player;
      if (!force && shown.j === j && shown.progress === progress) return;
      setData(m, 'trail', trailData(j));
      setData(m, 'stops', stopsData(j));
      if (!j || (!playing && progress >= 1)) {
        setData(m, 'drawn', trailData(j));
        setData(m, 'head', EMPTY);
        m.setPaintProperty('trail-ghost', 'line-opacity', 0.22);
        if (shown.reached !== undefined) useStore.setState({ playhead: undefined });
        shown = { j, progress };
        markReached(Infinity);
        return;
      }
      const tl = tlFor(j);
      const f = sample(tl, progress);
      setData(m, 'drawn', f.drawn);
      setData(m, 'head', f.head ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { mode: f.head.mode }, geometry: { type: 'Point', coordinates: f.head.coord } }] } : EMPTY);
      if (shown.reached !== f.reachedStop || s.playhead?.pauseStop !== f.pauseStop) {
        useStore.setState({ playhead: { reachedStop: f.reachedStop, pauseStop: f.pauseStop } });
        markReached(f.reachedStop);
      }
      if (playing && follow && f.head) {
        const tr = tl.tracks[f.head.track];
        let z = zoomCache.get(tr.segmentId);
        if (z === undefined) {
          const b = new LngLatBounds();
          for (const c of tr.coords) b.extend(c);
          z = Math.min(15, Math.max(2, (m.cameraForBounds(b, { padding: 120 })?.zoom ?? 10) + 0.4));
          zoomCache.set(tr.segmentId, z);
        }
        const curB = m.getBearing();
        let dB = ((f.head.bearing - curB + 540) % 360) - 180;
        if (tr.mode === 'flight') dB = -curB;
        m.jumpTo({ center: f.head.coord, zoom: m.getZoom() + (z - m.getZoom()) * 0.05, bearing: curB + dB * 0.025, pitch: usePrefs.getState().terrain ? 62 : 48 });
      }
      shown = { j, progress, reached: f.reachedStop };
    }

    function markReached(reached: number) {
      markers.current.forEach((mk) => {
        const i = Number(mk.getElement().dataset.index);
        mk.getElement().classList.toggle('pending', Number.isFinite(i) && i > reached);
      });
    }

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      const j = activeJourney(s);
      if (j && s.player.playing) {
        const tl = tlFor(j);
        const progress = Math.min(1, s.player.progress + (dt * s.player.speed) / Math.max(tl.total, 0.001));
        setPlayer({ progress, playing: progress < 1 });
      }
      redraw(map);
      if (ready.current && now - flowAt > 70 && !s.player.playing) {
        flowAt = now;
        flowStep = (flowStep + 1) % FLOW_STEPS.length;
        map.setPaintProperty('trail-flow', 'line-dasharray', FLOW_STEPS[flowStep]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    (map as MlMap & { _ttRedraw?: () => void })._ttRedraw = () => redraw(map, true);

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = undefined;
      ready.current = false;
    };
  }, []);

  // Base style, projection and terrain.
  const firstStyle = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    ready.current = false;
    map.setStyle(BASE_STYLES[prefs.base].style);
  }, [prefs.base]);
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready.current) applyTerrain(map);
  }, [prefs.terrain, prefs.globe]);

  // Re-render trail data whenever the journey or selection changes.
  useEffect(() => {
    const map = mapRef.current as (MlMap & { _ttRedraw?: () => void }) | undefined;
    if (!map || !ready.current) return;
    map._ttRedraw?.();
    map.setFilter('trail-selected', ['==', ['get', 'id'], selectedSegmentId ?? '']);
  }, [journey, selectedSegmentId]);

  // Draft line for the draw tool.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const j = journey;
    const seg = j?.segments.find((s) => s.id === selectedSegmentId);
    const from = seg && j?.stops.find((s) => s.id === seg.fromStopId);
    const to = seg && j?.stops.find((s) => s.id === seg.toStopId);
    const coords = draft && from && to ? [[from.lng, from.lat], ...draft, [to.lng, to.lat]] : [];
    setData(map, 'draft', coords.length ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] } : EMPTY);
  }, [draft, journey, selectedSegmentId]);

  // Fit the view when switching journeys.
  const fittedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !journey || fittedFor.current === journey.id || !journey.stops.length) return;
    fittedFor.current = journey.id;
    fitJourney(map, journey);
  }, [journey]);

  // Cursor for editing tools.
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = tool === 'view' ? '' : 'crosshair';
  }, [tool]);

  // HTML markers for stops (photo bubbles) and loose photos.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    if (!journey) return;
    const editable = tool === 'add';
    journey.stops.forEach((stop, i) => {
      const el = document.createElement('button');
      el.className = 'stop-marker';
      el.dataset.index = String(i);
      const cover = stop.photoIds.map((id) => photos.get(id)).find((p) => p?.thumbBlob);
      const url = thumbUrl(cover);
      if (url) {
        el.classList.add('has-photo');
        el.style.backgroundImage = `url(${url})`;
        if (stop.photoIds.length > 1) el.dataset.count = String(stop.photoIds.length);
      } else {
        el.textContent = String(i + 1);
      }
      if (stop.id === selectedStopId) el.classList.add('selected');
      el.title = stop.label ?? `Stop ${i + 1}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        useStore.setState({ selectedStopId: stop.id, selectedSegmentId: undefined });
      });
      const mk = new Marker({ element: el, draggable: editable }).setLngLat([stop.lng, stop.lat]).addTo(map);
      mk.on('dragend', () => {
        const p = mk.getLngLat();
        moveStop(stop.id, p.lng, p.lat);
      });
      markers.current.push(mk);
    });

    const loose = (journey.loosePhotoIds ?? []).map((id) => photos.get(id)).filter((p): p is Photo => !!p);
    for (const pl of placeUnlocated(loose, journey.stops)) {
      const p = photos.get(pl.photoId);
      const el = document.createElement('button');
      el.className = 'loose-marker';
      const url = thumbUrl(p);
      if (url) el.style.backgroundImage = `url(${url})`;
      el.title = 'Placed by time — click to pin it exactly';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setTool('pin', pl.photoId);
        notify('Click the map where this photo was taken');
      });
      markers.current.push(new Marker({ element: el }).setLngLat([pl.lng, pl.lat]).addTo(map));
    }
  }, [journey, photos, selectedStopId, tool]);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
