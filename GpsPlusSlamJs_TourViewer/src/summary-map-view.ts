/**
 * The summary's map (authoring plan 2026-09-28-0953 §3.3, milestone M3b):
 * the model of `summary-model.ts` drawn with Leaflet, through the
 * framework's summary map shell (moved out of the Recorder, DEC-H3).
 *
 * LOADED ONLY BY A DYNAMIC IMPORT (`summary-panel.ts`): this module is the
 * one place the Tour Viewer imports Leaflet, its CSS and the shell, so a
 * visitor - who never reaches a Finish - never downloads any of them
 * (`summary-map-lazy.test.ts` holds the import graph to that).
 *
 * @see summary-map-view.ts.md
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { drawMapData } from "gps-plus-slam-app-framework/visualization/map-overlay-draw";
import {
  createSummaryMapShell,
  type SummaryMapShell,
} from "gps-plus-slam-app-framework/visualization/summary-map-shell";

import type { CodeMark, SummaryCode, SummaryModel } from "./summary-model.js";

/** The code's colour: apart from the yellow GPS track and the cyan fused
 *  path the shared overlay draws. */
export const CODE_COLOR = "#d81b60";
/** The placed objects' colour. */
export const OBJECT_COLOR = "#ffffff";

/** The fullscreen toggle, styled by the page's own CSS (`index.html`). */
const FULLSCREEN = {
  expandedClasses: ["summary-map-expanded"],
  inlineClasses: [],
  buttonClassName: "btn summary-map-toggle",
  hiddenClass: "summary-map-toggle-hidden",
} as const;

/** A permanent label, its text set as text (labels are user input from a
 *  zip: never markup). */
function label(doc: Document, text: string): HTMLElement {
  const span = doc.createElement("span");
  span.textContent = text;
  return span;
}

/** A code's dot (filled for the stored pose, hollow for the estimate) and
 *  its facing line; the dot carries `tag` as its permanent label. */
function codeMarkLayers(
  map: L.Map,
  m: CodeMark,
  kind: "reference" | "estimate",
  tag: HTMLElement | null,
): L.Layer[] {
  const estimate = kind === "estimate";
  const layers: L.Layer[] = [];
  if (m.facingLine !== null) {
    layers.push(
      L.polyline(
        m.facingLine.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        {
          color: CODE_COLOR,
          weight: estimate ? 3 : 5,
          opacity: 0.95,
          ...(estimate ? { dashArray: "6 6" } : {}),
          className: estimate
            ? "tv-summary-estimate-facing"
            : "tv-summary-facing",
        },
      ).addTo(map),
    );
  }
  const dot = L.circleMarker([m.lat, m.lng], {
    radius: 7,
    color: CODE_COLOR,
    weight: 3,
    fillColor: estimate ? "#ffffff" : CODE_COLOR,
    fillOpacity: estimate ? 0.4 : 1,
    className: estimate ? "tv-summary-estimate" : "tv-summary-code",
  });
  if (tag !== null) {
    dot.bindTooltip(tag, {
      permanent: true,
      direction: "right",
      offset: [8, 0],
      className: "tv-summary-label tv-summary-code-label",
    });
  }
  layers.push(dot.addTo(map));
  return layers;
}

/** An uncertainty ring: solid for the stored pose (what visitors get),
 *  dashed for the visits' estimate. */
function ring(
  map: L.Map,
  at: { lat: number; lng: number },
  radiusM: number,
  kind: "reference" | "estimate",
): L.Layer {
  return L.circle([at.lat, at.lng], {
    radius: radiusM,
    color: CODE_COLOR,
    weight: 2,
    fill: false,
    ...(kind === "estimate" ? { dashArray: "4 6" } : {}),
    className:
      kind === "estimate" ? "tv-summary-estimate-ring" : "tv-summary-ring",
  }).addTo(map);
}

/** The stored pose's own ring when known (M3a/M3b review #2); the
 *  estimate's where the estimate is drawn, or where nothing else says how
 *  far off the code may be. */
function ringLayers(map: L.Map, code: SummaryCode): L.Layer[] {
  const c = code.combined;
  const r = code.reference;
  const storedRingM = r?.ringM ?? null;
  const layers: L.Layer[] = [];
  if (c !== null && (c.shown || storedRingM === null)) {
    layers.push(ring(map, c, c.ringM, "estimate"));
  }
  if (r !== null && storedRingM !== null) {
    layers.push(ring(map, r, storedRingM, "reference"));
  }
  return layers;
}

function codeLayers(map: L.Map, code: SummaryCode, doc: Document): L.Layer[] {
  const layers: L.Layer[] = ringLayers(map, code);
  const c = code.combined;
  // The label goes on the stored pose, else on the estimate.
  const tag = label(doc, `${code.label}: ${code.verdict.text}`);
  if (c !== null && c.shown) {
    layers.push(
      ...codeMarkLayers(
        map,
        c,
        "estimate",
        code.reference === null ? tag : null,
      ),
    );
  }
  if (code.reference !== null) {
    layers.push(...codeMarkLayers(map, code.reference, "reference", tag));
  }
  return layers;
}

/**
 * Every layer the summary draws over the basemap: each visit's walk (the
 * framework's shared trajectory drawing, one call per visit so visits are
 * never joined), each code, each pin and photo with its label.
 */
export function drawSummaryLayers(
  map: L.Map,
  model: SummaryModel,
  doc: Document,
): L.Layer[] {
  const layers: L.Layer[] = [];
  for (const track of model.tracks) {
    layers.push(
      ...drawMapData(map, {
        userPosition: null,
        rawGpsPath: [...track.gps],
        fusedPath: [...track.fused],
        alignmentSnapshots: [],
      }).layers,
    );
  }
  for (const object of model.objects) {
    layers.push(
      L.circleMarker([object.lat, object.lng], {
        radius: 5,
        color: "#222222",
        weight: 2,
        fillColor: OBJECT_COLOR,
        fillOpacity: 1,
        className: `tv-summary-${object.kind}`,
      })
        .bindTooltip(label(doc, object.label), {
          permanent: true,
          direction: "top",
          offset: [0, -6],
          className: "tv-summary-label tv-summary-object-label",
        })
        .addTo(map),
    );
  }
  for (const code of model.codes) layers.push(...codeLayers(map, code, doc));
  return layers;
}

/** Draw the summary map in `container`; null when there is nothing to
 *  frame or Leaflet refused (the shell logs why). */
export function drawSummaryMap(
  container: HTMLElement,
  model: SummaryModel,
): SummaryMapShell | null {
  return createSummaryMapShell(
    container,
    { rawGpsPath: [], fusedPath: [] },
    {
      fitPoints: model.fitPoints,
      drawExtra: (map) => drawSummaryLayers(map, model, document),
      fullscreen: FULLSCREEN,
    },
  );
}
