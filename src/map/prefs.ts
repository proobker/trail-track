import { create } from 'zustand';
import type { BaseStyle } from './styles';

interface Prefs {
  base: BaseStyle;
  terrain: boolean;
  globe: boolean;
}

const DEFAULTS: Prefs = { base: 'dark', terrain: false, globe: true };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('tt-prefs') ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export const usePrefs = create<Prefs>(load);

usePrefs.subscribe((p) => {
  try {
    localStorage.setItem('tt-prefs', JSON.stringify(p));
  } catch {
    // storage may be blocked
  }
});
