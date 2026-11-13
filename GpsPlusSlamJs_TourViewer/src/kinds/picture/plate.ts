/**
 * The words a picture shows in the world, cut to fit (pure): the framed
 * print's plate (its caption in at most three lines, the last ending in an
 * ellipsis when the caption goes on) and the cut-out's tag (its title, or
 * the caption's first phrase). The whole text is always the sheet's
 * (`picture-sheet.ts`); what is cut here is a label, never the only place
 * a word can be read.
 *
 * Measuring is the caller's (`fits`, a canvas's `measureText` in the
 * painter), so the cut is tested without a canvas.
 *
 * @see plate.ts.md
 */

/** The plate's most lines. */
export const PLATE_MAX_LINES = 3;

/** The mark a cut line ends in. */
export const ELLIPSIS = "…";

/** A text cut into lines. */
export interface PlateCut {
  readonly lines: readonly string[];
  /** Words were left out: the last line ends in {@link ELLIPSIS}. */
  readonly truncated: boolean;
}

/** `text`'s words, split on any white space. */
function wordsOf(text: string | undefined): string[] {
  return (text ?? "").split(/\s+/).filter((w) => w !== "");
}

/**
 * `text` wrapped word by word into lines `fits` accepts, at most
 * `maxLines`; a word that fits no line stands alone on its own. When more
 * lines would follow, the last kept line loses words from its end until
 * it fits with the ellipsis (never its first word), then a closing comma,
 * stop, semicolon or colon, and takes the ellipsis.
 */
export function plateLines(
  text: string | undefined,
  fits: (line: string) => boolean,
  maxLines: number = PLATE_MAX_LINES,
): PlateCut {
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new RangeError(
      `maxLines must be a whole number from 1, got ${String(maxLines)}`,
    );
  }
  const lines: string[] = [];
  let line = "";
  for (const word of wordsOf(text)) {
    const longer = line === "" ? word : `${line} ${word}`;
    if (line === "" || fits(longer)) {
      line = longer;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== "") lines.push(line);
  if (lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? "";
  while (!fits(last + ELLIPSIS) && last.includes(" ")) {
    last = last.replace(/\s+\S+$/, "");
  }
  kept[maxLines - 1] = last.replace(/[,.;:]$/, "") + ELLIPSIS;
  return { lines: kept, truncated: true };
}

/** The tag's longest phrase, in characters, before it is cut. */
const TAG_PHRASE_MAX = 34;

/**
 * The line a cut-out's tag reads: its title when it has one, else its
 * caption up to the first stop, semicolon or colon, cut after the last
 * whole word within 33 characters (with an ellipsis) when longer than 34.
 */
export function tagLine(
  title: string | undefined,
  caption: string | undefined,
): string {
  if (title !== undefined && title.trim() !== "") return title.trim();
  const phrase = (caption ?? "").split(/[.;:]/)[0]?.trim() ?? "";
  if (phrase.length <= TAG_PHRASE_MAX) return phrase;
  return phrase.slice(0, TAG_PHRASE_MAX - 1).replace(/\s+\S*$/, "") + ELLIPSIS;
}

/** `text` as the sheet shows its words, white space run into one space:
 *  what a plate's lines are a cut of. */
export function plainWords(text: string | undefined): string {
  return wordsOf(text).join(" ");
}
