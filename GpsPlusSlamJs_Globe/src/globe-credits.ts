/**
 * The credits for the imagery on screen (globe plan 2026-09-26-0539 §7.7):
 * one entry per credit, in registry order, whatever order the sources
 * arrive in, so the credits line never reorders as tiles load.
 *
 * @see globe-credits.ts.md
 */

import {
  GIBS_ACKNOWLEDGEMENT,
  GLOBE_SOURCES,
  globeSource,
  type GlobeCredit,
  type GlobeSourceId,
} from "./globe-sources.js";

/**
 * The credits for `ids`, merged by their short name, in registry order.
 *
 * @throws RangeError for an id the registry does not have.
 */
export function creditsFor(ids: readonly GlobeSourceId[]): GlobeCredit[] {
  const wanted = new Set(ids.map((id) => globeSource(id).credit.short));
  const credits: GlobeCredit[] = [];
  for (const source of GLOBE_SOURCES) {
    const { short, full, href } = source.credit;
    if (wanted.has(short) && !credits.some((c) => c.short === short)) {
      credits.push({ short, full, href });
    }
  }
  return credits;
}

/**
 * The stars are generated, not a catalogue (round-2 plan Q2: no catalogue
 * with a clearly public-domain or attribution-only licence was found), and
 * the credits line says so.
 */
export const PROCEDURAL_STARS = "Stars: procedural, not a star catalogue.";

/** The credits line's parts: the one-line summary and the linked list. */
export interface GlobeCreditsLine {
  /** The short names over the canvas: imagery, stars, heights, the map. */
  readonly summary: string;
  /** Every credit with a link, in the order shown: imagery, heights, map. */
  readonly links: readonly GlobeCredit[];
  /** GIBS's acknowledgement, under the list. */
  readonly note: string;
}

/**
 * The credits line (globe plan §7.7) for the imagery's `credits`, the
 * relief's `heights` (its credits, linked like the imagery's, a plain
 * sentence such as synthetic heights, or null without a relief) and the
 * credits that came later (`extra`: the OSM map). A page renders it with
 * textContent only: the texts come from the registry, never from markup.
 */
export function globeCreditsLine(
  credits: readonly GlobeCredit[],
  heights: readonly GlobeCredit[] | string | null = null,
  extra: readonly GlobeCredit[] = [],
): GlobeCreditsLine {
  const linked = heights === null || typeof heights === "string" ? [] : heights;
  const heightsText =
    typeof heights === "string"
      ? heights
      : linked.map((c) => c.full).join(" · ");
  const extraText = extra.map((c) => c.full).join(" · ");
  return {
    summary: `Imagery: ${credits.map((c) => c.short).join(" · ")}. ${PROCEDURAL_STARS}${heightsText ? ` ${heightsText}` : ""}${extraText ? ` Map: ${extraText}` : ""}`,
    links: [...credits, ...linked, ...extra],
    note: GIBS_ACKNOWLEDGEMENT,
  };
}
