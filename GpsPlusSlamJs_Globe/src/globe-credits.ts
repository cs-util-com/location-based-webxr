/**
 * The credits for the imagery on screen (globe plan 2026-09-26-0539 §7.7):
 * one entry per credit, in registry order, whatever order the sources
 * arrive in, so the credits line never reorders as tiles load.
 *
 * @see globe-credits.ts.md
 */

import {
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
