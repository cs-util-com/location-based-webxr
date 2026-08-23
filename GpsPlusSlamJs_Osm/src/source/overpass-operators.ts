/**
 * Which Overpass endpoints are actually the same operator — and therefore the
 * same quota.
 *
 * WHY THIS IS NOT A DETAIL. `DEFAULT_OVERPASS_ENDPOINTS` has five entries and
 * reads like five chances. It is **three operators**: `overpass-api.de`, `lz4.`
 * and `z.` are all FOSSGIS. `overpass-source.ts`'s own header has said so in
 * prose since 2026-07-28, and the twelfth testing session confirmed it from the
 * servers themselves — all three answered `/api/status` with one connection id
 * (`1354461648`), one rate limit, and two of them naming the same backend.
 *
 * So a 429 from entry 0 is not bad luck that a retry might dodge; it is the
 * FOSSGIS quota being spent, and entries 2 and 4 will say the same thing. Any
 * retry policy that treats the pool as five independent hosts is spending
 * attempts it has already lost.
 *
 * WHY IT LIVES IN `src/` AT ALL, given that `scripts/benchmark-matrix.mjs` has
 * carried this table since the July benchmark. Because the script cannot be
 * imported from here: it is plain `.mjs` run under bare `node` with no build
 * step, and it deliberately stays that way (see its header). The table is
 * therefore duplicated **on purpose**, and `overpass-operators.test.ts` asserts
 * the two copies agree — the same shape the repo already uses for the retracted
 * -figures pattern lists, which are duplicated across the two roots for the
 * same "cannot import across that line" reason.
 *
 * @see overpass-operators.ts.md
 */

/**
 * Hostname → operator.
 *
 * Keys are hostnames rather than full URLs so a path change cannot silently
 * un-group a host.
 */
const OPERATOR_BY_HOSTNAME: Readonly<Record<string, string>> = Object.freeze({
  "overpass-api.de": "fossgis",
  "lz4.overpass-api.de": "fossgis",
  "z.overpass-api.de": "fossgis",
  "overpass.private.coffee": "private.coffee",
  // The OSM wiki records kumi.systems as having BECOME private.coffee, and the
  // 2026-07-28 benchmark found both returning byte-identical bodies. Not in the
  // default pool, but a caller may pass it via `endpoints`.
  "overpass.kumi.systems": "private.coffee",
  "maps.mail.ru": "vk-maps",
});

/** The hostname of a URL, or the URL itself when it will not parse. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * The operator behind a URL. Never throws.
 *
 * **AN UNKNOWN HOST BECOMES ITS OWN OPERATOR**, and that default is chosen
 * rather than inherited. The two ways to be wrong are not symmetric: treating
 * one operator as two spends an extra attempt against a quota already refused,
 * which costs one request; treating two operators as one makes a
 * self-hosted instance share a stranger's rate limit, which throttles it
 * permanently for no reason. "Assume independent" is the recoverable error, and
 * a self-hosted endpoint passed via `endpoints` is exactly the case that must
 * not be lumped in with anything.
 */
export function operatorForUrl(url: string): string {
  return OPERATOR_BY_HOSTNAME[hostnameOf(url)] ?? hostnameOf(url);
}

/** Every hostname the table groups, for the cross-check against the script. */
export function knownOperatorHostnames(): Readonly<Record<string, string>> {
  return OPERATOR_BY_HOSTNAME;
}
