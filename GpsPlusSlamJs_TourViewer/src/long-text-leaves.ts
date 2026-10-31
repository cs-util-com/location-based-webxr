/**
 * A long text's plain text `P` (the framework's `plainTextOf`, the text a
 * narrator reads and read-along offsets count in) laid over its rendered
 * sheet: which paragraph or heading holds an offset of `P`, and the DOM
 * `Range` over the words of a stretch of it - so a timing's word or
 * sentence can be marked where the visitor reads it, without wrapping it
 * in an element of its own.
 *
 * A range never crosses from one leaf (paragraph or heading) into the
 * next: the blank line `P` puts between two leaves is in no element.
 *
 * @see long-text-leaves.ts.md
 */

import type {
  TourMdBlock,
  TourPlainText,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

import type { RenderedLeaf } from "./long-text-render.js";

/** A leaf of `P` and its words on the page. */
export interface PlacedLeaf {
  /** Its stretch of `P`, `from` inclusive, `to` exclusive. */
  readonly from: number;
  readonly to: number;
  readonly element: HTMLElement;
  readonly pieces: RenderedLeaf["pieces"];
  /** How many characters of the rendered leaf's text come before its
   *  first one in `P` (the plain text trims each leaf). */
  readonly lead: number;
}

function isLeafSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n";
}

/**
 * The leaves of `plain`, in order, each with its rendered words. A leaf
 * the render does not hold, or holds with other text (a render of
 * another body), is left out, so its offsets mark nothing rather than
 * the wrong words.
 */
export function placeLeaves(
  plain: TourPlainText,
  rendered: ReadonlyMap<TourMdBlock, RenderedLeaf>,
): PlacedLeaf[] {
  const out: PlacedLeaf[] = [];
  for (const leaf of plain.leaves) {
    const r = rendered.get(leaf.block);
    if (r === undefined || r.pieces.length === 0) continue;
    let lead = 0;
    while (lead < r.raw.length && isLeafSpace(r.raw.charAt(lead))) lead += 1;
    const text = plain.text.slice(leaf.from, leaf.to);
    if (r.raw.slice(lead, lead + text.length) !== text) continue;
    out.push({
      from: leaf.from,
      to: leaf.to,
      element: r.element,
      pieces: r.pieces,
      lead,
    });
  }
  return out;
}

/** The index of the leaf holding offset `at` of `P`, or -1 (an offset in
 *  the blank line between two leaves, or outside them all). */
export function leafAt(leaves: readonly PlacedLeaf[], at: number): number {
  if (!Number.isFinite(at)) return -1;
  let lo = 0;
  let hi = leaves.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const leaf = leaves[mid];
    if (leaf === undefined) return -1;
    if (at < leaf.from) hi = mid - 1;
    else if (at >= leaf.to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** A point of the leaf's words for offset `at` of `P`: a start goes to
 *  the node its character is in (or the next one, after a hard break), an
 *  end to the node the character before it is in. */
function pointIn(
  leaf: PlacedLeaf,
  at: number,
  side: "start" | "end",
): { node: Text; offset: number } | null {
  const r = at - leaf.from + leaf.lead;
  for (const { node, start } of leaf.pieces) {
    const end = start + node.data.length;
    if (side === "start" ? r < end : r <= end) {
      return { node, offset: Math.max(0, r - start) };
    }
  }
  const last = leaf.pieces[leaf.pieces.length - 1];
  return last === undefined
    ? null
    : { node: last.node, offset: last.node.data.length };
}

/**
 * The words of `P` from `from` to `to` as a `Range`, clipped to the leaf
 * holding `from`; null when no leaf holds it or the stretch is empty.
 * Never throws.
 */
export function rangeOf(
  doc: Document,
  leaves: readonly PlacedLeaf[],
  from: number,
  to: number,
): Range | null {
  const leaf = leaves[leafAt(leaves, from)];
  if (leaf === undefined || !(to > from)) return null;
  const start = pointIn(leaf, from, "start");
  const end = pointIn(leaf, Math.min(to, leaf.to), "end");
  if (start === null || end === null) return null;
  try {
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}
