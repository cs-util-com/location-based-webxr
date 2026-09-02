/**
 * The recorder's debug-UI flag: `?debug=1` (or `=true`) in the page URL.
 *
 * Gates developer-only surfaces in the AR HUD - the first of them the
 * in-recording settings wheel (2026-09-02, rotation-first search plan D8).
 * Without the flag those surfaces are NOT RENDERED (not merely disabled), so
 * an ordinary user's HUD is byte-identical to before; a tester opts in per
 * URL and nothing is persisted.
 *
 * Precedent: `GpsPlusSlamJs_AnchorStarter/src/cold-start-override-flag.ts` -
 * a pure reader over the search string, case-insensitive, whitespace-tolerant,
 * so a hand-typed `?debug=True` counts.
 */

/** True iff the `debug` query param is `1` or `true` (case-insensitive, trimmed). */
export function debugUiEnabledFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get('debug')?.trim().toLowerCase();
  return value === '1' || value === 'true';
}
