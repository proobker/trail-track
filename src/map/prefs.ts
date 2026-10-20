import { create } from 'zustand';
import type { BaseStyle } from './styles';

interface Prefs {
  base: BaseStyle;
  terrain: boolean;
  globe: boolean;
  /** Desktop: whether the journeys sidebar is expanded or collapsed to an icon rail. */
  sidebarOpen: boolean;
  /** Desktop: whether the journey panel is shown. */
  panelOpen: boolean;
}

const DEFAULTS: Prefs = { base: 'dark', terrain: false, globe: true, sidebarOpen: true, panelOpen: true };

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
