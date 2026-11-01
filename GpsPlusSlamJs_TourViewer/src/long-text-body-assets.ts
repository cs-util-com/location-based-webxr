/**
 * The assets a long text's body shows: the picture blocks of its parsed
 * Markdown (`![alt](asset:<id>)` on a line of its own), at any depth - a
 * list item's, a quote's. The one walk the view switch ("shows no
 * pictures") and a write's asset rule (`tour-content.ts`, which must not
 * drop a file a body shows) both read.
 *
 * @see long-text-body-assets.ts.md
 */

import {
  parseTourMarkdown,
  type TourMdBlock,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

function picturesInto(blocks: readonly TourMdBlock[], out: string[]): void {
  for (const b of blocks) {
    switch (b.kind) {
      case "picture":
        out.push(b.asset);
        break;
      case "list":
        for (const item of b.items) picturesInto(item, out);
        break;
      case "quote":
        picturesInto(b.blocks, out);
        break;
      default:
        break;
    }
  }
}

/** Bodies already read, by body: the switch asks on every camera frame and
 *  store dispatch, a write asks for every long text of the tour, and
 *  parsing a long body costs milliseconds. Emptied whole when full (the
 *  keys are the manifest's own strings). PROVISIONAL size: a tour's long
 *  texts are expected to be a few dozen at most; more than this empties
 *  the memo on each write, which costs time, never a wrong answer. */
const BODIES_KNOWN_MAX = 64;
const assetsByBody = new Map<string, readonly string[]>();

/** The asset ids of the pictures `body` shows, in document order, each
 *  once. An inline picture (inside a paragraph) and one past the parser's
 *  cap (`TOUR_MARKDOWN_MAX_PICTURES`) show their alt text only and name
 *  no asset. Each body is parsed once (`assetsByBody`). */
export function bodyPictureAssets(body: string): readonly string[] {
  const known = assetsByBody.get(body);
  if (known !== undefined) return known;
  const found: string[] = [];
  picturesInto(parseTourMarkdown(body).blocks, found);
  const assets = [...new Set(found)];
  if (assetsByBody.size >= BODIES_KNOWN_MAX) assetsByBody.clear();
  assetsByBody.set(body, assets);
  return assets;
}

/** Answers kept by the long text itself, for a write's asset rule: it asks
 *  every long text of every undo and redo step (up to 200 steps) on every
 *  document change, far more bodies than `assetsByBody` holds. A block of
 *  a tour or of a history step is never changed in place (the document's
 *  state is immutable; an edit makes a new block), so its answer holds for
 *  as long as the block lives, and the map lets go of it with the block. */
const assetsByBlock = new WeakMap<object, readonly string[]>();

/** `bodyPictureAssets(block.body)`, remembered by `block`: the same
 *  answer, without a lookup by string that a history larger than the
 *  string memo would empty on every write. `block` must not be changed
 *  in place after it is asked about. */
export function blockBodyAssets(block: {
  readonly body: string;
}): readonly string[] {
  const known = assetsByBlock.get(block);
  if (known !== undefined) return known;
  const assets = bodyPictureAssets(block.body);
  assetsByBlock.set(block, assets);
  return assets;
}
