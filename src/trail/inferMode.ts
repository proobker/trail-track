import type { Mode, Stop } from '../model/types';
import { metres } from './geo';

/** Guesses a transport mode from straight-line speed between two stops. Train/boat are never guessed. */
export function inferMode(from: Stop, to: Stop): Mode {
  const d = metres([from.lng, from.lat], [to.lng, to.lat]);
  if (d > 500_000) return 'flight';
  if (from.arrivedAt == null || to.arrivedAt == null || to.arrivedAt <= from.arrivedAt) {
    return d < 3_000 ? 'walk' : 'car';
  }
  const kmh = d / 1000 / ((to.arrivedAt - from.arrivedAt) / 3_600_000);
  if (kmh < 6) return 'walk';
  if (kmh < 25) return 'bike';
  if (kmh < 250) return 'car';
  return 'flight';
}
