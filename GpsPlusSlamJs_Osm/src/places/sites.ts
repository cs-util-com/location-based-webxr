/**
 * The corpus of places the demo is tested at — ONE table, two consumers.
 *
 * WHY THIS EXISTS (DEC-R4-1, DEC-R4-2, DEC-R4-11). For three rounds the demo was
 * looked at in exactly one spot, and that is the condition that produced the
 * round-3 cathedral finding: an item shipped a fix for a defect that was not the
 * reported one, because nothing could reproduce the reported one. The answer is
 * a small set of places chosen for **what makes them awkward**, not for coverage.
 *
 * WHY ONE TABLE RATHER THAN TWO. The offline fixture suite needs a place to
 * capture an extract for; the demo's location picker needs a place to offer a
 * human. Those were nearly built as two lists — and two lists drift, so the
 * places you can *see* stop being the places that are *tested*, which is exactly
 * the blind spot this corpus exists to remove. One table, and the picker and the
 * capture script both read it.
 *
 * WHY THE `reason` FIELD IS NOT DECORATION. "Why is this place in the corpus" is
 * the first thing lost and the hardest to recover: a later reader looking at six
 * coordinates cannot tell whether a site may be swapped for a prettier one. The
 * `trait` makes that machine-checkable, the `reason` makes it human-readable, and
 * `sites.test.ts` asserts both.
 *
 * THIS TABLE IS NOT A LIST OF NICE VIEWS. Several entries are deliberately
 * unphotogenic. A site earns its place by being hard to render correctly.
 *
 * @see sites.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";

/**
 * What a site is in the corpus FOR. Exactly one per site, and the union is
 * closed — adding a seventh kind of awkwardness is a decision, not an edit.
 */
export type CorpusTrait =
  /** Dense `building:part` with pyramidal spires — the open R3-1/R4-7 finding. */
  | "landmark-parts"
  /** Real terrain relief, which Cologne's flat centre cannot exercise. */
  | "relief"
  /** Multipolygon buildings, tunnels, `layer` values — F16's answer. */
  | "messy-tagging"
  /** `natural=coastline`, where the ground stops being ground. */
  | "coastline"
  /** Tall buildings packed together, the worst case for the far field. */
  | "dense-highrise"
  /** A tagging culture that is not the one every fixture so far was captured in. */
  | "non-european-tagging";

export interface CorpusSite {
  /** Stable, filename- and URL-safe. Becomes `testdata/sites/<id>.json`. */
  readonly id: string;
  /** Shown in the demo's location picker. */
  readonly name: string;
  readonly position: LatLng;
  readonly trait: CorpusTrait;
  /** Why this place is in the corpus, in a sentence a later reader can act on. */
  readonly reason: string;
  /**
   * H3 resolution of the captured extract.
   *
   * PER-SITE, and that is a measurement rather than a preference. A res-10 cell
   * is ~114 m across the flats and Cologne Cathedral's footprint is 144 x 86 m —
   * so the one site the corpus exists for does not fit in the resolution the
   * rest of the corpus uses, and capturing it at res 10 would produce an extract
   * that clips the building whose clipping is under investigation.
   */
  readonly captureRes: number;
}

/**
 * The six, per DEC-R4-2.
 *
 * The owner was offered a narrower "Cologne plus relief plus messy tagging" and
 * went wider, accepting the cost: each extract is committed bytes and a
 * maintenance surface, and nothing yet says the extra sites find anything. The
 * reason to accept it anyway is that three rounds of single-site testing is what
 * produced the finding this corpus is chasing.
 *
 * The coordinates are this file's call rather than the owner's (the plan marked
 * them `[decided here]` and said so); the TRAITS are the owner's and are binding.
 */
export const CORPUS_SITES: readonly CorpusSite[] = [
  {
    id: "cologne-cathedral",
    name: "Cologne Cathedral",
    position: { lat: 50.9413, lng: 6.9583 },
    trait: "landmark-parts",
    reason:
      "Dense building:part with pyramidal spires on a strongly cruciform outline — the open R3-1/R4-7 finding, which three rounds have not reproduced offline.",
    // Res 9 (~348 m across) rather than the corpus default: the footprint is
    // 144 x 86 m and does not fit a res-10 cell. See `captureRes`.
    captureRes: 9,
  },
  {
    id: "heidelberg-altstadt",
    name: "Heidelberg Altstadt",
    position: { lat: 49.4118, lng: 8.7106 },
    trait: "relief",
    reason:
      "The old town sits under a castle hillside with tens of metres of relief inside one tile — the terrain case Cologne's flat centre cannot exercise, and where per-part building bases actually differ.",
    captureRes: 10,
  },
  {
    id: "berlin-alexanderplatz",
    name: "Berlin Alexanderplatz",
    position: { lat: 52.5219, lng: 13.4132 },
    trait: "messy-tagging",
    reason:
      "Stacked U-Bahn and S-Bahn infrastructure with real `layer`, `tunnel` and `covered` values over multipolygon buildings — the site F16 needs, since `plates.ts` handles none of those tags today.",
    captureRes: 10,
  },
  {
    id: "sylt-westerland",
    name: "Sylt — Westerland beach",
    position: { lat: 54.9079, lng: 8.2946 },
    trait: "coastline",
    reason:
      "`natural=coastline` with `natural=beach` and `surface=sand` behind it — where the ground stops being ground, and already the package's surface oracle as the `beach` fixture.",
    captureRes: 10,
  },
  {
    id: "manhattan-midtown",
    name: "Manhattan — Midtown",
    position: { lat: 40.7549, lng: -73.984 },
    trait: "dense-highrise",
    reason:
      "Tall buildings packed at a density no European centre reaches — the worst case for the far field, for the draw-call budget, and for buildings whose tagged height dwarfs everything around them.",
    captureRes: 10,
  },
  {
    id: "tokyo-shinjuku",
    name: "Tokyo — Shinjuku",
    position: { lat: 35.6896, lng: 139.7006 },
    trait: "non-european-tagging",
    reason:
      "A different tagging culture: multilingual names, different amenity and building value distributions, and address conventions no fixture captured in Germany exercises.",
    captureRes: 10,
  },
];

/**
 * A site by id, or `undefined`.
 *
 * `undefined` rather than a throw, deliberately: the id is a candidate for a URL
 * parameter, and an unrecognised one means "fall back to the default position",
 * not "the app is broken". The same reasoning as `parseStartPosition`.
 */
export function siteById(id: string): CorpusSite | undefined {
  return CORPUS_SITES.find((site) => site.id === id);
}
