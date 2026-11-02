/**
 * A line of text kept short: cut at `n` characters with "…" at the end.
 * The one copy in the package (the editor's notes, the creator's panel
 * label, the tour's short name, the map chip and the 3D marks).
 *
 * @see truncated.ts.md
 */

type GraphemeSegmenter = new (
  lang: string,
  options: { granularity: "grapheme" },
) => { segment(text: string): Iterable<{ segment: string }> };

const SEGMENTER = (Intl as unknown as { Segmenter?: GraphemeSegmenter })
  .Segmenter;
const GRAPHEMES =
  SEGMENTER === undefined
    ? null
    : new SEGMENTER("en", { granularity: "grapheme" });

/** `s` as the characters a reader sees (grapheme clusters: a flag, a
 *  family emoji, a letter with its accent are one each); code points
 *  where the browser has no segmenter. */
function charactersOf(s: string): string[] {
  return GRAPHEMES === null
    ? [...s]
    : Array.from(GRAPHEMES.segment(s), (g) => g.segment);
}

/** `s` when it fits in `n` characters, else its start and "…", `n`
 *  characters in all (less the space before the cut). A character is
 *  what a reader sees as one, so a cut never splits one. */
export function truncated(s: string, n: number): string {
  const chars = charactersOf(s);
  if (chars.length <= n) return s;
  return `${chars
    .slice(0, Math.max(0, n - 1))
    .join("")
    .trimEnd()}…`;
}
