/**
 * The "known irrelevant" tag list.
 *
 * Ported from `OsmHeatMapsManager.LogThatTagWasIgnored` (~90 lines, DEBUG-only
 * in the C# reference). Its job is **diagnostic, not functional**: nothing here
 * changes a score. Every tag absent from the rule table already contributes the
 * multiplicative identity.
 *
 * What it buys is that `unmappedTagCounts` — the signal used to decide what the
 * rule table should learn next — is a short list of genuine candidates rather
 * than a firehose of `addr:housenumber`, `source`, `name` and `wikidata`. That
 * is the difference between a diagnostic someone reads and one they turn off.
 *
 * @see ignored-tags.ts.md
 */

/**
 * Tag-key prefixes deliberately absent from the rule table.
 *
 * Matched against the **key** (`addr:street`), not against the `key_value` rule
 * id, which is a deviation from the reference worth stating: the C# list mixes
 * the two levels — some entries are bare keys (`maxspeed`), some are key
 * prefixes (`addr:`), and some are whole rule ids (`lit_yes`, `fee_no`,
 * `smoothness_excellent`, `area_yes`). Matching everything as a key prefix is
 * simpler and strictly wider, and since the list is only ever used to *silence*
 * a diagnostic, being slightly wider costs nothing and being narrower costs a
 * noisy log.
 */
export const IGNORED_TAG_PREFIXES: readonly string[] = [
  // Identity and naming — never affordance signal.
  "addr:",
  "alt_name",
  "name",
  "ref",
  "operator",
  "brand",
  "office",
  "designation",
  "inscription",
  "artist",
  "monument",
  "memorial:",

  // Provenance and metadata about the mapping itself.
  "source",
  "note",
  "fixme",
  "description",
  "survey:date",
  "start_date",
  "mapillary",
  "wikidata",
  "wikipedia",
  "wikimedia_commons",
  "website",
  "email",
  "phone",
  "fax",
  "contact:",
  "check_date",

  // Traffic regulation — matters for routing, not for standing on something.
  "maxspeed",
  "maxweight",
  "maxheight",
  "oneway",
  "lanes",
  "lane_markings",
  "cycleway",
  "restriction",
  "turn:",

  // Administrative and boundary bookkeeping.
  "admin_level",
  "border_type",
  "boundary",
  "usage",
  "gauge",
  "electrified",
  "network",
  "site",
  "type",
  "ownership",

  // Business detail.
  "opening_hours",
  "shop",
  "cuisine",
  "produce",
  "delivery",
  "dispensing",
  "healthcare",
  "isced:",
  "school:",
  "religion",
  "denomination",
  "recycling:",

  // Construction detail we either read elsewhere or do not care about.
  "building:levels",
  "roof:",
  "layer",
  "level",
  "material",
  "fence_type",
  "handrail",
  "backrest",
  "seats",
  "ramp",
  "camera",
  "surveillance",
  "construction",
  "razed:",
  "historic:",
  "female",
  "male",
  "bus",
  "public_transport",
  "bollard",
  "fee",
  "lit",
  "area",
  "smoothness",
  "height",
];

/**
 * Is this tag key one we have deliberately decided not to score on?
 *
 * Case-sensitive, matching OSM's own convention that keys are lowercase. A
 * mixed-case key is by definition not one of these prefixes and *should* show up
 * in the diagnostic — an unexpected key is exactly what the diagnostic is for.
 */
export function isIgnoredTagKey(key: string): boolean {
  return IGNORED_TAG_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Filters a tag-count map down to keys worth a human's attention.
 *
 * Intended for `unmappedTagCounts`: given every tag the scorer saw and could not
 * score, this is the shortlist of candidates for the rule table.
 */
export function interestingUnmappedTags(
  counts: Readonly<Record<string, number>>,
): Record<string, number> {
  const interesting: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    if (!isIgnoredTagKey(key)) interesting[key] = count;
  }
  return interesting;
}
