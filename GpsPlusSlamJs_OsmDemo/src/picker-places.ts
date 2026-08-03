/**
 * The places the location picker offers — famous, photogenic, and NOT the test
 * corpus (DEC-R6b-1, DEC-R6b-2, DEC-R6b-4).
 *
 * WHY THIS IS A SECOND LIST, when DEC-R4-11 deliberately built ONE. The corpus
 * table in `gps-plus-slam-osm` earns its entries by being **awkward to render**:
 * a beach where the ground stops being ground, stacked U-Bahn tagging, a flat
 * centre. Several are deliberately unphotogenic, and the sixth testing session
 * asked for the opposite — a dropdown a visitor wants to click. Those are two
 * different jobs and one list cannot do both without one of them losing.
 *
 * WHAT REPLACES THE GUARANTEE THE ONE TABLE GAVE. DEC-R4-11's warning stands:
 * two lists drift, and the drift's cost is that the places a human can reach
 * stop being the places the suite covers. The replacement is **reachability, not
 * membership** — every corpus site stays visitable through `?site=<id>` even
 * when it is not in this list, and `start-position.test.ts` asserts that for
 * every entry in `CORPUS_SITES`. That keeps the property that actually mattered
 * while letting the dropdown drop the beach the owner did not want to see.
 *
 * WHY REACHABILITY RATHER THAN "the corpus is a subset of this list". The note
 * was unambiguous — _"Sylt auf jeden Fall rausschmeißen"_ — and a containment
 * rule stated over the dropdown would put it straight back. See the round-7 plan
 * §1 for the full argument.
 *
 * THESE ENTRIES CARRY NO FIXTURE (DEC-R6b-2), and that costs nothing at runtime:
 * `site-picker.ts` has never loaded a captured extract for any place, corpus or
 * not — serving the fixture was offered and rejected, because the demo would be
 * showing fixture data while looking identical to live data. Every choice here
 * is an ordinary cold Overpass fetch cached to OPFS, exactly as Cologne was.
 *
 * @see picker-places.ts.md
 */

import { siteById, type LatLng } from "gps-plus-slam-osm";

export interface PickerPlace {
  /** Stable, filename- and URL-safe. Accepted by `?site=`. */
  readonly id: string;
  /** Shown in the dropdown. */
  readonly name: string;
  readonly position: LatLng;
  /**
   * What you will see there, as the dropdown's tooltip.
   *
   * NOT DECORATION, and not the same field as a corpus `reason`. `site-picker`
   * renders this as `option.title`, so an entry without one is a row with no
   * tooltip sitting beside rows that have one. A corpus `reason` answers "why is
   * this hard to render"; this answers "what will I see here", which is the
   * question someone hovering a dropdown is actually asking (Q-R6b-1).
   */
  readonly note: string;
}

/**
 * Borrows a corpus site's coordinate so the two cannot drift apart.
 *
 * Only for the places that are in BOTH lists at the SAME spot — Cologne and
 * Tokyo, which the note kept. Manhattan is deliberately not one of them: the
 * picker wants the Central Park edge and the corpus coordinate may not move,
 * because its captured extract is bound to it.
 *
 * The `??` is unreachable while the id is in the table and `sites.test.ts`
 * asserts it is; it exists so a corpus edit degrades to a stale coordinate
 * rather than a module-load throw in the file whose job is to always have a
 * position.
 */
function fromCorpus(id: string, fallback: LatLng): LatLng {
  return siteById(id)?.position ?? fallback;
}

/**
 * The fourteen, Manhattan first (DEC-R6b-3, DEC-R6b-4).
 *
 * The owner named eight — Cologne, Manhattan, Tokyo, London, Paris, San
 * Francisco, Sydney, Porto — and invited "about ten more, it costs us nothing".
 * DEC-R6b-4 settled on about six more chosen for RENDERING INTEREST rather than
 * fame: each should exercise something visible — extreme relief, water, dense
 * towers, unusual tagging.
 *
 * FLAT, not `<optgroup>`ed. Nothing distinguishes a corpus site from a
 * picker-only one, deliberately: per DEC-R6b-2 they behave identically, so a
 * visible split would advertise an internal distinction the visitor cannot act
 * on.
 *
 * The coordinates are this file's call. The SELECTION is the owner's.
 *
 * **NO TEST CAN CHECK A COORDINATE, and it is worth knowing why before trusting
 * a green run.** The suite asserts these positions are on Earth, unique, and not
 * one of the three places the owner removed — none of which catches a digit
 * typed wrong. `rome-colosseum` shipped at 41.809 in this file's first revision,
 * 9 km south of the Colosseum and comfortably inside every assertion. Anything
 * tighter would just be the coordinate written twice, agreeing with itself.
 *
 * What actually catches it is the `note`: it says what you should SEE on
 * arrival, so a wrong coordinate presents as "the tooltip promised the Colosseum
 * and there is no Colosseum here". That is a reason to keep the notes concrete
 * about landmarks rather than atmospheric.
 */
