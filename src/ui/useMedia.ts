import { useSyncExternalStore } from 'react';

const query = window.matchMedia('(max-width: 767px)');

/** True on phone-sized screens, where panels become a drawer and a bottom sheet. */
export const useIsMobile = () =>
  useSyncExternalStore(
    (cb) => {
      query.addEventListener('change', cb);
      return () => query.removeEventListener('change', cb);
    },
    () => query.matches,
  );
