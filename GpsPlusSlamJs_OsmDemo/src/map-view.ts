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

import { AttributionView, type AttributionEntry } from "./attribution-view.js";
import { cellToBoundary } from "h3-js";
import type { CellScore, GeoEvent, LatLng, Region } from "gps-plus-slam-osm";

import { describeEventTime } from "./event-label.js";
import { describeScale, type HeatScale } from "./heat-colours.js";
import { tileBounds } from "./fetch-extent.js";
import { escapeHtml } from "gps-plus-slam-app-framework/utils/escape-html";
import { regionStyle } from "./region-style.js";
import { QUEST_MARKER_PX, questMarkerSvg } from "./quest-marker.js";
import {
  FETCH_BOX_COLOUR,
  GEO_CANDIDATE_COLOUR,
  UNDERGROUND_COLOUR,
  USER_POSITION_COLOUR,
  cssColour,
} from "./surface-colours.js";
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

/**
 * The OSM credit as the attribution line renders it: a permanently visible
 * short name, with the full sentence behind the expander (DEC-W1).
 */
const OSM_ENTRY: AttributionEntry = {
  short: "OpenStreetMap",
  full: OSM_ATTRIBUTION,
  href: "https://www.openstreetmap.org/copyright",
};

export interface MapViewOptions {
  readonly container: HTMLElement;
  readonly centre: { lat: number; lng: number };
  readonly zoom?: number;
  /** Called with the H3 id when a cell is clicked. */
  readonly onCellClick?: (cell: string) => void;
  /**
   * Called with the region id when a region is clicked (DEC-R7b-3a).
   *
   * Separate from `onCellClick` rather than one "something was selected"
   * callback, because the two carry different identifiers and the panel renders
   * them differently. Leaflet delivers the cell click first where they overlap —
   * the cell pane sits above the region pane — so the finer claim wins here for
   * the same reason it does in the 3D raycast.
   */
  readonly onRegionClick?: (region: string) => void;
}

export class MapView {
  readonly map: L.Map;
  private readonly cellLayer: L.LayerGroup;
  private readonly regionLayer: L.LayerGroup;
  private readonly fetchLayer: L.LayerGroup;
  private readonly undergroundLayer: L.LayerGroup;
  private readonly eventLayer: L.LayerGroup;
  private readonly userMarker: L.CircleMarker;
  private readonly onCellClick: ((cell: string) => void) | undefined;
  private readonly onRegionClick: ((region: string) => void) | undefined;
  /**
   * The attribution line, which this class owns rather than Leaflet.
   *
   * See `attribution-view.ts` for why: Leaflet's own control rebuilds its
   * `innerHTML` on every credit change, which happens on every terrain apply,
   * so an expander could not survive inside it.
   */
  private readonly attribution = new AttributionView();

  /**
   * Keeps Leaflet's CACHED container size honest.
   *
   * Leaflet measures the container once, in `L.map(...)`, and reuses that
   * size for every projection afterwards. `trackResize` (on by default)
   * refreshes it on a WINDOW resize only — a container that changes size
   * because this page's own layout changed never reaches it.
   *
   * That is not hypothetical here. Measured 2026-08-21: the cache was ~122 px
   * TALLER than the real container, so `setView` centred its target at
   * `cachedHeight / 2` and left it **61 px below the visible centre** — every
   * pan, every `centreOn`, and the initial view. It surfaced as a geo-event
   * quest that landed near the middle instead of in it, and it had been
   * invisible because the e2e that measures exactly this allowed 80 px.
   *
   * Held as a field so a future `dispose` can disconnect it; there is no
   * teardown path on this view today, and the observer lives as long as the
   * map does.
   */
  private readonly containerResize: ResizeObserver | undefined;

  /**
   * FORENSICS FOR THE GEO-EVENT SETTLE FLAKE, not a feature (docs:
   * `2026-08-26-0105-osm-demo-geo-event-settle-flake-followup.md` — the
   * owner-approved instrumentation step). Failing runs report the winner
   * marker stuck at exactly HALF a recent `#map` height delta for a full
   * 15 s poll, which the one-frame `invalidateSize` model cannot explain —
   * it predicts the observer corrects it. This records whether the
   * callback actually fired (count), what sizes it saw (bounded history),
   * and when it last invalidated, so the NEXT failing run is attributable
   * instead of guessed at — the spec's history holds two failed guesses
   * already. Exposed to the e2e via `globalThis.__osmDemoMapDiagnostics`;
   * remove both together once the flake is explained and fixed.
   */
  private readonly resizeDiagnostics: {
    fires: number;
    lastInvalidateAt: number | null;
    history: { t: number; w: number; h: number }[];
  } = { fires: 0, lastInvalidateAt: null, history: [] };

