import { LngLatBounds, Map as MlMap, Marker, NavigationControl, ScaleControl, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef } from 'react';
import type { FeatureCollection } from 'geojson';
import { buildTimeline, frameTime, sample, type Timeline } from '../animate/timeline';
import { getPhoto, thumbUrl, useJourneyPhotos } from '../model/photos';
import { MODE_META, stopName, trustedTime, type Journey, type Mode, type Photo } from '../model/types';
import { activeJourney, addDraftPoint, addStop, moveStop, notify, openLightbox, pinPhoto, selectJourney, setPlayer, setTool, useStore } from '../store';
import { placeUnlocated } from '../trail/placeUnlocated';
import { modeSvg } from '../ui/icons';
import { addTrailLayers, FLOW_STEPS, setData, stopsData, trailData, worldData } from './layers';
import { usePrefs } from './prefs';
import { BASE_STYLES, DEM_SOURCE } from './styles';

// Vite pre-bundles maplibre into another folder, so its own worker lookup misses; point it at the real file.
setWorkerUrl(workerUrl);

export const mapRef: { current?: MlMap } = {};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

function fitCoords(map: MlMap, pts: number[][], animate = true, topDown = false) {
  if (!pts.length) return;
  const b = new LngLatBounds();
  for (const p of pts) b.extend(p as [number, number]);
  const h = map.getContainer().clientHeight;
  // On phones the bottom sheet covers the lower part of the map.
  const bottom = isMobile() ? Math.round(h * 0.42) : 120;
  map.fitBounds(b, { padding: { top: 90, bottom, left: 50, right: 50 }, maxZoom: 15, duration: animate ? 1600 : 0, ...(topDown ? { pitch: 0, bearing: 0 } : {}) });
}

export function fitJourney(map: MlMap, j: Journey, animate = true) {
  fitCoords(map, [...j.stops.map((s) => [s.lng, s.lat]), ...j.segments.flatMap((s) => s.geometry.coordinates)], animate);
}

/** Marks a point on the map (used by the elevation chart's hover). */
export function setHoverPoint(coord?: [number, number]) {
  const map = mapRef.current;
  if (map) setData(map, 'hover', coord ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coord } }] } : EMPTY);
}

function drawTrailPreview(map: MlMap) {
  const { view, trailPreview } = useStore.getState();
  setData(map, 'trail-candidate', view === 'journey' && trailPreview ? {
    type: 'FeatureCollection',
    features: trailPreview.lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
  } : EMPTY);
}

function applyTerrain(map: MlMap) {
  const { terrain, globe } = usePrefs.getState();
  map.setProjection({ type: globe ? 'globe' : 'mercator' });
  if (terrain) {
    if (!map.getSource('dem')) map.addSource('dem', DEM_SOURCE);
    map.setTerrain({ source: 'dem', exaggeration: 1.4 });
    // Fog isn't supported on the globe projection, so only set it in flat mode.
    map.setSky({ 'sky-color': '#0b1a3a', 'horizon-color': '#3b6ea8', 'sky-horizon-blend': 0.6, ...(globe ? {} : { 'fog-color': '#0b1020', 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 }) });
    if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 800 });
  } else {
    map.setTerrain(null);
  }
}

