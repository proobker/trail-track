import { create } from 'zustand';
import type { LineString } from 'geojson';
import { db } from './model/db';
import { uid, type Journey, type Mode, type Segment, type Stop } from './model/types';
import { routeBetween } from './routing/route';
import { reconcileSegments } from './trail/journey';

export type Tool = 'view' | 'add' | 'draw' | 'pin';

interface State {
  journeys: Journey[];
  activeId?: string;
  tool: Tool;
  /** Loose photo waiting to be pinned with the next map click. */
  pinPhotoId?: string;
  /** Points of a segment path being drawn by hand. */
  draft?: [number, number][];
  selectedStopId?: string;
  selectedSegmentId?: string;
  /** Segment ids currently being routed. */
  routing: Set<string>;
  toast?: { id: number; text: string };
  wizardOpen: boolean;
  player: { playing: boolean; progress: number; speed: number; follow: boolean };
  /** Where the animation currently is; undefined when the full trail is shown. */
  playhead?: { reachedStop: number; pauseStop?: number };
}

export const useStore = create<State>(() => ({
  journeys: [],
  tool: 'view',
  routing: new Set(),
  wizardOpen: false,
  player: { playing: false, progress: 1, speed: 1, follow: true },
}));

const set = useStore.setState;
const get = useStore.getState;

export const activeJourney = (s: State = get()) => s.journeys.find((j) => j.id === s.activeId);

export function notify(text: string) {
  set({ toast: { id: Date.now(), text } });
}

export async function loadJourneys() {
  const journeys = await db.journeys.orderBy('updatedAt').reverse().toArray();
  set({ journeys, activeId: get().activeId ?? journeys[0]?.id });
}

function save(j: Journey) {
  const next = { ...j, updatedAt: Date.now() };
  set((s) => ({ journeys: s.journeys.map((x) => (x.id === j.id ? next : x)) }));
  db.journeys.put(next).catch((e) => notify(`Could not save: ${e.message}`));
  return next;
}

export async function createJourney(j: Journey, toRoute: string[] = []) {
  await db.journeys.put(j);
  set((s) => ({ journeys: [j, ...s.journeys], activeId: j.id, selectedStopId: undefined, selectedSegmentId: undefined, player: { ...s.player, progress: 1, playing: false } }));
  if (toRoute.length) void routeSegments(j.id, toRoute);
}

export function selectJourney(id: string) {
  set((s) => ({ activeId: id, selectedStopId: undefined, selectedSegmentId: undefined, tool: 'view', player: { ...s.player, playing: false, progress: 1 } }));
}

export async function deleteJourney(id: string) {
  await db.journeys.delete(id);
  set((s) => {
    const journeys = s.journeys.filter((j) => j.id !== id);
    return { journeys, activeId: s.activeId === id ? journeys[0]?.id : s.activeId };
  });
}

export function renameJourney(id: string, title: string) {
  const j = get().journeys.find((x) => x.id === id);
  if (j) save({ ...j, title });
}

/** Replaces a journey's stops, keeps unchanged segments and routes the new ones. */
function setStops(j: Journey, stops: Stop[], moved?: Set<string>) {
  const { segments, needsRouting } = reconcileSegments(stops, j.segments, moved);
  save({ ...j, stops, segments });
  if (needsRouting.length) void routeSegments(j.id, needsRouting);
}

export async function routeSegments(journeyId: string, segmentIds: string[]) {
  set((s) => ({ routing: new Set([...s.routing, ...segmentIds]) }));
  for (const segId of segmentIds) {
    const j = get().journeys.find((x) => x.id === journeyId);
    const seg = j?.segments.find((s) => s.id === segId);
    if (!j || !seg) continue;
    const from = j.stops.find((s) => s.id === seg.fromStopId)!;
    const to = j.stops.find((s) => s.id === seg.toStopId)!;
    const result = await routeBetween(from, to, seg.mode);
    // The journey may have changed while we waited; only patch if the segment is still there unchanged.
    const now = get().journeys.find((x) => x.id === journeyId);
    const cur = now?.segments.find((s) => s.id === segId);
    if (now && cur && cur.mode === seg.mode) {
      save({ ...now, segments: now.segments.map((s) => (s.id === segId ? { ...s, ...result } : s)) });
    }
    set((s) => {
      const routing = new Set(s.routing);
      routing.delete(segId);
      return { routing };
    });
  }
}

export function addStop(lng: number, lat: number, label?: string) {
  const j = activeJourney();
  if (!j) return;
  const stop: Stop = { id: uid(), lng, lat, label, photoIds: [], origin: 'manual' };
  const sel = get().selectedStopId;
  const at = sel ? j.stops.findIndex((s) => s.id === sel) + 1 : j.stops.length;
  const stops = [...j.stops.slice(0, at), stop, ...j.stops.slice(at)];
  setStops(j, stops);
  set({ selectedStopId: stop.id });
}

