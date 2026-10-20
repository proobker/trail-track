# Roam — your trail journal

A personal trail tracker for places you've visited, places you want to explore, and the photos you want to keep.

## Run locally

Requires Node.js 18 or newer. From this directory, run `npm run dev` and open `http://localhost:4173`.

## Features

- Browse and search a curated set of trails, or enter any place yourself.
- Save places for later and filter by landscape.
- Log visits with a date, region, rating, notes, and a photo.
- Edit or delete visits, and see journey totals.
- Export and import a JSON backup.

Visits and photos are stored in this browser using IndexedDB. Saved places use local storage. They are not synced between devices; use the export button to back up or move your journal. Uploaded images are resized before saving to keep browser storage manageable.
