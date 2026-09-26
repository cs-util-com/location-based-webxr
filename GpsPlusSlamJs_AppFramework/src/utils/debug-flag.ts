/**
 * The apps' debug-UI flag: `?debug=1` (or `=true`) in the page URL.
 *
 * Gates developer-only surfaces - the RecorderApp's in-recording settings
 * wheel (2026-09-02, rotation-first search plan D8) and the TourViewer's QR
 * readout (QR near-frontal pose plan §66). One reader, so every app reads
 * the same owner habit by one rule (DEC-H3; moved here from the RecorderApp,
 * plan §67 #3). Deep-import it (`utils/debug-flag`), never through the
 * `/utils` barrel.
 *
 * Without the flag those surfaces are NOT RENDERED (not merely disabled), so
 * an ordinary user's screen is byte-identical to before; a tester opts in
 * per URL and nothing is persisted.
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
