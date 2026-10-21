import { describe, expect, it } from 'vitest';
import type { Stop } from '../src/model/types';
import { journeyStats, newJourney } from '../src/trail/journey';
import { rangeTitle, withJourneyTitle } from '../src/trail/naming';
import { splitJourney } from '../src/trail/trips';

const stop = (city: string, day = '2026-10-17'): Stop => ({
  id: crypto.randomUUID(), lat: 27.7, lng: 85.3, photoIds: [], origin: 'photo',
  arrivedAt: new Date(`${day}T12:00`).getTime(), place: { city },
});

describe('journey names', () => {
  it('names visited cities in route order, collapsing repeated cities', () => {
    const j = newJourney('Old', { autoTitle: true, stops: [stop('Kathmandu'), stop('Kathmandu'), stop('Pokhara'), stop('Kathmandu')] });
    expect(withJourneyTitle(j).title).toBe('Kathmandu → Pokhara');
  });
  it('updates legacy date names and keeps updating after more places arrive', () => {
    const j = newJourney(rangeTitle('2026-10-17', '2026-10-18'), { dateFrom: '2026-10-17', dateTo: '2026-10-18', stops: [stop('Kathmandu')] });
    const named = withJourneyTitle(j);
    expect(named.title).toBe('Kathmandu');
    expect(withJourneyTitle({ ...named, stops: [...named.stops, stop('Pokhara')] }).title).toBe('Kathmandu → Pokhara');
  });
  it('preserves custom names including explicitly chosen date names', () => {
    const j = newJourney('My holiday', { stops: [stop('Kathmandu')] });
    expect(withJourneyTitle(j).title).toBe('My holiday');
    const title = rangeTitle('2026-10-17', '2026-10-17');
    expect(withJourneyTitle({ ...j, title, dateFrom: '2026-10-17', dateTo: '2026-10-17', autoTitle: false }).title).toBe(title);
  });
  it('uses named places and keeps dates when no place is known', () => {
    const j = newJourney('Old', { autoTitle: true, dateFrom: '2026-10-17', dateTo: '2026-10-18' });
    expect(withJourneyTitle(j).title).toBe('2026-10-17 → 2026-10-18');
    expect(withJourneyTitle({ ...j, stops: [{ ...stop(''), place: { name: 'Annapurna Base Camp' } }] }).title).toBe('Annapurna Base Camp');
  });
  it('names split journeys from their own locations', () => {
    const j = newJourney('Kathmandu → Pokhara', { autoTitle: true, stops: [stop('Kathmandu'), stop('Pokhara', '2026-10-18')] });
    expect(splitJourney(j, [1], () => undefined).map((part) => part.title)).toEqual(['Kathmandu', 'Pokhara']);
  });
});

it('shows dates and unplaced counts for a journey with no GPS stops', () => {
  const stats = journeyStats(newJourney('Trip', { dateFrom: '2026-10-17', dateTo: '2026-10-18', loosePhotoIds: ['a', 'b'] }));
  expect(stats.start).toBe(new Date('2026-10-17T12:00').getTime());
  expect(stats.end).toBe(new Date('2026-10-18T12:00').getTime());
  expect(stats.loosePhotoCount).toBe(2);
  expect(journeyStats(newJourney('Empty')).start).toBeUndefined();
});
