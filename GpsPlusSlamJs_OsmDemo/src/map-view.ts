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

import L from "leaflet";
import { cellToBoundary } from "h3-js";
import type { CellScore, Region } from "gps-plus-slam-osm";

import { describeScale, type HeatScale } from "./heat-colours.js";
import { tileBounds } from "./fetch-extent.js";
import { escapeHtml } from "./escape-html.js";
import { regionStyle } from "./region-style.js";
import { rankContributors } from "./contributor-order.js";
import {
  bandTreatment,
  classifyScore,
  type LegendStopKind,
} from "./legend-model.js";

/**
 * ODbL requires attribution wherever OSM data is shown — and this view shows
 * both the basemap tiles and data derived from OSM, so it is doubly required.
 */
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export interface MapViewOptions {
  readonly container: HTMLElement;
  readonly centre: { lat: number; lng: number };
  readonly zoom?: number;
  /** Called with the H3 id when a cell is clicked. */
  readonly onCellClick?: (cell: string) => void;
}

export class MapView {
  readonly map: L.Map;
  private readonly cellLayer: L.LayerGroup;
  private readonly regionLayer: L.LayerGroup;
  private readonly fetchLayer: L.LayerGroup;
  private readonly userMarker: L.CircleMarker;
  private readonly onCellClick: ((cell: string) => void) | undefined;
  /** The DEM credit currently in the attribution bar, so it can be removed. */
  private terrainCredit: string | undefined;