  constructor(options: MapViewOptions) {
    this.onCellClick = options.onCellClick;
    this.onRegionClick = options.onRegionClick;
    this.map = L.map(options.container, {
      // OFF, because this view supplies its own (DEC-W1, finding F5). Leaflet's
      // default control also carries a courtesy "Leaflet" prefix link, which
      // the thirteenth session asked to drop — switching the control off
      // disposes of both in one move rather than needing `setPrefix(false)` as
      // a second mechanism.
      attributionControl: false,
    }).setView([options.centre.lat, options.centre.lng], options.zoom ?? 18);

    // Observed rather than called once: the layout that made the cache stale
    // settles AFTER construction, and anything that resizes the map later
    // (an opening panel, an orientation change) has the same effect. The
    // observer fires immediately with the current size, so it also corrects
    // whatever `L.map` measured a moment ago.
    //
    // Guarded because ResizeObserver does not exist in the jsdom environment
    // the unit tests run in — the guard is what keeps this file importable
    // there, not a claim that browsers might lack it.
    this.containerResize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver((entries) => {
            // Diagnostics BEFORE the correction, so a callback that throws
            // still leaves its trace. See the docblock on `resizeDiagnostics`.
            this.resizeDiagnostics.fires += 1;
            const rect = entries[0]?.contentRect;
            if (rect !== undefined) {
              this.resizeDiagnostics.history.push({
                t: Math.round(performance.now()),
                w: rect.width,
                h: rect.height,
              });
              if (this.resizeDiagnostics.history.length > 20) {
                this.resizeDiagnostics.history.shift();
              }
            }
            this.map.invalidateSize();
            this.resizeDiagnostics.lastInvalidateAt = Math.round(
              performance.now(),
            );
          });
    this.containerResize?.observe(options.container);
    // The e2e reads this on a settle-poll timeout — production behaviour is
    // unchanged; only the trace is exposed.
    (
      globalThis as { __osmDemoMapDiagnostics?: unknown }
    ).__osmDemoMapDiagnostics = {
      resize: this.resizeDiagnostics,
      leafletSize: () => {
        const size = this.map.getSize();
        return { w: size.x, h: size.y };
      },
      containerSize: () => {
        const rect = options.container.getBoundingClientRect();
        return { w: rect.width, h: rect.height };
      },
    };

    // ADDED FIRST OF THIS CORNER'S CONTROLS, and that is load-bearing rather
    // than incidental. Leaflet PREPENDS into a bottom corner
    // (`corner.insertBefore(container, corner.firstChild)`), so the first
    // control registered ends up lowest — which is where a credit belongs, with
    // the AR and locate buttons stacking above it and never over it. An e2e
    // asserts that relationship by bounding-box arithmetic.
    const AttributionControl = L.Control.extend({
      onAdd: (): HTMLElement => {
        // Without this a tap on the expander also reaches the map underneath
        // and reads as "the user clicked here to move" — the same guard
        // `locate-control.ts` needs for the same reason.
        L.DomEvent.disableClickPropagation(this.attribution.element);
        return this.attribution.element;
      },
    });
    new AttributionControl({ position: "bottomright" }).addTo(this.map);
    this.attribution.setEntries([OSM_ENTRY]);

    // NO `attribution` OPTION HERE ANY MORE. It fed Leaflet's control, which is
    // switched off above, so leaving it would be a credit that looks declared
    // and renders nowhere. `OSM_ENTRY` is where the obligation is actually met.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
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
    this.undergroundLayer = L.layerGroup().addTo(this.map);
    this.eventLayer = L.layerGroup().addTo(this.map);

    this.userMarker = L.circleMarker([options.centre.lat, options.centre.lng], {
      radius: 6,
      color: "#ffffff",
      weight: 2,
      // BLUE, not the red it shared with three other things (G8). The white
      // ring stays: it is what keeps the dot readable over both the dark
      // basemap and a saturated heat cell.
      fillColor: cssColour(USER_POSITION_COLOUR),
      fillOpacity: 1,
      // DECORATIVE, like every other vector in this view. Leaflet's default for
      // a `circleMarker` is interactive, which gives it `pointer-events: auto`
      // with nothing bound — so a click landing on it was SWALLOWED rather than
      // reaching the map handler that moves the user, and this marker sits on
      // the one spot they are most likely to click. The three markers below
      // already say this explicitly; the omission here was the odd one out
      // (#267 review).
      //
      // NOT left to the paint order, which currently hides it: this marker is
      // built in the constructor and every cell is added later by `render()`,
      // so the cells happen to cover it. That is an accident of construction
      // sequence, and one `bringToFront()` or a move to another pane undoes it.
      interactive: false,
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
   * Adds or removes the elevation sources' credits in the attribution line.
   *
   * WHY IT LIVES HERE RATHER THAN IN THE HEADER (DEC-R2-4). The header became
   * collapsible, and **attribution may not be collapsed away** — it is required
   * wherever the data is shown. The attribution line is always visible and is
   * where a credit conventionally goes.
   *
   * WHAT "NOT COLLAPSED AWAY" MEANS SINCE ROUND THREE (DEC-W1). The line got an
   * expander, and the elevation credits stay OUTSIDE it: each source keeps a
   * permanently visible short name and only its long sentence is behind the
   * tap. These credits are required "the same as the OSM one", so a design that
   * hid them until tapped would contradict the paragraph above.
   *
   * An EMPTY list removes them, which matters: crediting a DEM source whose
   * tiles all failed would be a claim about what is on screen. Idempotent, so a
   * run of failed loads does not need to track what it added.
   */
  setTerrainAttribution(entries: readonly AttributionEntry[]): void {
    this.attribution.setEntries([OSM_ENTRY, ...entries]);
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
    this.map.setView([position.lat, position.lng], this.map.getZoom(), {
      animate: false,
    });
  }

  /**
   * Slides the viewport to `position` WITHOUT claiming the user is there.
   *
   * THE DIFFERENCE FROM {@link centreOn} IS THE WHOLE POINT, and reusing that
   * one here would be a live bug: it calls {@link setPosition} first, so panning
   * to a quest would also teleport the user's own marker onto it. `centreOn` is
   * for a DECLARED place change (the location picker), where moving the marker
   * is exactly right; this is for looking somewhere.
   *
   * Same zoom, deliberately (DEC-U12). Keeping it is what makes this a pan
   * rather than the viewport takeover F56 declined.
   */
  panTo(position: { lat: number; lng: number }): void {
    // `animate: false` ON BOTH PROGRAMMATIC PANS, and it is a bug fix, not a
    // taste choice (settle-flake forensics, 2026-08-26 — the followup doc in
    // the primary repo holds the captures). At the same zoom Leaflet runs
    // setView as an ANIMATED pan (~250 ms) whose end transform is
    // precomputed. When the container resizes inside that window — the
    // status line reflowing as a search completes does exactly that — the
    // ResizeObserver's `invalidateSize` compensation is a raw pane shift
    // that the animation's end state then OVERWRITES, leaving the target
    // exactly half the resize delta off centre, permanently (measured
    // 21.17 px, 11 of 30 soak runs). An instant pan has no window to lose.
    this.map.setView([position.lat, position.lng], this.map.getZoom(), {
      animate: false,
    });
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
   *
   * THE EVENT LAYER IS DELIBERATELY NOT HERE, which is a change of mechanism
   * rather than an omission (W2). A geo-event is not derived from a snapshot, so
   * it is not this method's business: it is a projection of `geoEvent` in the
   * store, and `fetchFailed` — the only action that makes the snapshot
   * `undefined` and therefore the only route to this method — clears that field
   * too. Adding `eventLayer.clearLayers()` here would be a SECOND mechanism for
   * one piece of state, and the two could only ever disagree. It was previously
   * missing here for the ordinary reason: nobody had thought about it.
   */
  clear(): void {
    this.cellLayer.clearLayers();
    this.regionLayer.clearLayers();
    this.fetchLayer.clearLayers();
    // The underground features describe the same scored working set as the
    // cells do — they are the features that set EXCLUDED — so leaving them up
    // after a failed refresh is the same defect this method exists to prevent.
    this.undergroundLayer.clearLayers();
  }

  /**
   * Draws a geo-event: the candidates it weighed, and the one it chose.
   *
   * WHY THE DECIDING BATCH AND NOT ALL 100 (DEC-R9-8). The algorithm stops at
   * the first batch with a passing candidate, so those ten plus the winner are
   * the honest picture of what it actually did — about eleven markers rather
   * than four hundred, on a map whose cell layer was defaulted off for exactly
   * that cost.
   *
   * GOLD, AND THE WINNER IS A GLYPH (DEC-G6). It was red circles for both, which
   * collided with the user dot and the fetch boxes and gave the answer the same
   * weight as the nine draws it beat. The heat ramp is Viridis — purple through
   * yellow with no warm hues — so gold cannot be mistaken for a score either,
   * and the candidates keep the hue at lower strength so "these produced that"
   * still reads. `marker-palette.test.ts` pins both halves.
   */
  renderGeoEvent(event: GeoEvent | undefined): void {
    this.eventLayer.clearLayers();
    if (event === undefined) return;

    for (const pick of event.picks) {
      for (const candidate of pick.evaluated) {
        L.circleMarker([candidate.lat, candidate.lng], {
          radius: 3,
          className: "geo-candidate",
          fillColor: cssColour(GEO_CANDIDATE_COLOUR),
          interactive: false,
        }).addTo(this.eventLayer);
      }
      // The winner last, so it draws over its own batch — at the SETTLED
      // position, not the seed it climbed away from. Drawing `candidate` here
      // while the tooltip quoted `cell`'s heat put the marker tens of metres
      // from the place whose heat it was reporting.
      //
      // AN `L.marker` WITH A `divIcon`, NOT A `circleMarker`, and that is forced
      // rather than chosen: a `circleMarker` is an SVG `<path>` and no amount of
      // CSS turns a path into a glyph. The class name is kept so the e2e still
      // selects on `.geo-winner`, and the tooltip binds the same way.
      L.marker([pick.position.lat, pick.position.lng], {
        icon: L.divIcon({
          className: "geo-winner",
          html: questMarkerSvg(),
          iconSize: [QUEST_MARKER_PX, QUEST_MARKER_PX],
          // CENTRED ON THE POSITION, unlike Leaflet's default pin, whose anchor
          // is its tip. This icon is a disc, so anchoring it at the top-left —
          // the default when `iconAnchor` is omitted — would put the event half
          // a marker north-west of where it actually is.
          iconAnchor: [QUEST_MARKER_PX / 2, QUEST_MARKER_PX / 2],
        }),
      })
        // THROUGH THE SAME FORMATTER THE BUTTON USES. This was a second inline
        // `toLocaleTimeString`, so once the picker could ask for another day
        // (W6) the button would have said "9 Aug 18:15" while the marker beside
        // it said "18:15:00" — two views of one instant disagreeing about which
        // day it is, which is the class of drift `describeEventTime` exists to
        // remove.
        .bindTooltip(
          `event at ${describeEventTime(event.eventTime)} · heat ${Math.round(pick.heat)}`,
        )
        .addTo(this.eventLayer);
    }
  }

  /**
   * Draws the features `isBelowSurface` excluded from scoring and the mesh.
   *
   * WHY THE MAP AND NOT ONLY THE 3D VIEW. This answers WHERE the excluded ground
   * is — whether the thing that vanished is the U-Bahn line under the street or
   * something that was on the surface all along. The 3D view answers what SHAPE
   * it was. Neither answers the other's question, which is why both draw it.
   *
   * Dashed and in `UNDERGROUND_COLOUR`, because the whole point is comparing it
   * against what remains: a solid fill would read as another affordance
   * overlay. The colour is SHARED WITH THE 3D VIEW rather than written twice —
   * this view previously carried only a `className` with no CSS rule behind it,
   * so Leaflet drew its default blue while the docs claimed otherwise.
   */
  renderUnderground(outlines: readonly (readonly LatLng[])[]): void {
    this.undergroundLayer.clearLayers();

    for (const outline of outlines) {
      if (outline.length === 0) continue;
      const points = outline.map(
        (point) => [point.lat, point.lng] as [number, number],
      );
      // A single point is a node, which has no outline to trace — drawn as a
      // marker so it is visible at all rather than silently skipped.
      if (points.length === 1) {
        L.circleMarker(points[0] as [number, number], {
          radius: 4,
          className: "underground-feature",
          color: cssColour(UNDERGROUND_COLOUR),
          interactive: false,
        }).addTo(this.undergroundLayer);
        continue;
      }
      L.polyline(points, {
        className: "underground-feature",
        color: cssColour(UNDERGROUND_COLOUR),
        weight: 2,
        dashArray: "4 3",
        interactive: false,
      }).addTo(this.undergroundLayer);
    }
  }

  /**
   * Draws what was actually downloaded: one red box per fetch tile.
   *
   * (This block sat above `renderGeoEvent`'s own docstring for several rounds,
   * describing a method two screens away. Moved back to the method it is about.)
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
          color: cssColour(FETCH_BOX_COLOUR),
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
        color: cssColour(FETCH_BOX_COLOUR),
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
            // rule sheet, and `bindTooltip` renders HTML. See the framework’s
            // `escape-html.ts`.
            `${escapeHtml(region.category)}: ${region.cellCount} cells, ` +
              `${Math.round(region.areaM2)} m², median ${round(region.medianScore)}`,
          )
          .on("click", (event) => {
            // STOP THE MAP SEEING IT. The map's own click handler moves the
            // user, and a region covers most of the screen — without this,
            // selecting a region would also teleport you into it.
            L.DomEvent.stopPropagation(event);
            this.onRegionClick?.(region.id);
          })
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
    // the framework’s `escape-html.ts` for why the 20-character cap is not a
    // mitigation.
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
