/**
 * The status line's note on buildings drawn without their roof.
 *
 * @see fallback-note.ts.md
 */

/**
 * `"N buildings drawn without their roof"`, or `""` for none (or a count
 * that is not a positive number). A short, calm note: the city is drawn,
 * only these buildings are simpler than planned.
 */
export function fallbackBuildingsNote(count: number): string {
  if (!(count > 0)) return "";
  return count === 1
    ? "1 building drawn without its roof"
    : `${count} buildings drawn without their roof`;
}
