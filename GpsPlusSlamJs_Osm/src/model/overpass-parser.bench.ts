import { bench, describe } from "vitest";
import { parseOverpassJson } from "./overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";

/**
 * Benchmark for the Overpass parser — the package's outermost trust boundary,
 * and the first thing a click pays for.
 *
 * Why this bench matters (2026-08-30 perf loop, OSM iteration 12). The parser
 * sat in the state doc's "measured AT FIXTURE SCALE only" list with an explicit
 * prediction beside it: *"predicted to dominate a real click once measured at
 * tile scale"*. Nothing had ever measured it there. A fixture is 421–2 259
 * elements; the parse of one is a couple of milliseconds and looks free, which
 * is exactly the shape that hides a cost the user actually waits for.
 *
 * **THE COST IS LINEAR, SO THE ONLY QUESTION IS THE CONSTANT** — and the
 * constant is what fixture-scale runs cannot tell you, because at 2 259
 * elements the whole parse disappears into the noise of everything around it.
 * That is the opposite failure from `poi-hosts.bench.ts`, whose exponent is two
 * and whose danger is reasoning from the exponent with the constant wrong. Here
 * a single small scale is the trap.
 *
 * REPLICATION OFFSETS IDS the same way `poi-hosts.bench.ts` does, and for a
 * weaker reason: this parser does not join elements to each other, so shared
 * ids would not collapse anything. They are offset anyway so the replicated
 * payload stays a legal Overpass response — a fixture that could not exist is
 * a bad thing to tune against.
 *
 * Geometry is NOT shifted, unlike the mesh benches. The parser reads each
 * position independently and validates it against the lat/lng envelope; moving
 * copies around would change nothing it does and would cost the replication
 * step more than the parse being measured.
 *
 * Medians on devbox-win11 (Win 11 Pro, 11th Gen Intel i7-1185G7 @ 3.00 GHz,
 * 8 threads, Node 24.14.1) live in `overpass-parser.ts.md`, with what changed
 * and why.
 */

const SITE = "london-westminster";

/**
 * `copies` concatenations of the fixture's raw elements, ids offset per copy.
 *
 * Kept as RAW elements rather than parsed features on purpose: this is the one
 * bench in the package whose subject is the parse itself, so the input has to
 * be the untyped payload shape the network hands us.
 */
function replicate(elements: readonly unknown[], copies: number): unknown[] {
  const out: unknown[] = [];
  for (let copy = 0; copy < copies; copy++) {
    const idOffset = (copy + 1) * 1_000_000_000_000;
    for (const element of elements) {
      const record = element as { id?: number };
      out.push({ ...record, id: (record.id ?? 0) + idOffset });
    }
  }
  return out;
}

function payloadOf(copies: number): unknown {
  const site = loadSite(SITE);
  const source = site.payload as { elements: unknown[]; osm3s?: unknown };
  return {
    elements: replicate(source.elements, copies),
    osm3s: source.osm3s,
  };
}

/** One fixture: what every existing test and bench in the package parses. */
const oneSite = payloadOf(1);
/**
 * ~54 000 elements: the order a real click covers, reached by replication
 * rather than by a captured tile because no tile-scale capture is checked in
 * (the corpus is deliberately six small sites). It is a claim about SCALE, not
 * about any particular city.
 */
const tileScale = payloadOf(24);

describe("parseOverpassJson", () => {
  bench("one fixture site (2 259 elements)", () => {
    parseOverpassJson(oneSite);
  });

  bench("tile scale (54 216 elements)", () => {
    parseOverpassJson(tileScale);
  });
});
