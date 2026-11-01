/**
 * The assets a long text's body shows and names. Shown: the picture
 * blocks of its parsed Markdown (`![alt](asset:<id>)` on a line of its
 * own), at any depth - a list item's, a quote's; what the view switch
 * reads ("shows no pictures"). Named: those and every other `asset:`
 * picture the body holds (one inside a paragraph, one past the parser's
 * cap), which show their alt text only; what a write's asset rule reads
 * (`tour-content.ts`, which must not drop a file the body names).
 *
 * @see long-text-body-assets.ts.md
 */

import {
  parseTourMarkdown,
  type TourMdBlock,
  type TourMdInline,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

/** What one parse of a body gives: the assets it shows and the assets it
 *  names, each in document order and once. */
interface BodyAssets {
  readonly shown: readonly string[];
  readonly named: readonly string[];
}

function inlinesInto(inlines: readonly TourMdInline[], named: string[]): void {
  for (const inline of inlines) {
    switch (inline.kind) {
      case "pictureAlt":
        if (inline.asset !== undefined) named.push(inline.asset);
        break;
      case "emphasis":
      case "strong":
      case "link":
        inlinesInto(inline.children, named);
        break;
      default:
        break;
    }
  }
}

function blocksInto(
  blocks: readonly TourMdBlock[],
  shown: string[],
  named: string[],
): void {
  for (const b of blocks) {
    switch (b.kind) {
      case "picture":
        shown.push(b.asset);
        named.push(b.asset);
        break;
      case "paragraph":
      case "heading":
        inlinesInto(b.inlines, named);
        break;
      case "list":
        for (const item of b.items) blocksInto(item, shown, named);
        break;
      case "quote":
        blocksInto(b.blocks, shown, named);
        break;
    }
  }
}

/** Bodies already read, by body: the switch asks on every camera frame and
 *  store dispatch, and parsing a long body costs milliseconds. Emptied
 *  whole when full (the keys are the manifest's own strings). PROVISIONAL
 *  size: a tour's long texts are expected to be a few dozen at most; more
 *  than this empties the memo, which costs time, never a wrong answer. A
 *  write asks by block instead (`assetsByBlock`). */
const BODIES_KNOWN_MAX = 64;
const assetsByBody = new Map<string, BodyAssets>();

function bodyAssets(body: string): BodyAssets {
  const known = assetsByBody.get(body);
  if (known !== undefined) return known;
  const shown: string[] = [];
  const named: string[] = [];
  blocksInto(parseTourMarkdown(body).blocks, shown, named);
  const assets = { shown: [...new Set(shown)], named: [...new Set(named)] };
  if (assetsByBody.size >= BODIES_KNOWN_MAX) assetsByBody.clear();
  assetsByBody.set(body, assets);
  return assets;
}

/** The asset ids of the pictures `body` shows, in document order, each
 *  once. An inline picture (inside a paragraph) and one past the parser's
 *  cap (`TOUR_MARKDOWN_MAX_PICTURES`) show their alt text only and are
 *  not listed. Each body is parsed once (`assetsByBody`). */
export function bodyPictureAssets(body: string): readonly string[] {
  return bodyAssets(body).shown;
}

/** Answers kept by the long text itself, for a write's asset rule: it asks
 *  every long text of every undo and redo step (up to 200 steps) on every
 *  document change, far more bodies than `assetsByBody` holds. A block of
 *  a tour or of a history step is never changed in place (the document's
 *  state is immutable; an edit makes a new block), so its answer holds for
 *  as long as the block lives, and the map lets go of it with the block. */
const assetsByBlock = new WeakMap<object, readonly string[]>();

/** The asset ids `block.body` names, in document order, each once: every
 *  picture whose target is `asset:<id>`, shown or not (inline, or past
 *  the cap). Remembered by `block`, without a lookup by string that a
 *  history larger than the string memo would empty on every write.
 *  `block` must not be changed in place after it is asked about. */
export function blockBodyAssets(block: {
  readonly body: string;
}): readonly string[] {
  const known = assetsByBlock.get(block);
  if (known !== undefined) return known;
  const assets = bodyAssets(block.body).named;
  assetsByBlock.set(block, assets);
  return assets;
}
