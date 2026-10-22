import type { Journey } from '../model/types';
import { matchTrek } from './treks';

export const rangeTitle = (from: string, to: string) =>
  from === to ? new Date(`${from}T12:00`).toLocaleDateString(undefined, { dateStyle: 'long' }) : `${from} → ${to}`;

/** Recognise old generated date titles without replacing personal names. */
export function usesAutomaticTitle(j: Journey): boolean {
  if (j.autoTitle != null) return j.autoTitle;
  if (!j.dateFrom || !j.dateTo) return false;
  const dated = rangeTitle(j.dateFrom, j.dateTo);
  return j.title === dated || j.title === `At home · ${dated}`;
}

/** A known trek's name when the stops follow one; otherwise cities in visit order, falling back to named places or manually labelled stops. */
export function withJourneyTitle(j: Journey): Journey {
  if (!usesAutomaticTitle(j)) return j;
  const trek = matchTrek(j.stops);
  if (trek) return { ...j, autoTitle: true, title: trek.name };
  const names: string[] = [];
  const seen = new Set<string>();
  for (const stop of j.stops) {
    const name = [stop.place?.city, stop.place?.name, stop.label, stop.place?.country].find((s) => s?.trim())?.trim();
    if (!name || seen.has(name.toLocaleLowerCase())) continue;
    seen.add(name.toLocaleLowerCase());
    names.push(name);
  }
  const fallback = j.dateFrom && j.dateTo ? rangeTitle(j.dateFrom, j.dateTo) : 'New journey';
  const title = names.length
    ? names.slice(0, 3).join(' → ') + (names.length > 3 ? ` +${names.length - 3} places` : '')
    : fallback;
  return { ...j, autoTitle: true, title };
}
