import { create } from 'zustand';
import type { LineString } from 'geojson';
import { reverseGeocode } from './geo/reverse';
import { db } from './model/db';
import { History } from './model/history';
import { journeyPhotos, savePhotos } from './model/photos';
import { uid, type Journey, type Mode, type Photo, type Segment, type Stop } from './model/types';
import { routeBetween } from './routing/route';
import { clusterPhotos } from './trail/cluster';
import { mergeWithNext, splitStop as splitStopPure } from './trail/edit';
import { reconcileSegments } from './trail/journey';
import { splitJourney } from './trail/trips';

export type Tool = 'view' | 'add' | 'draw' | 'pin';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface DialogRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface State {
  journeys: Journey[];
  activeId?: string;
  /** 'world' shows every journey on one map. */
  view: 'journey' | 'world';
  tool: Tool;
  /** Loose photo waiting to be pinned with the next map click. */
  pinPhotoId?: string;
  /** Points of a segment path being drawn by hand. */
  draft?: [number, number][];
  selectedStopId?: string;
  selectedSegmentId?: string;
  /** Segment ids currently being routed. */
  routing: Set<string>;
  toast?: { id: number; text: string; action?: ToastAction };
  dialog?: DialogRequest;
  lightbox?: { photoIds: string[]; index: number };
  wizardOpen: boolean;
  shortcutsOpen: boolean;
  /** Phone layout: the journeys drawer. */
  drawerOpen: boolean;
  player: { playing: boolean; progress: number; speed: number; follow: boolean };
  /** Where the animation currently is; undefined when the full trail is shown. */
  playhead?: { reachedStop: number; pauseStop?: number; time?: number; mode?: Mode };
  /** Bumped whenever undo history changes, so buttons re-render. */
  historyVersion: number;
}

export const useStore = create<State>(() => ({
  journeys: [],
  view: 'journey',
  tool: 'view',
  routing: new Set(),
  wizardOpen: false,
  shortcutsOpen: false,
  drawerOpen: false,
  player: { playing: false, progress: 1, speed: 1, follow: true },
  historyVersion: 0,
}));

const set = useStore.setState;
const get = useStore.getState;
const history = new History<Journey>(50);

export const activeJourney = (s: State = get()) => s.journeys.find((j) => j.id === s.activeId);

export function notify(text: string, action?: ToastAction) {
  set({ toast: { id: Date.now(), text, action } });
}

/** Opens the app's confirm dialog. */
export function confirmDialog(req: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) =>
    set({
      dialog: {
        ...req,
        resolve: (ok) => {
          set({ dialog: undefined });
          resolve(ok);
        },
      },
    }),
  );
}

export async function loadJourneys() {
  const journeys = await db.journeys.orderBy('updatedAt').reverse().toArray();
  set({ journeys, activeId: get().activeId ?? journeys[0]?.id });
  for (const j of journeys) void geocodeStops(j.id);
}

function save(j: Journey, opts: { history?: boolean } = {}) {
  const prev = get().journeys.find((x) => x.id === j.id);
  if (prev && opts.history !== false) {
    history.push(j.id, prev);
    set((s) => ({ historyVersion: s.historyVersion + 1 }));
  }
  const next = { ...j, updatedAt: Date.now() };
  set((s) => ({ journeys: s.journeys.map((x) => (x.id === j.id ? next : x)) }));
  db.journeys.put(next).catch((e) => notify(`Could not save: ${e.message}`));
  return next;
}

export async function createJourney(j: Journey, toRoute: string[] = []) {
  await db.journeys.put(j);
  set((s) => ({
    journeys: [j, ...s.journeys],
    activeId: j.id,
    view: 'journey',
    selectedStopId: undefined,
    selectedSegmentId: undefined,
    player: { ...s.player, progress: 1, playing: false },
  }));
  if (toRoute.length) void routeSegments(j.id, toRoute);
  void geocodeStops(j.id);
}

export function selectJourney(id: string) {
  set((s) => ({ activeId: id, view: 'journey', drawerOpen: false, selectedStopId: undefined, selectedSegmentId: undefined, tool: 'view', player: { ...s.player, playing: false, progress: 1 } }));
}

export function showWorld() {
  set((s) => ({ view: 'world', drawerOpen: false, tool: 'view', selectedStopId: undefined, selectedSegmentId: undefined, player: { ...s.player, playing: false, progress: 1 } }));
}

