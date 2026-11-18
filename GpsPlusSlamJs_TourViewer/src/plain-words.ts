/**
 * The words of a narrated text's plain text `P`, as the read-along counts
 * them: letters and digits with inner apostrophes; punctuation lies
 * between words. The narration box lights them one by one
 * (`narration-box.ts`) and the editor's timing import matches them
 * (`editor/narration/word-diff.ts`). Pure; offsets are of `P`.
 *
 * @see plain-words.ts.md
 */

/** A word's stretch of `P`. */
export interface PlainWord {
  readonly from: number;
  readonly to: number;
}

/** The words of `text` from `from` to `to` (a word cut by `to` ends
 *  there). */
export function wordsOf(text: string, from: number, to: number): PlainWord[] {
  const out: PlainWord[] = [];
  const re = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  re.lastIndex = Math.max(0, from);
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index >= to) break;
    out.push({ from: m.index, to: Math.min(to, m.index + m[0].length) });
  }
  return out;
}
