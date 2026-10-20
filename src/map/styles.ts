import type { StyleSpecification } from 'maplibre-gl';

export const BASE_STYLES = {
  dark: { label: 'Night', style: 'https://tiles.openfreemap.org/styles/dark' },
  liberty: { label: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
  positron: { label: 'Light', style: 'https://tiles.openfreemap.org/styles/positron' },
  satellite: {
    label: 'Satellite',
    style: {
      version: 8,
      glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources: {
        esri: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
    } satisfies StyleSpecification,
  },
} as const;

export type BaseStyle = keyof typeof BASE_STYLES;

export const DEM_SOURCE = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 14,
  attribution: 'Terrain: Mapzen / AWS Open Data',
};
