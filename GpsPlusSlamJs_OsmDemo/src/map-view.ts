/**
 * The Leaflet view: the res-13 affordance grid and its region outlines.
 *
 * WHY LEAFLET RATHER THAN THE AR VIEW FOR THE FIRST LOOK. §8.4 is explicit that
 * the AR overlay is a gross-failure detector, not a fine judgement instrument —
 * OSM footprints carry low-metre absolute error, plausibly more than the fusion
 * error being measured. A 2D map against the OSM raster basemap has no such
 * ambiguity: if a lawn is not scoring walkable, that is a scoring fact, not a
 * pose question.
 *
 * WHY THE DRAWING IS SEPARATE FROM THE DATA. `demo-pipeline.ts` produces cells
 * and regions with no DOM at all and is unit-tested; this file only turns them
 * into layers. When the map looks wrong, that split is what makes it possible to
 * ask "is the data wrong or the drawing wrong?" and get an answer.
 *
 * @see map-view.ts.md
 */

import L from 'leaflet';
import { cellToBoundary } from 'h3-js';
import type { CellScore, Region } from 'gps-plus-slam-osm';

import {
  describeScale,
  heatColour,
  heatScale,
  toHex,
  type HeatScale,
} from './heat-colours.js';

/**
 * ODbL requires attribution wherever OSM data is shown — and this view shows
 * both the basemap tiles and data derived from OSM, so it is doubly required.
 */
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export interface MapViewOptions {
  readonly container: HTMLElement;
  readonly centre: { lat: number; lng: number };
  readonly zoom?: number;
}

export class MapView {
  readonly map: L.Map;
  private readonly cellLayer: L.LayerGroup;
  private readonly regionLayer: L.LayerGroup;
  private readonly userMarker: L.CircleMarker;

  constructor(options: MapViewOptions) {
    this.map = L.map(options.container).setView(
      [options.centre.lat, options.centre.lng],
      options.zoom ?? 18
    );

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
    }).addTo(this.map);

    // Regions UNDER cells: the outline is context for the grid, and drawing it
    // on top hides the very cells that produced it.
    this.regionLayer = L.layerGroup().addTo(this.map);
    this.cellLayer = L.layerGroup().addTo(this.map);

    this.userMarker = L.circleMarker([options.centre.lat, options.centre.lng], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: '#ff3860',
      fillOpacity: 1,
    }).addTo(this.map);
  }

  /** Moves the "you are here" marker without disturbing the view. */
  setPosition(position: { lat: number; lng: number }): void {
    this.userMarker.setLatLng([position.lat, position.lng]);
  }

  /**
   * Redraws the grid and outlines for one category.
   *
   * Clears and rebuilds rather than diffing: a working set is ~931 cells, and a
   * diff would be a second source of truth about what is on screen — which is
   * the last thing a view built to be trusted by eye should have.
   */
  render(
    cells: readonly CellScore[],
    regions: readonly Region[],
    category: string,
    threshold: number
  ): HeatScale {
    this.cellLayer.clearLayers();
    this.regionLayer.clearLayers();

    const scale = heatScale(
      cells.map((cell) => cell.scores[category] ?? 1),
      threshold
    );

    for (const cell of cells) {
      const score = cell.scores[category] ?? 1;
      // Cells at the identity are NOT drawn. "No rule said anything here" and
      // "this scored badly" are different claims, and colouring the first as
      // the bottom of the ramp would assert knowledge the data does not have.
      if (score <= threshold) continue;

      L.polygon(cellToBoundary(cell.cell) as [number, number][], {
        stroke: false,
        fillColor: toHex(heatColour(score, scale)),
        fillOpacity: 0.55,
      })
        .bindTooltip(tooltipFor(cell, category, score))
        .addTo(this.cellLayer);
    }

    for (const region of regions) {
      for (const polygon of region.outline) {
        L.polygon(
          polygon.map((ring) => ring.map((p) => [p.lat, p.lng] as [number, number])),
          { color: '#ffffff', weight: 2, fill: false, dashArray: '4 4' }
        )
          .bindTooltip(
            `${region.category}: ${region.cellCount} cells, ` +
              `${Math.round(region.areaM2)} m², median ${round(region.medianScore)}`
          )
          .addTo(this.regionLayer);
      }
    }

    return scale;
  }

  describeScale = describeScale;
}

/**
 * The tooltip is the demo's debugging surface.
 *
 * Provenance is the whole reason the C# reference kept a contributing-entries
 * map, and it is what turns "that cell looks wrong" into "that cell is wrong
 * BECAUSE of way/12345" in one click. Without it a surprising score is just a
 * surprising colour.
 */
function tooltipFor(cell: CellScore, category: string, score: number): string {
  const contributors = cell.contributors[category] ?? {};
  const lines = Object.entries(contributors)
    .filter(([, factor]) => factor !== 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(
      ([key, factor]) =>
        `<a href="https://www.openstreetmap.org/${key}" target="_blank" rel="noreferrer">${key}</a> × ${round(factor)}`
    );

  return (
    `<strong>${category} = ${round(score)}</strong><br>` +
    (lines.length > 0
      ? lines.join('<br>')
      : '<em>no rule contributed — this is the identity</em>')
  );
}

/** Multiplicative scores produce 3.6000000000000005; round for display only. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
