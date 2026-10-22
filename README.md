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

**Home.** When splitting a library into trips, home is detected from where you photograph most. To set it yourself, press **Set your home** / **Change home** in the import wizard and search for your town or use your current location. It is remembered in this browser.

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
- **Text-heavy image filter.** In the import wizard, choose **Find text-heavy photos** to scan selected images with on-device OCR. Likely documents, quote cards and text graphics are excluded from the trip preview, and each flagged filename can be kept before building the journey. For photos already imported, **Select text-heavy photos** in the Photos tab highlights matches for review before removal. The scan uses English OCR data downloaded on first use; a sign or a few words in a travel photo are kept.
- **Photos without location** are placed in this order:
  1. a clear visual match to a located photo;
  2. on-device place recognition (optional, see below);
  3. their time between the two stops around them, interpolated along the leg when the gap is six hours or less.
  
  If none of these is clear, the photo is still placed with the best weak clue (the model's unsure pick, its time, the most similar-looking stop, or the nearest stop in time) and labelled "Rough guess" in the photo viewer. GPS glitches are re-placed the same way. For older journeys, press **Place all automatically** in the Photos tab.
- **Which times are trusted.** Shared and downloaded copies often lose EXIF, and their file date is just when they were saved. Times are used for placement only when they come from EXIF, Google Photos/Takeout's capture time, or a file name with a time of day (e.g. `PXL_20240512_093015123.jpg`). A file date or a date-only name (e.g. `IMG-20240512-WA0003.jpg`) is never used to interpolate. Such a photo is matched against the whole trip instead, and when it is placed it takes the stop's time (shown as "estimated" in the photo viewer).
- **On-device place recognition.** Tick **Recognise places for photos without GPS** while importing, or press **Find places with on-device AI** in the Photos tab.
  - It uses the [StreetCLIP](https://huggingface.co/onnx-community/StreetCLIP-ONNX) geolocation model, about 430 MB, downloaded once and cached by the browser. Photo pixels are not uploaded.
  - It chooses among the places already on your trip: the stops around the photo's time when that time is trusted, otherwise every stop.
  - Confident picks join that stop; unsure ones are offered as suggestions.
  - StreetCLIP is licensed CC BY-NC 4.0 (non-commercial use).

## Journal

- **Named trails:** In the Route tab, press "Find nearby trails" for a compact walking journey, or select a walking leg first to search around that leg. Preview OpenStreetMap candidates (plus USGS National Map trails in US areas), then confirm a name. Stops and sampled route points rank the suggestions. The existing route geometry stays intact. Large walking areas must be searched one leg at a time. Search results are cached locally for seven days.
- **Trek names.** A journey that follows a well-known Nepal trek is titled after it, e.g. "Ama Yangri Trek", "Everest Base Camp Trek" or "Annapurna Circuit". The app has a built-in list of 29 treks with their main stops (coordinates from OpenStreetMap). A trek needs stops at two or more of its waypoints and a good share of the journey along its route. Names you typed yourself are never replaced.
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
- Overpass API (only when you press "Find nearby trails"): a bounded area around walking stops is sent to look up named OpenStreetMap trails. The selected trail name and OpenStreetMap ID are saved locally; your existing route shape is not replaced.
- USGS National Map (US trail searches only): the same bounded area is queried for additional trail names. Its failure does not block OpenStreetMap results.

The public routing server is rate-limited, so routes are fetched about one per second and cached.
