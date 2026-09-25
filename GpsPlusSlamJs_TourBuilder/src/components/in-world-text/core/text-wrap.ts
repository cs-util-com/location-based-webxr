/**
 * Pure word-wrapping for the in-world text label.
 *
 * We own line-breaking (rather than letting CSS do it on the HTML backend) so
 * that both rendering backends produce the *same* lines and therefore the same
 * pagination — the Canvas fallback stays a pixel-for-pixel-equivalent stand-in
 * for the HTML path (see the in-world-text plan, D9).
 *
 * The width of a piece of text is supplied by an injected `Measure`, so this
 * module is framework- and DOM-free and unit-testable with a fake monospace
 * measurer. In the app the measurer is backed by an offscreen canvas
 * `measureText` at the chosen font (`createMeasure`, view layer).
 *
 * Explicit `\n` in the source text is honoured as a hard line break; a single
 * word wider than the line is hard-broken character-by-character so it can never
 * overflow the panel.
 */

/** Width of a string in pixels at the target font. Injected → DOM-free. */
export type Measure = (text: string) => number;

/**
 * Greedily wrap `text` into lines no wider than `maxWidthPx`. Returns `[]` for
 * empty/whitespace-only input (the panel then renders a single empty page).
 */
export function wrapText(
  text: string,
  maxWidthPx: number,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    wrapParagraph(paragraph, maxWidthPx, measure, lines);
  }
  return lines;
}

function wrapParagraph(
  paragraph: string,
  maxWidthPx: number,
  measure: Measure,
  out: string[],
): void {
  const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (measure(candidate) <= maxWidthPx) {
      line = candidate;
      continue;
    }
    if (line !== "") {
      out.push(line);
      line = "";
    }
    if (measure(word) <= maxWidthPx) {
      line = word;
    } else {
      // A single word wider than the whole line: hard-break it. All resulting
      // chunks become their own lines (the trailing chunk included) so the next
      // word always starts a fresh line.
      for (const chunk of hardBreakWord(word, maxWidthPx, measure)) {
        out.push(chunk);
      }
    }
  }
  if (line !== "") {
    out.push(line);
  }
}

function hardBreakWord(
  word: string,
  maxWidthPx: number,
  measure: Measure,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of word) {
    const candidate = current + char;
    if (current !== "" && measure(candidate) > maxWidthPx) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current !== "") {
    chunks.push(current);
  }
  return chunks;
}