/** Removes a journey with a short window to undo it. */
export async function deleteJourney(id: string) {
  const j = get().journeys.find((x) => x.id === id);
  if (!j) return;
  await db.journeys.delete(id);
  set((s) => {
    const journeys = s.journeys.filter((x) => x.id !== id);
    return { journeys, activeId: s.activeId === id ? journeys[0]?.id : s.activeId };
  });
  notify(`Deleted “${j.title}”`, {
    label: 'Undo',
    run: async () => {
      await db.journeys.put(j);
      set((s) => ({ journeys: [j, ...s.journeys.filter((x) => x.id !== id)], activeId: j.id, view: 'journey' }));
    },
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
  void geocodeStops(j.id);
}

export async function routeSegments(journeyId: string, segmentIds: string[]) {
  set((s) => ({ routing: new Set([...s.routing, ...segmentIds]) }));
  for (const segId of segmentIds) {
    const j = get().journeys.find((x) => x.id === journeyId);
    const seg = j?.segments.find((s) => s.id === segId);
    if (j && seg) {
      const from = j.stops.find((s) => s.id === seg.fromStopId)!;
      const to = j.stops.find((s) => s.id === seg.toStopId)!;
      const result = await routeBetween(from, to, seg.mode);
      // The journey may have changed while we waited; only patch if the segment is still there unchanged.
      const now = get().journeys.find((x) => x.id === journeyId);
      const cur = now?.segments.find((s) => s.id === segId);
      if (now && cur && cur.mode === seg.mode) {
        save({ ...now, segments: now.segments.map((s) => (s.id === segId ? { ...s, ...result } : s)) }, { history: false });
      }
    }
    set((s) => {
      const routing = new Set(s.routing);
      routing.delete(segId);
      return { routing };
    });
  }
}

/** Fills in place names for stops that don't have one yet. */
async function geocodeStops(journeyId: string) {
  const pending = get().journeys.find((x) => x.id === journeyId)?.stops.filter((s) => !s.place) ?? [];
  for (const stop of pending) {
    const place = await reverseGeocode(stop.lng, stop.lat);
    if (!place) continue;
    const now = get().journeys.find((x) => x.id === journeyId);
    const cur = now?.stops.find((s) => s.id === stop.id);
    // Skip if the stop was moved or removed meanwhile; the move triggers its own lookup.
    if (!now || !cur || cur.place || cur.lat !== stop.lat || cur.lng !== stop.lng) continue;
    save({ ...now, stops: now.stops.map((s) => (s.id === stop.id ? { ...s, place } : s)) }, { history: false });
  }
}

const ROUTABLE: Mode[] = ['walk', 'bike', 'car', 'bus'];

function restore(j: Journey) {
  const next = { ...j, updatedAt: Date.now() };
  set((s) => ({ journeys: s.journeys.map((x) => (x.id === j.id ? next : x)), historyVersion: s.historyVersion + 1, selectedStopId: undefined, selectedSegmentId: undefined }));
  void db.journeys.put(next);
  // A snapshot may have been taken while a leg was still a placeholder; route it again.
  const unrouted = j.segments.filter((s) => s.routing === 'straight' && ROUTABLE.includes(s.mode)).map((s) => s.id);
  if (unrouted.length) void routeSegments(j.id, unrouted);
}

export function undo() {
  const j = activeJourney();
  const prev = j && history.undo(j.id, j);
  if (prev) restore(prev);
}

export function redo() {
  const j = activeJourney();
  const next = j && history.redo(j.id, j);
  if (next) restore(next);
}

export const canUndo = (id?: string) => !!id && history.canUndo(id);
export const canRedo = (id?: string) => !!id && history.canRedo(id);

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
  // A moved stop needs a fresh place name.
  setStops(j, j.stops.map((s) => (s.id === id ? { ...s, lng, lat, place: undefined } : s)), new Set([id]));
}

export function updateStop(id: string, patch: Partial<Pick<Stop, 'label' | 'note' | 'arrivedAt' | 'photoIds'>>) {
  const j = activeJourney();
  if (!j) return;
  save({ ...j, stops: j.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

export function deleteStop(id: string) {
  const j = activeJourney();
  if (!j) return;
  const stop = j.stops.find((s) => s.id === id);
  setStops(j, j.stops.filter((s) => s.id !== id));
  if (get().selectedStopId === id) set({ selectedStopId: undefined });
  if (stop) notify('Stop removed', { label: 'Undo', run: undo });
}

export function reorderStop(from: number, to: number) {
  const j = activeJourney();
  if (!j || from === to || to < 0 || to >= j.stops.length) return;
  const stops = [...j.stops];
  const [s] = stops.splice(from, 1);
  stops.splice(to, 0, s);
  setStops(j, stops);
}

export function mergeStop(id: string) {
  const j = activeJourney();
  if (!j) return;
  setStops(j, mergeWithNext(j.stops, id));
  set({ selectedStopId: id });
}

export function splitStop(id: string) {
  const j = activeJourney();
  if (!j) return;
  const stops = splitStopPure(j.stops, id, journeyPhotos());
  if (stops === j.stops) return notify('A stop needs at least two photos to split');
  setStops(j, stops, new Set(stops.filter((s) => !j.stops.includes(s)).map((s) => s.id)));
}

export function selectStopByOffset(delta: number) {
  const j = activeJourney();
  if (!j?.stops.length) return;
  const i = j.stops.findIndex((s) => s.id === get().selectedStopId);
  const next = j.stops[Math.min(j.stops.length - 1, Math.max(0, i < 0 ? 0 : i + delta))];
  set({ selectedStopId: next.id, selectedSegmentId: undefined });
  return next;
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

/** Takes photos off the active journey. Stops built only from those photos go too; hand-placed stops stay. */
export function removePhotos(ids: string[]) {
  const j = activeJourney();
  if (!j || !ids.length) return;
  const gone = new Set(ids);
  const stops = j.stops
    .map((s) => (s.photoIds.some((id) => gone.has(id)) ? { ...s, photoIds: s.photoIds.filter((id) => !gone.has(id)) } : s))
    .filter((s) => s.photoIds.length || s.origin !== 'photo');
  setStops({ ...j, loosePhotoIds: (j.loosePhotoIds ?? []).filter((id) => !gone.has(id)) }, stops);
  if (get().selectedStopId && !stops.some((s) => s.id === get().selectedStopId)) set({ selectedStopId: undefined });
  notify(`Removed ${ids.length} photo${ids.length === 1 ? '' : 's'}`, { label: 'Undo', run: undo });
}

/** Moves loose photos that now have a location (e.g. from Google Timeline) onto the trail as stops. */
export async function placeLoosePhotos(placed: Photo[]) {
  const j = activeJourney();
  if (!j || !placed.length) return;
  await savePhotos(placed);
  const ids = new Set(placed.map((p) => p.id));
  const merged = [...j.stops, ...clusterPhotos(placed)];
  // Keep chronological order when every stop has a time; otherwise append.
  if (merged.every((s) => s.arrivedAt != null)) merged.sort((a, b) => a.arrivedAt! - b.arrivedAt!);
  setStops({ ...j, loosePhotoIds: (j.loosePhotoIds ?? []).filter((id) => !ids.has(id)) }, merged);
}

/** Cuts the active journey into separate journeys before each of the given stop indexes. */
export async function splitActiveJourney(cuts: number[], homeParts: boolean[] = []) {
  const j = activeJourney();
  if (!j || !cuts.length) return;
  const loose = (await db.photos.bulkGet(j.loosePhotoIds ?? [])).filter((p) => !!p);
  const takenAt = new Map(loose.map((p) => [p.id, p.takenAt]));
  const [first, ...rest] = splitJourney(j, cuts, (id) => takenAt.get(id), homeParts);
  save(first);
  await db.journeys.bulkPut(rest);
  set((s) => ({ journeys: [...[...rest].reverse(), ...s.journeys], selectedStopId: undefined, selectedSegmentId: undefined }));
  notify(`Split into ${rest.length + 1} journeys`, {
    label: 'Undo',
    run: async () => {
      await db.journeys.bulkDelete(rest.map((r) => r.id));
      set((s) => ({ journeys: s.journeys.filter((x) => !rest.some((r) => r.id === x.id)), activeId: j.id, view: 'journey' }));
      restore(j);
    },
  });
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

export function openLightbox(photoIds: string[], index = 0) {
  if (photoIds.length) set((s) => ({ lightbox: { photoIds, index }, player: { ...s.player, playing: false } }));
}

export function setPlayer(patch: Partial<State['player']>) {
  set((s) => ({ player: { ...s.player, ...patch } }));
}

export function togglePlay() {
  const { player } = get();
  if (player.playing) return setPlayer({ playing: false });
  set({ selectedStopId: undefined, selectedSegmentId: undefined, tool: 'view' });
  setPlayer({ playing: true, progress: player.progress >= 1 ? 0 : player.progress });
}