  constructor(options: MapViewOptions) {
    this.onCellClick = options.onCellClick;
    this.map = L.map(options.container).setView(
      [options.centre.lat, options.centre.lng],
      options.zoom ?? 18,
    );

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
    }).addTo(this.map);

    // Region outlines are drawn OVER the cells, and the group order here is
    // cosmetic — Leaflet's default renderer puts every vector into one shared
    // <svg>, so what decides paint order is the order `render()` creates the
    // paths, not the order the groups were added. The groups are ordered to
    // agree with it anyway, so nobody has to know that twice.
    //
    // REGIONS UNDERNEATH THE CELLS, and W9 is what forced this round.
    //
    // The regions were on top, on the reasoning that a 2 px dashed stroke
    // occludes essentially nothing while a stroke under 55 %-opacity fills is
    // washed out where the boundary matters. That reasoning was about a region
    // drawn as an OUTLINE — and W15 gave it a fill, which W9 then switched on by
    // default. A filled SVG path hit-tests its interior, so every cell under a
    // region became unclickable: the click landed on the region instead.
    //
    // That is round-1 DEC-7's rule reappearing one layer up — "a hidden cell is
    // the one cell you cannot click to ask why" — and it is why the twelve e2e
    // failures W9 produced were not all baseline churn. The cell grid is the
    // finest-grained claim and the thing being inspected, so it goes on top and
    // keeps the clicks; the region boundary being slightly washed out is the
    // smaller loss by a wide margin.
    // A PANE, not just an earlier `addTo`. Leaflet appends every path to the
    // shared overlay pane in the order `render` creates them — cells first, then
    // regions — so layer-group order does not decide who is on top and the
    // regions ended up above the cells whatever the groups did. A pane with a
    // lower z-index is the only thing that actually orders them.
    this.map.createPane(REGION_PANE);
    const pane = this.map.getPane(REGION_PANE);
    if (pane !== undefined) pane.style.zIndex = "350";
    this.regionLayer = L.layerGroup().addTo(this.map);
    this.cellLayer = L.layerGroup().addTo(this.map);
    // Last, so the fetch outline sits above the grid. It is stroke-only, so
    // being on top costs nothing and being underneath would hide it behind ~931
    // filled cells — which is exactly where it is most worth seeing.
    this.fetchLayer = L.layerGroup().addTo(this.map);

    this.userMarker = L.circleMarker([options.centre.lat, options.centre.lng], {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      fillColor: "#ff3860",
      fillOpacity: 1,
      // Named for the same reason the cells and the fetch box are: Leaflet
      // renders every vector as an indistinguishable `<path>`, and the e2e
      // needs to assert WHERE the user marker is to prove a locate recentred
      // the viewport rather than leaving it 2 km away.
      className: "user-marker",
    }).addTo(this.map);
  }

  /** Moves the "you are here" marker without disturbing the view. */
  setPosition(position: { lat: number; lng: number }): void {
    this.userMarker.setLatLng([position.lat, position.lng]);
  }

  /**
   * Adds or removes the elevation source's credit in Leaflet's attribution bar.
   *
   * WHY IT LIVES HERE RATHER THAN IN THE HEADER (DEC-R2-4). The header became
   * collapsible, and **attribution may not be collapsed away** — it is required
   * wherever the data is shown. Leaflet's attribution control is always visible
   * and is where a credit conventionally goes.
   *
   * Passing `undefined` REMOVES it, which matters: crediting a DEM source whose
   * tiles all failed would be a claim about what is on screen. Removal is
   * idempotent, so a run of failed loads does not need to track what it added.
   */
  setTerrainAttribution(credit: string | undefined): void {
    const control = this.map.attributionControl;
    if (this.terrainCredit !== undefined) {
      control.removeAttribution(this.terrainCredit);
      this.terrainCredit = undefined;
    }
    if (credit === undefined) return;
    control.addAttribution(credit);
    this.terrainCredit = credit;
  }

  /**
   * Moves the marker AND brings the viewport to it.
   *
   * Separate from `setPosition` because the two callers want opposite things. A
   * map click already happens somewhere the user is looking, and recentring
   * under their cursor would yank the map out from under them. A GPS fix is
   * typically somewhere else entirely — at zoom 18 the demo's start position is
   * off screen from anywhere more than ~200 m away — so leaving the viewport put
   * shows an unchanged basemap with the marker, the new grid and the fetch box
   * all outside it. That looks exactly like a button that does nothing, which is
   * the problem the locate button was added to solve.
   */
  centreOn(position: { lat: number; lng: number }): void {
    this.setPosition(position);
    this.map.setView([position.lat, position.lng], this.map.getZoom());
  }

  /**
   * Removes everything derived from a snapshot, leaving the basemap and the
   * user marker.
   *
   * Called when a refresh FAILED and there is no longer a snapshot to draw. The
   * cells, the region outlines and the red fetch boxes all describe a specific
   * scored working set; keeping any of them on screen after that set is gone
   * makes the map assert a state nothing produced — which is exactly the defect
   * the round-1 feedback reported. The marker stays because "where the user is"
   * is still true, and the basemap because it was never a claim about scoring.
   */
  clear(): void {
    this.cellLayer.clearLayers();
    this.regionLayer.clearLayers();
    this.fetchLayer.clearLayers();
  }

  /**
   * Draws what was actually downloaded: one red box per fetch tile.
   *
   * THE BOX IS THE QUERY, THE HEXAGON IS ONLY AN IDENTITY. Overpass has no
   * hexagon primitive, so `buildTileQuery` asks for `cellToBoundingBox(tile)` —
   * at Cologne a 2.47 x 2.55 km box around a 4.5 km² hexagon, 1.39x.
   *
   * **Nothing in the corners is discarded.** No hexagon filter exists on the
   * ingest path: `acceptTile` merges every feature the response contained, and
   * scoring bbox-tests against the CHUNK, never against the tile. The hexagon
   * is a cache and invalidation key, not a spatial filter. What the mismatch
   * really costs is that neighbouring tiles' bboxes OVERLAP, so the shared
   * ground is transferred again when the adjacent tile is fetched — stored
   * once, used fully, downloaded twice.
   *
   * Both are drawn because drawing only the box would invite the reading this
   * display exists to correct — that the red box IS the tile. The hexagon is
   * dashed and dimmer: it is the reference, the box is the subject.
   */
  renderFetchTiles(tiles: readonly string[]): void {
    this.fetchLayer.clearLayers();

    for (const tile of tiles) {
      const bounds = tileBounds(tile);
      L.rectangle(
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        {
          color: "#ff3860",
          weight: 2,
          // Stroke only. A fill over the heat grid would defeat the grid, and
          // the question here is "how big", not "what is inside".
          fill: false,
          // Named so the e2e suite can assert the box is really on screen
          // rather than that some path exists.
          className: "fetch-extent",
        },
      ).addTo(this.fetchLayer);

      L.polygon(cellToBoundary(tile), {
        color: "#ff3860",
        weight: 1,
        opacity: 0.5,
        dashArray: "4 4",
        fill: false,
        className: "fetch-tile-hex",
      }).addTo(this.fetchLayer);
    }
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
    threshold: number,
    /**
     * The heat scale, DERIVED BY THE CALLER (W12, finding R3-8).
     *
     * This used to be computed here from the cells it was handed — and the
     * caller hands it a list already filtered by the `cells` layer switch. So
     * switching that layer off collapsed the ramp to nothing, the legend went to
     * "1 to 1", and the 2D region fills were coloured on an empty scale while the
     * 3D slabs used one derived from every cell. Two views, two scales, the same
     * regions: exactly the cross-view disagreement the store exists to prevent,
     * reintroduced by the layer registry.
     *
     * Passing it in makes one derivation serve the map, the 3D view and the
     * legend, and makes a second one impossible to add by accident.
     */
    scale: HeatScale,
    showBelowThreshold = false,
    /**
     * Whether regions are FILLED as well as outlined (W15).
     *
     * The `areas` layer, which is the same switch that draws the 3D slabs — one
     * claim, drawn in both views or in neither. The dashed boundary is not behind
     * this flag: it answers "where does this end", which does not stop mattering
     * when the fill answers "how good is it".
     */
    fillRegions = false,
  ): HeatScale {
    this.cellLayer.clearLayers();
    this.regionLayer.clearLayers();

    for (const cell of cells) {
      const score = cell.scores[category] ?? 1;
      const band = classifyScore(score, threshold);
      // Sub-threshold cells are hidden UNLESS asked for. The old code skipped
      // everything at or below the threshold and a comment claimed it skipped
      // only the identity — a broader rule than it described, and the reason a
      // vetoed cell was the one cell that could not be clicked to ask why it
      // was vetoed. With the checkbox on, the three bands are drawn but stay
      // visually distinct from the ramp: `0` and `1` are opposite statements,
      // and rendering both as "faint" would answer the question with the same
      // picture for both.
      if (band !== "ramp" && !showBelowThreshold) continue;

      L.polygon(cellToBoundary(cell.cell), {
        ...styleForBand(band, score, scale),
        // Named so the e2e suite can count what is actually on screen. Leaflet
        // renders every polygon as an indistinguishable `<path>`; without a
        // class, a test asserting "cells are drawn" would equally match the
        // region outlines and would pass while the grid was empty.
        className: `affordance-cell affordance-cell-${band}`,
      })
        // HOVER = the number, CLICK = the evidence. The tooltip is deliberately
        // score-only now: it is non-interactive by design in Leaflet, which is
        // what made the provenance links unusable for the whole of iteration 8.
        .bindTooltip(`${escapeHtml(category)} = ${round(score)}`)
        .bindPopup(popupFor(cell, category, score))
        .on("click", () => {
          // The panel follows the map. The map does not know the panel exists:
          // it reports a selection and the store decides who cares.
          this.onCellClick?.(cell.cell);
        })
        .addTo(this.cellLayer);
    }

    for (const region of regions) {
      for (const polygon of region.outline) {
        L.polygon(
          polygon.map((ring) =>
            ring.map((p) => [p.lat, p.lng] as [number, number]),
          ),
          {
            ...regionStyle(region.medianScore, scale, fillRegions),
            pane: REGION_PANE,
          },
        )
          .bindTooltip(
            // Escaped: `category` is a column header from the publicly editable
            // rule sheet, and `bindTooltip` renders HTML. See `escape-html.ts`.
            `${escapeHtml(region.category)}: ${region.cellCount} cells, ` +
              `${Math.round(region.areaM2)} m², median ${round(region.medianScore)}`,
          )
          .addTo(this.regionLayer);
      }
    }

    return scale;
  }

  describeScale = describeScale;
}

