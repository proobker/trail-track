import { PICKER_SCOPE, tokenFor } from '../auth/google';
import { uid } from '../model/types';
import type { PhotoCandidate } from './candidate';

const API = 'https://photospicker.googleapis.com/v1';

interface PickerSession {
  id: string;
  pickerUri: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

interface PickedMediaItem {
  id: string;
  createTime: string;
  type: 'PHOTO' | 'VIDEO' | 'TYPE_UNSPECIFIED';
  mediaFile: { baseUrl: string; mimeType: string; filename: string };
}

const seconds = (d?: string, fallback = 5) => (d ? parseFloat(d) : fallback);

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`Google Photos request failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : res.json();
}

/**
 * Opens the Google Photos picker in a new window and resolves with the chosen photos.
 * The Picker API strips GPS, so the photos come back unlocated and are placed on the
 * trail by timestamp or by the user.
 */
export async function pickFromGooglePhotos(onStatus?: (msg: string) => void, signal?: AbortSignal): Promise<PhotoCandidate[]> {
  const token = await tokenFor(PICKER_SCOPE);
  const session = await api<PickerSession>(token, '/sessions', { method: 'POST', body: '{}' });
  const win = window.open(`${session.pickerUri}/autoclose`, 'gphotos-picker', 'width=1000,height=760');
  if (!win) throw new Error('Pop-up blocked. Allow pop-ups for this site to open Google Photos.');
  onStatus?.('Choose photos in the Google Photos window…');

  try {
    let s = session;
    const deadline = Date.now() + seconds(session.pollingConfig?.timeoutIn, 1800) * 1000;
    while (!s.mediaItemsSet) {
      if (signal?.aborted) throw new Error('Cancelled');
      if (Date.now() > deadline) throw new Error('Google Photos selection timed out');
      await new Promise((r) => setTimeout(r, seconds(s.pollingConfig?.pollInterval) * 1000));
      s = await api<PickerSession>(token, `/sessions/${session.id}`);
    }

    onStatus?.('Loading your selection…');
    const items: PickedMediaItem[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ sessionId: session.id, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const page = await api<{ mediaItems?: PickedMediaItem[]; nextPageToken?: string }>(token, `/mediaItems?${q}`);
      items.push(...(page.mediaItems ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return items
      .filter((m) => m.type !== 'VIDEO')
      .map((m) => ({
        photo: { id: uid(), source: 'picker' as const, takenAt: Date.parse(m.createTime), timeSource: 'sidecar' as const, people: [], fileName: m.mediaFile.filename },
        getBlob: async () => {
          // baseUrl expires after ~60 minutes; thumbnails are made right after picking.
          const res = await fetch(`${m.mediaFile.baseUrl}=w1280-h1280`, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`Could not download ${m.mediaFile.filename}`);
          return res.blob();
        },
      }));
  } finally {
    if (!win.closed) win.close();
    api(token, `/sessions/${session.id}`, { method: 'DELETE' }).catch(() => undefined);
  }
}