export const PICKER_PLACES: readonly PickerPlace[] = [
  {
    id: "manhattan-central-park",
    name: "New York — Central Park South",
    // The park's south-west corner, by Columbus Circle. NOT the corpus
    // `manhattan-midtown` coordinate (~2 km south): DEC-R6b-3 asked for the
    // park in the opening frame, and the corpus position may not move without
    // invalidating its captured extract.
    position: { lat: 40.7677, lng: -73.9807 },
    note: "The park edge at Columbus Circle: open greenery, water and the Midtown skyline behind it — the densest tagged high-rise anywhere.",
  },
  {
    id: "cologne-cathedral",
    name: "Cologne — Cathedral",
    position: fromCorpus("cologne-cathedral", { lat: 50.9413, lng: 6.9583 }),
    note: "A cruciform Gothic cathedral modelled as dense building:part with pyramidal spires — the hardest single building in the demo.",
  },
  {
    id: "tokyo-shinjuku",
    name: "Tokyo — Shinjuku",
    position: fromCorpus("tokyo-shinjuku", { lat: 35.6896, lng: 139.7006 }),
    note: "A tagging culture no European fixture exercises: multilingual names, different building values, and towers packed around the world's busiest station.",
  },
  {
    id: "london-tower-bridge",
    name: "London — Tower Bridge",
    position: { lat: 51.5055, lng: -0.0754 },
    note: "Two masonry towers over the Thames with a road deck between them — a bridge tagged as a landmark rather than as a way.",
  },
  {
    id: "london-westminster",
    name: "London — Westminster",
    position: { lat: 51.5007, lng: -0.1246 },
    note: "The Palace of Westminster and the Elizabeth Tower: a long, finely subdivided riverside frontage of building:part.",
  },
  {
    id: "paris-eiffel-tower",
    name: "Paris — Eiffel Tower",
    position: { lat: 48.8584, lng: 2.2945 },
    note: "A 330 m open lattice tower on the Champ de Mars — tagged height with almost no volume, the opposite of a city block.",
  },
  {
    id: "san-francisco-golden-gate",
    name: "San Francisco — Golden Gate",
    position: { lat: 37.8199, lng: -122.4783 },
    note: "The bridge across the strait, with the Marin headlands rising straight out of the water — big relief and a coastline in one frame.",
  },
  {
    id: "sydney-opera-house",
    name: "Sydney — Opera House",
    position: { lat: -33.8568, lng: 151.2153 },
    note: "Shell vaults on a harbour promontory, water on three sides — the coastline case, at a building that is almost all roof.",
  },
  {
    id: "porto-ribeira",
    name: "Porto — Ribeira",
    position: { lat: 41.1408, lng: -8.6116 },
    note: "A medieval quarter stacked up a gorge wall above the Douro: tens of metres of relief between adjacent streets.",
  },
  {
    id: "rome-colosseum",
    name: "Rome — Colosseum",
    position: { lat: 41.8902, lng: 12.4922 },
    note: "A ring of tiered arcades with a hollow centre — a large multipolygon whose interior is genuinely a hole.",
  },
  {
    id: "barcelona-sagrada-familia",
    name: "Barcelona — Sagrada Família",
    position: { lat: 41.4036, lng: 2.1744 },
    note: "Eighteen spires of wildly different heights on one footprint, inside Eixample's perfectly regular chamfered grid.",
  },
  {
    id: "venice-san-marco",
    name: "Venice — San Marco",
    position: { lat: 45.4341, lng: 12.3388 },
    note: "Where the ground is mostly water: canals, quays and a campanile, with almost no road network in the usual sense.",
  },
  {
    id: "hong-kong-central",
    name: "Hong Kong — Central",
    position: { lat: 22.2819, lng: 114.1585 },
    note: "Supertall towers packed against a mountain that climbs 500 m directly behind them — dense high-rise and extreme relief together.",
  },
  {
    id: "rio-sugarloaf",
    name: "Rio de Janeiro — Sugarloaf",
    position: { lat: -22.9492, lng: -43.1545 },
    note: "A granite monolith rising 400 m straight out of the bay — the steepest ground the demo can be pointed at.",
  },
];

/**
 * A place by id, or `undefined`.
 *
 * `undefined` rather than a throw, for the same reason as `siteById` and
 * `parseStartPosition`: the id arrives from a URL, and an unrecognised one means
 * "fall back to the default position", not "the app is broken". A stale bookmark
 * must not be an error page.
 */
export function placeById(id: string): PickerPlace | undefined {
  return PICKER_PLACES.find((place) => place.id === id);
}