/**
 * The Leaflet style for one band (DEC-7).
 *
 * The three sub-threshold treatments must be unmistakably different from each
 * other, not merely dimmer versions of the ramp — because the reason to reveal
 * them at all is to tell a hard veto apart from "nothing is mapped here", and
 * those are opposite statements. A single faint fill for both would answer the
 * question with the same picture for either answer.
 */
function styleForBand(
  band: LegendStopKind,
  score: number,
  scale: HeatScale,
): L.PathOptions {
  // THE COLOUR AND THE KIND COME FROM THE SHARED ANSWER (W13). This function used
  // to hold its own copy of both, and the 3D grid held a third that was simply
  // wrong — every sub-threshold cell painted at the ramp's darkest stop. What
  // stays here is Leaflet's vocabulary for the two kinds, which is this view's
  // business and nobody else's.
  const treatment = bandTreatment(band, score, scale);
  if (treatment.kind === "outline") {
    // STRENGTHENED (DEC-R3-11). This was 1 px at 50 % opacity, dashed — over an
    // OSM raster basemap at zoom 18 that is close to invisible, which is most of
    // why "show cells below the threshold" read as doing nothing. It stays
    // UNFILLED, because a fill is the thing DEC-7 forbade; visibility is not.
    return {
      stroke: true,
      color: treatment.colour,
      weight: 2,
      opacity: 0.9,
      dashArray: "3 2",
      // AN INVISIBLE FILL, NOT `fill: false`, and this is a hit-testing fix
      // rather than a visual one (DEC-R3-21). An SVG path with `fill: none`
      // hit-tests only its STROKE, so an outline-only cell was clickable on a
      // 2 px border and nowhere else — which made DEC-7's own justification for
      // revealing these cells ("a hidden cell is the one cell you cannot click
      // to ask why") false for the identity band from the moment it shipped.
      // Found by the e2e written for the 3D half of the same guarantee.
      //
      // `fillOpacity: 0` paints nothing, so the band still asserts nothing.
      fill: true,
      fillOpacity: 0,
    };
  }
  return {
    stroke: false,
    fillColor: treatment.colour,
    // The ramp reads as a heat value and the two flat bands as categorical
    // statements, so the ramp keeps a slightly stronger fill.
    fillOpacity: band === "ramp" ? 0.55 : 0.5,
  };
}

