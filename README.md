# Trail Track

Turn your photos into an animated trail on a map. Filter by date and by who's in the photos, set how you travelled each leg, or draw and import routes yourself.

## Run

Requires Node.js 20+.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/ (also builds the share-page viewer)
```

## Where trails come from

| Source | Location | People filter | Notes |
| --- | --- | --- | --- |
| **Google Takeout** (zip or extracted folder) | ✅ from each photo's JSON sidecar | ✅ named faces | Best option. Export only "Google Photos" at [takeout.google.com](https://takeout.google.com). Split zips can be added together. Files are read locally and only matching photos are thumbnailed. |
| **Upload photos** | ✅ from EXIF GPS | — | Photos sent over chat apps usually have their location stripped. Without an EXIF date, the date in the file name is used (e.g. `IMG-20240512-WA0003.jpg`). |
| **Google Photos picker** | ❌ | — | Google's Picker API removes GPS and offers no people filter. Picked photos are placed along an existing trail by timestamp, or you can pin them. |
| **KML / GPX / GeoJSON** | ✅ | — | Each track becomes a segment and keeps its exact shape. |
| **Manual** | — | — | Click the map in "Add stops" mode, or search for a place and press "+ stop". |

Google shut down full-library access to Google Photos in March 2025, which is why Takeout is the main import path.

**Photos without a location** can be placed from your **Google Timeline**, either while importing or later from the Photos tab ("Find places with Google Timeline"). Export it on your phone (Android: Settings → Location → Location services → Timeline → Export Timeline data; iPhone: Google Maps → Settings → Personal content → Export Timeline data). Older Takeout `Records.json` and `Semantic Location History` files work too. A photo taken during a visit gets that place; otherwise it is interpolated along your path, and photos more than 45 minutes from any Timeline point stay unplaced. Camera times without a time zone are matched against the local time in the Timeline, so a camera on home time still lines up abroad.

## Editing a trail

- **Transport mode per leg.** Click a leg's mode chip to change it.
  - Walk, bike, car and bus follow real roads (OSRM).
  - Flights are drawn as great-circle arcs.
  - Train and boat use straight lines, or you can draw the path by hand.
  - Modes are guessed from the speed between photos; long overnight gaps are judged by distance instead.
- **Stops.**
  - Click the map in "Add stops" mode, or search for a place and press "+ Stop" (or Shift+Enter).
  - Drag stops to move them.
  - Each stop's ⋯ menu can rename, reorder, merge with the next stop, split by time gap, or remove it.
- **Undo / redo** for every edit (Ctrl+Z / Ctrl+Shift+Z).
- **GPS glitch cleanup.** On import, a photo whose location jumps far away and straight back is set aside under "needs a place" instead of distorting the trail.
- **Place grouping.** Nearby photos taken within two hours of each other form a stop. A small image fingerprint, calculated locally while making thumbnails, lets near-duplicate shots stay together when GPS drifts a little. This compares images; it does not identify a landmark or infer coordinates from a picture.
- **Optional scene analysis.** During import, you can load a CLIP image model into the browser and compare selected photos on this device. Similar scenes can stay in one stop despite modest GPS drift. A photo without GPS can also join a stop when it clearly matches a located photo from the same visit; ambiguous matches remain under “Needs a place.” The approximately 90 MB model is downloaded on first use and cached by the browser; photo pixels are not uploaded. This cannot identify a named landmark from a picture alone.
- **Photos without location** show as dashed thumbnails. Pin each one on the map, or attach it to the stop nearest in time.

## Journal

- Stops are named automatically from the place they're at (reverse geocoding via Photon), e.g. "Monastery of the Hieronymites · Lisbon, Portugal".
- The route list is grouped by day.
- Each stop can hold a note, which is also shown during playback.
- A full-screen photo viewer opens from the stop list, the map or the playback card; use ←/→ to browse.

## Stats & world map

- **Stats tab:**
  - distance by transport mode;
  - a day-by-day table;
  - an elevation profile for the whole trip or one day, from AWS terrain tiles (hover it to see the point on the map);
  - the cities and countries you visited.
- **All journeys:** every trip on one map, with a heatmap of where you've been and totals for distance, countries, cities and photos.

## Playback & sharing

Press ▶ (or Space) and the trail draws itself:
- a glowing line, with a marker showing how you were travelling;
- a camera that follows along;
- photo cards at each stop, and the date and time in the player bar.

From the **Share** tab:

- **Video:** landscape (16:9, 1080p) or portrait (9:16). The recording includes a title card, the photo bubbles and photo cards, and a closing stats card. Chrome saves MP4; other browsers save WebM.
- **Interactive page:** a single `.html` file containing the map, the animation and your photos. Anyone can open it in a browser, even straight from their downloads folder. It loads map tiles and MapLibre from the internet.
- **Map files:** GPX, KML, GeoJSON.

Use Back up / Restore in the sidebar to move everything, including photos, to another browser.

## Keyboard shortcuts

Press `?` in the app for the full list.

| Key | Action |
| --- | --- |
| Space | play / pause |
| A / V | add stops / explore |
| ← / → | previous / next stop |
| L | open the selected stop's photos |
| F | fit the journey in view |
| Delete | remove the selected stop |

## Layout

- On desktop, the journeys sidebar collapses to an icon rail and the journey panel can be hidden.
- On phones, the sidebar becomes a drawer and the panel a bottom sheet you can drag between three heights.

## Google sign-in (optional)

Sign-in is only needed for the Google Photos picker.

1. Google Cloud Console → create a project → enable the **Google Photos Picker API**.
2. OAuth consent screen → add yourself as a test user.
3. Credentials → OAuth client ID → *Web application* → authorized JavaScript origin `http://localhost:5173`.
4. `cp .env.example .env` and set `VITE_GOOGLE_CLIENT_ID`.

## Privacy and services

Everything is stored in this browser (IndexedDB). Nothing is uploaded to a server. The app calls these third-party services:

- OpenFreeMap: map tiles
- Esri: satellite imagery
- AWS Terrain Tiles: 3D terrain
- Photon (komoot): place search and place names
- routing.openstreetmap.de: OSRM routes; only the coordinates of each leg are sent

The public routing server is rate-limited, so routes are fetched about one per second and cached.