export function moveStop(id: string, lng: number, lat: number) {
  const j = activeJourney();
  if (!j) return;
  setStops(j, j.stops.map((s) => (s.id === id ? { ...s, lng, lat } : s)), new Set([id]));
}

export function updateStop(id: string, patch: Partial<Pick<Stop, 'label' | 'arrivedAt' | 'photoIds'>>) {
  const j = activeJourney();
  if (!j) return;
  save({ ...j, stops: j.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

export function deleteStop(id: string) {
  const j = activeJourney();
  if (!j) return;
  setStops(j, j.stops.filter((s) => s.id !== id));
  if (get().selectedStopId === id) set({ selectedStopId: undefined });
}

export function reorderStop(from: number, to: number) {
  const j = activeJourney();
  if (!j || from === to) return;
  const stops = [...j.stops];
  const [s] = stops.splice(from, 1);
  stops.splice(to, 0, s);
  setStops(j, stops);
}

export function setSegmentMode(segId: string, mode: Mode) {
  const j = activeJourney();
  if (!j) return;
  save({ ...j, segments: j.segments.map((s) => (s.id === segId ? { ...s, mode } : s)) });
  void routeSegments(j.id, [segId]);
}

/** Changes a segment's mode without re-routing (keeps imported / hand-drawn paths). */
export function relabelSegment(segId: string, mode: Mode) {
  const j = activeJourney();
  if (!j) return;
  save({ ...j, segments: j.segments.map((s) => (s.id === segId ? { ...s, mode } : s)) });
}

export function setSegmentGeometry(segId: string, geometry: LineString) {
  const j = activeJourney();
  if (!j) return;
  save({ ...j, segments: j.segments.map((s): Segment => (s.id === segId ? { ...s, geometry, routing: 'manual' } : s)) });
}

/** Turns a loose photo into a new stop at the clicked position, inserted in time order. */
export function pinPhoto(photoId: string, takenAt: number, lng: number, lat: number) {
  const j = activeJourney();
  if (!j) return;
  const stop: Stop = { id: uid(), lng, lat, arrivedAt: takenAt, photoIds: [photoId], origin: 'manual' };
  let at = j.stops.findIndex((s) => s.arrivedAt != null && s.arrivedAt > takenAt);
  if (at < 0) at = j.stops.length;
  const stops = [...j.stops.slice(0, at), stop, ...j.stops.slice(at)];
  const loose = (j.loosePhotoIds ?? []).filter((id) => id !== photoId);
  setStops({ ...j, loosePhotoIds: loose }, stops);
  set({ selectedStopId: stop.id, tool: 'view', pinPhotoId: undefined });
}

export function attachLoose(photoId: string, stopId: string) {
  const j = activeJourney();
  if (!j) return;
  save({
    ...j,
    loosePhotoIds: (j.loosePhotoIds ?? []).filter((id) => id !== photoId),
    stops: j.stops.map((s) => (s.id === stopId ? { ...s, photoIds: [...s.photoIds, photoId] } : s)),
  });
}

/** Adds photos to the active journey: located ones join or create stops, the rest become loose. */
export function addPhotosToJourney(stopsToAdd: Stop[], looseIds: string[]) {
  const j = activeJourney();
  if (!j) return;
  const merged = [...j.stops, ...stopsToAdd];
  // Keep chronological order when every stop has a time; otherwise append.
  if (merged.every((s) => s.arrivedAt != null)) merged.sort((a, b) => a.arrivedAt! - b.arrivedAt!);
  setStops({ ...j, loosePhotoIds: [...(j.loosePhotoIds ?? []), ...looseIds] }, merged);
}

export function setTool(tool: Tool, pinPhotoId?: string) {
  set({ tool, pinPhotoId, draft: tool === 'draw' ? [] : undefined });
}

export function addDraftPoint(lng: number, lat: number) {
  set((s) => ({ draft: [...(s.draft ?? []), [lng, lat]] }));
}

/** Replaces the selected segment's path with the hand-drawn points between its two stops. */
export function finishDraft() {
  const { draft, selectedSegmentId } = get();
  const j = activeJourney();
  const seg = j?.segments.find((s) => s.id === selectedSegmentId);
  if (j && seg && draft?.length) {
    const a = j.stops.find((s) => s.id === seg.fromStopId)!;
    const b = j.stops.find((s) => s.id === seg.toStopId)!;
    setSegmentGeometry(seg.id, { type: 'LineString', coordinates: [[a.lng, a.lat], ...draft, [b.lng, b.lat]] });
  }
  set({ tool: 'view', draft: undefined });
}

export function setPlayer(patch: Partial<State['player']>) {
  set((s) => ({ player: { ...s.player, ...patch } }));
}
