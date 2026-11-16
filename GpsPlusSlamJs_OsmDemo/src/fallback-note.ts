/**
 * The status line's note on buildings not drawn as planned.
 *
 * @see fallback-note.ts.md
 */

/**
 * `"N buildings simplified or left out"`, or `""` for none (or a count
 * that is not a positive number). The count holds buildings drawn simpler
 * than planned (a flat lid, the plain volume) and buildings skipped, so the
 * note names both. A short, calm note: the city is drawn.
 */
export function fallbackBuildingsNote(count: number): string {
  if (!(count > 0)) return "";
  return count === 1
    ? "1 building simplified or left out"
    : `${count} buildings simplified or left out`;
}
