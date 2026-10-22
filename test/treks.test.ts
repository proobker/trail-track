import { describe, expect, it } from 'vitest';
import { matchTrek } from '../src/trail/treks';
import { newJourney } from '../src/trail/journey';
import { withJourneyTitle } from '../src/trail/naming';
import type { Stop } from '../src/model/types';

const at = (lat: number, lng: number) => ({ lat, lng });
const stop = (lat: number, lng: number, city: string): Stop => ({ id: city, lat, lng, photoIds: [], origin: 'photo', place: { city } });

describe('matchTrek', () => {
  it('names a trip up the Melamchi valley to Ama Yangri', () => {
    expect(matchTrek([at(27.833, 85.577), at(27.93, 85.556), at(27.958, 85.552), at(28.0, 85.554), at(28.014, 85.569)])?.name).toBe('Ama Yangri Trek');
  });
  it('tells Gokyo from Everest Base Camp on the shared Khumbu trail', () => {
    expect(matchTrek([at(27.687, 86.731), at(27.804, 86.71), at(27.836, 86.765), at(27.894, 86.831), at(27.981, 86.829)])?.name).toBe('Everest Base Camp Trek');
    expect(matchTrek([at(27.687, 86.731), at(27.804, 86.71), at(27.903, 86.716), at(27.954, 86.695)])?.name).toBe('Gokyo Lakes Trek');
  });
  it('ignores a city break that happens to pass one trek town', () => {
    // Kathmandu sights plus one stop in Pokhara near Phedi: not a trek.
    expect(matchTrek([at(27.7172, 85.324), at(27.7104, 85.3488), at(27.6727, 85.4298), at(28.2917, 83.8717)])).toBeUndefined();
  });
  it('becomes the automatic journey title', () => {
    const stops = [stop(27.7172, 85.324, 'Kathmandu'), stop(27.833, 85.577, 'Melamchi'), stop(27.958, 85.552, 'Helambu'), stop(28.014, 85.569, 'Helambu')];
    expect(withJourneyTitle(newJourney('x', { autoTitle: true, stops })).title).toBe('Ama Yangri Trek');
    expect(withJourneyTitle(newJourney('My walk', { autoTitle: false, stops })).title).toBe('My walk');
  });
});