/** HTML marker that rides the head of the animated trail, showing the current mode. */
function createHead() {
  const el = document.createElement('div');
  el.className = 'head-marker';
  el.setAttribute('aria-hidden', 'true');
  let mode: Mode | undefined;
  const marker = new Marker({ element: el, rotationAlignment: 'map' });
  return {
    marker,
    update(map: MlMap, coord: [number, number] | undefined, m?: Mode, bearing = 0) {
      if (!coord || !m) {
        marker.remove();
        mode = undefined;
        return;
      }
      // A marker needs a position before it can be added to the map.
      marker.setLngLat(coord);
      // Only the plane points along its heading; the other icons would end up upside down.
      marker.setRotation(m === 'flight' ? bearing - 45 : 0);
      if (m !== mode) {
        mode = m;
        el.style.setProperty('--mode', MODE_META[m].color);
        el.innerHTML = modeSvg(m, 18, '#fff');
        marker.addTo(map);
      }
    },
  };
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const journey = useStore(activeJourney);
  const view = useStore((s) => s.view);
  const journeys = useStore((s) => s.journeys);
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
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({}), 'bottom-left');
    map.on('style.load', () => {
      addTrailLayers(map);
      applyTerrain(map);
      ready.current = true;
      redraw(map, true);
      drawTrailPreview(map);
    });

    map.on('click', (e: MapMouseEvent) => {
      const s = useStore.getState();
      if (s.view === 'world') {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['world-hit'] })[0];
        if (hit?.properties?.journeyId) selectJourney(hit.properties.journeyId);
        return;
      }
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
    for (const layer of ['trail-hit', 'world-hit']) {
      map.on('mousemove', layer, (e) => {
        if (useStore.getState().tool !== 'view') return;
        map.getCanvas().style.cursor = 'pointer';
        if (layer === 'world-hit') map.setFilter('world-highlight', ['==', ['get', 'journeyId'], e.features?.[0]?.properties?.journeyId ?? '']);
      });
      map.on('mouseleave', layer, () => {
        if (useStore.getState().tool !== 'view') return;
        map.getCanvas().style.cursor = '';
        if (layer === 'world-hit') map.setFilter('world-highlight', ['==', ['get', 'journeyId'], '']);
      });
    }

    // Animation loop: drives playback, the camera and the flowing dashes.
    const head = createHead();
    let raf = 0;
    let last = performance.now();
    let flowAt = 0;
    let flowStep = 0;
    let shown: { j?: Journey; progress: number; reached?: number; world?: Journey[] } = { progress: -1 };
    let timeline: { j?: Journey; tl?: Timeline } = {};
    const zoomCache = new Map<string, number>();
    const tlFor = (j: Journey) => {
      if (timeline.j !== j) timeline = { j, tl: buildTimeline(j) };
      return timeline.tl!;
    };

    function redraw(m: MlMap, force = false) {
      if (!ready.current) return;
      const s = useStore.getState();
      if (s.view === 'world') {
        if (!force && shown.world === s.journeys) return;
        const w = worldData(s.journeys);
        setData(m, 'world', w.lines);
        setData(m, 'world-points', w.points);
        for (const id of ['trail', 'drawn', 'stops']) setData(m, id, EMPTY);
        setData(m, 'head', EMPTY);
        head.update(m, undefined);
        shown = { progress: -1, world: s.journeys };
        return;
      }
      const j = activeJourney(s);
      const { progress, playing, follow } = s.player;
      if (!force && shown.j === j && shown.progress === progress && !shown.world) return;
      if (shown.world) {
        setData(m, 'world', EMPTY);
        setData(m, 'world-points', EMPTY);
      }
      // These sources are static during playback; only the drawn line and head change each frame.
      if (force || shown.j !== j || shown.world) {
        setData(m, 'trail', trailData(j));
        setData(m, 'stops', stopsData(j));
      }
      if (!j || (!playing && progress >= 1)) {
        setData(m, 'drawn', trailData(j));
        setData(m, 'head', EMPTY);
        head.update(m, undefined);
        if (shown.reached !== undefined) useStore.setState({ playhead: undefined });
        shown = { j, progress };
        markReached(Infinity);
        return;
      }
      const tl = tlFor(j);
      const f = sample(tl, progress);
      setData(m, 'drawn', f.drawn);
      setData(m, 'head', f.head ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { mode: f.head.mode }, geometry: { type: 'Point', coordinates: f.head.coord } }] } : EMPTY);
      head.update(m, f.head?.coord, f.head?.mode, f.head?.bearing);
      const time = frameTime(j, tl, f);
      const ph = s.playhead;
      // Update the store sparingly: only when something the UI shows has changed.
      if (!ph || ph.reachedStop !== f.reachedStop || ph.pauseStop !== f.pauseStop || ph.mode !== f.head?.mode || Math.abs((ph.time ?? 0) - (time ?? 0)) > 60_000) {
        useStore.setState({ playhead: { reachedStop: f.reachedStop, pauseStop: f.pauseStop, time, mode: f.head?.mode } });
      }
      if (shown.reached !== f.reachedStop) markReached(f.reachedStop);
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
      // Schedule first, so an error in one frame can't stop the loop for good.
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      const j = activeJourney(s);
      if (j && s.player.playing && s.view === 'journey') {
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

  const trailPreview = useStore((s) => s.trailPreview);
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready.current) drawTrailPreview(map);
  }, [trailPreview, view]);

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

  // Re-render trail data whenever the journey, view or selection changes.
  useEffect(() => {
    const map = mapRef.current as (MlMap & { _ttRedraw?: () => void }) | undefined;
    if (!map || !ready.current) return;
    map._ttRedraw?.();
    map.setFilter('trail-selected', ['==', ['get', 'id'], selectedSegmentId ?? '']);
  }, [journey, journeys, view, selectedSegmentId]);

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

  // Fit the view when switching journeys or entering the world view.
  const fittedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (view === 'world') {
      if (fittedFor.current === 'world') return;
      fittedFor.current = 'world';
      fitCoords(map, journeys.flatMap((j) => j.stops.map((s) => [s.lng, s.lat])), true, true);
      return;
    }
    if (!journey || fittedFor.current === journey.id || !journey.stops.length) return;
    fittedFor.current = journey.id;
    fitJourney(map, journey);
  }, [journey, journeys, view]);

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
    if (!journey || view === 'world') return;
    const editable = tool === 'add';
    journey.stops.forEach((stop, i) => {
      const el = document.createElement('button');
      el.className = 'stop-marker';
      el.dataset.index = String(i);
      const cover = stop.photoIds.map((id) => photos.get(id)).find((p) => p?.thumbBlob || p?.previewBlob);
      const url = thumbUrl(cover);
      if (url) {
        el.classList.add('has-photo');
        el.style.backgroundImage = `url(${url})`;
        if (stop.photoIds.length > 1) el.dataset.count = String(stop.photoIds.length);
      } else {
        el.textContent = String(i + 1);
      }
      if (stop.id === selectedStopId) el.classList.add('selected');
      el.title = stopName(stop, i);
      el.setAttribute('aria-label', stopName(stop, i));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = useStore.getState();
        // A second click on a selected photo stop opens its photos.
        if (s.selectedStopId === stop.id && stop.photoIds.length && s.tool === 'view') openLightbox(stop.photoIds);
        else useStore.setState({ selectedStopId: stop.id, selectedSegmentId: undefined });
      });
      const mk = new Marker({ element: el, draggable: editable }).setLngLat([stop.lng, stop.lat]).addTo(map);
      mk.on('dragend', () => {
        const p = mk.getLngLat();
        moveStop(stop.id, p.lng, p.lat);
      });
      markers.current.push(mk);
    });

    const loose = (journey.loosePhotoIds ?? []).map((id) => photos.get(id)).filter((p): p is Photo => !!p);
    // A file date (e.g. a shared copy's download time) says nothing about where the photo belongs.
    // Photos saved before time sources were recorded keep their old approximate marker.
    for (const pl of placeUnlocated(loose.filter((p) => p.timeSource == null || trustedTime(p)), journey)) {
      const p = photos.get(pl.photoId);
      const el = document.createElement('button');
      el.className = 'loose-marker';
      const url = thumbUrl(p);
      if (url) el.style.backgroundImage = `url(${url})`;
      el.title = `Approximate ${pl.method === 'route' ? 'route' : pl.method === 'stop' ? 'stop' : 'straight-line'} placement by time — click to pin it exactly`;
      el.setAttribute('aria-label', el.title);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setTool('pin', pl.photoId);
        notify('Click the map where this photo was taken');
      });
      markers.current.push(new Marker({ element: el }).setLngLat([pl.lng, pl.lat]).addTo(map));
    }
  }, [journey, photos, selectedStopId, tool, view]);

  return (
    <div className="map-wrap absolute inset-0">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
