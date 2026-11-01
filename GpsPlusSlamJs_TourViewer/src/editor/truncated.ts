/**
 * A line of the editor's text kept short: cut at `n` characters with
 * "..." at the end. The one copy in the package (the writer's link note
 * and the narration's lists).
 *
 * @see truncated.ts.md
 */

/** `s` when it fits in `n` characters, else its start and "...", `n`
 *  characters in all (less the space before the cut). */
export function truncated(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, Math.max(0, n - 3)).trimEnd()}...` : s;
}