/**
 * The pane the region polygons live in.
 *
 * Below Leaflet's default `overlayPane` (z-index 400), so the affordance cells
 * keep the clicks. See the constructor for why an ordering by pane rather than
 * by layer group.
 */
const REGION_PANE = "affordance-regions";

/** How many contributors the popup lists before deferring to the panel. */
const POPUP_CONTRIBUTORS = 8;

/**
 * The popup is the demo's debugging surface — and it is a POPUP for a reason.
 *
 * Provenance is the whole reason the C# reference kept a contributing-entries
 * map, and it is what turns "that cell looks wrong" into "that cell is wrong
 * BECAUSE of way/12345" in one click. This shipped as a `bindTooltip`, and
 * Leaflet tooltips are non-interactive by default — `interactive: false`, plus
 * `pointer-events: none` on `.leaflet-tooltip` — so the links this function
 * carefully builds and escapes **could never be clicked**. The demo's advertised
 * core debugging affordance had never once worked, under a green e2e suite that
 * asserted the links were *present*.
 *
 * `bindPopup` is interactive, opens on click and stays open, which is also what
 * D3 asked for independently.
 */
function popupFor(cell: CellScore, category: string, score: number): string {
  const contributors = cell.contributors[category] ?? {};
  // Ranked by |log(factor)|, so a veto always leads — see `contributor-order.ts`
  // for why the previous descending sort dropped exactly the row worth reading.
  const ranked = rankContributors(contributors).filter(
    (entry) => entry.factor !== 1,
  );

  const lines = ranked.slice(0, POPUP_CONTRIBUTORS).map((entry) => {
    // Both the href and the link text are HTML sinks. `key` is ours
    // (`featureKey`) rather than sheet-derived, so this is belt and braces —
    // but an unescaped quote in an attribute is the cheapest hole there is.
    const safeKey = escapeHtml(entry.key);
    return `<a href="https://www.openstreetmap.org/${safeKey}" target="_blank" rel="noreferrer">${safeKey}</a> × ${round(entry.factor)}`;
  });

  // NEVER a silent truncation: a shortened provenance list reads as a complete
  // one, and "these are all the elements that touched this cell" is exactly the
  // claim someone debugging a surprising score would act on.
  const hidden = ranked.length - lines.length;
  const more =
    hidden > 0
      ? `<br><em>+${hidden} more contributor${hidden === 1 ? "" : "s"}</em>`
      : "";

  return (
    // `category` comes from the publicly editable rule sheet — see
    // `escape-html.ts` for why the 20-character cap is not a mitigation.
    `<strong>${escapeHtml(category)} = ${round(score)}</strong><br>` +
    (lines.length > 0
      ? lines.join("<br>") + more
      : "<em>no rule contributed — this is the identity</em>")
  );
}

/** Multiplicative scores produce 3.6000000000000005; round for display only. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
