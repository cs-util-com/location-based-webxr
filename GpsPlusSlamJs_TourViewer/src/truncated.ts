/**
 * A line of text kept short: cut at `n` characters with "…" at the end.
 * The one copy in the package (the editor's notes, the creator's panel
 * label, the tour's short name, the map chip and the 3D marks).
 *
 * @see truncated.ts.md
 */

/** `s` when it fits in `n` characters, else its start and "…", `n`
 *  characters in all (less the space before the cut). Counts code
 *  points, so a cut never splits a surrogate pair. */
export function truncated(s: string, n: number): string {
  const chars = [...s];
  if (chars.length <= n) return s;
  return `${chars
    .slice(0, Math.max(0, n - 1))
    .join("")
    .trimEnd()}…`;
}
