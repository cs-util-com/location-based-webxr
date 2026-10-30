/**
 * The visitor's view preference (station blocks design §4): which of a
 * block's interchangeable views a visitor sees, and the one guarded key
 * that remembers the choice on the device, across every tour.
 *
 * Pure, apart from the two storage calls, which never throw. The page
 * holds the stored value in the store (`visitor-prefs-slice.ts`) and
 * mirrors it here; the station renderer asks `shownView` per block.
 *
 * @see visitor-prefs.ts.md
 */

import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  parseTourMarkdown,
  type TourMdBlock,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

/** The one versioned key: views per kind and placement, and later the
 *  video's sound and captions choices (design §4). */
export const VISITOR_PREFS_KEY = "tour-viewer.visitor.prefs.v1";

export type ViewPlacement = "world" | "screen";

/** Who looks: a creator always sees their own choice (rule 1). */
export type ViewAudience = "visitor" | "creator";

/** A set of views that show the same content, between which a visitor
 *  may swap. `floor` is the member whose needs always hold. */
export interface ViewSet {
  readonly kind: string;
  readonly placement: ViewPlacement;
  readonly members: readonly string[];
  readonly floor: string;
}

/**
 * The interchangeable sets this reader draws (design §3.2). A set lists
 * only views with a renderer here: the long text's screen set
 * (`silent`, `captions`) joins with those views. Each set's FIRST member
 * is its floor, whose needs always hold.
 */
const VIEW_SETS: readonly Omit<ViewSet, "floor">[] = [
  { kind: "longText", placement: "world", members: ["reading", "lectern"] },
];

/** The set `view` of `kind` belongs to, or null (a story's `card`, a kind
 *  with no set). */
export function viewSetOf(kind: string, view: string): ViewSet | null {
  const set = VIEW_SETS.find(
    (s) => s.kind === kind && s.members.includes(view),
  );
  const floor = set?.members[0];
  return set === undefined || floor === undefined ? null : { ...set, floor };
}

/** The set of `kind` at `placement`, or null. */
function setAt(kind: string, placement: string): ViewSet | null {
  const set = VIEW_SETS.find(
    (s) => s.kind === kind && s.placement === placement,
  );
  const floor = set?.members[0];
  return set === undefined || floor === undefined ? null : { ...set, floor };
}

function anyPicture(blocks: readonly TourMdBlock[]): boolean {
  return blocks.some((b) => {
    switch (b.kind) {
      case "picture":
        return true;
      case "list":
        return b.items.some(anyPicture);
      case "quote":
        return anyPicture(b.blocks);
      default:
        return false;
    }
  });
}

/** Whether a long text's body shows a picture (a picture block at any
 *  depth; an inline one shows only its alt text). */
export function bodyHasPictures(body: string): boolean {
  return anyPicture(parseTourMarkdown(body).blocks);
}

/**
 * Why `view` cannot show `block` whole, as the switch says it, or null
 * when its needs hold. The lectern shows the plain text only, so a body
 * with pictures would lose them there.
 */
export function viewNeedsFail(block: TourBlock, view: string): string | null {
  if (
    block.kind === "longText" &&
    view === "lectern" &&
    bodyHasPictures(block.body)
  ) {
    return "shows no pictures";
  }
  return null;
}

function objectAt(value: unknown, key: string): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
  const inner = (value as Record<string, unknown>)[key];
  return typeof inner === "object" && inner !== null && !Array.isArray(inner)
    ? (inner as Record<string, unknown>)
    : null;
}

/**
 * The stored choice for `kind` at `placement`, read defensively: a value
 * that is not an object, an unknown kind or placement, or a name that is
 * not a member of that set is ignored (null) - never deleted, since a
 * newer app sharing the storage may know it.
 */
export function preferredView(
  stored: unknown,
  kind: string,
  placement: ViewPlacement,
): string | null {
  const set = setAt(kind, placement);
  const byPlacement = objectAt(objectAt(stored, "views"), kind);
  if (set === null || byPlacement === null) return null;
  if (!Object.prototype.hasOwnProperty.call(byPlacement, placement)) {
    return null;
  }
  const view = byPlacement[placement];
  return typeof view === "string" && set.members.includes(view) ? view : null;
}

/**
 * A new stored value with the choice for `kind` at `placement` set, or
 * cleared with null ("Use the creator's choice again"). Every other key
 * is kept as it was, those this app does not know included; `stored` is
 * not changed. A stored value that is not an object starts afresh.
 */
export function withPreferredView(
  stored: unknown,
  kind: string,
  placement: ViewPlacement,
  view: string | null,
): Record<string, unknown> {
  const root =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const views = objectAt(root, "views") ?? {};
  const { [placement]: _old, ...others } = objectAt(views, kind) ?? {};
  const byPlacement = view === null ? others : { ...others, [placement]: view };
  return { ...root, views: { ...views, [kind]: byPlacement } };
}

/**
 * Which view of `block` shows (design §4, its five rules):
 * 1. the creator sees the creator's view;
 * 2. a view in no set is the creator's (the preference is kept, not
 *    applied);
 * 3. else the preferred member of the set, if its needs hold;
 * 4. else the creator's view, if its needs hold;
 * 5. else the set's floor, whose needs always hold.
 * A preference never moves a block between the world and the screen.
 */
export function shownView(input: {
  readonly audience: ViewAudience;
  readonly block: TourBlock;
  readonly stored: unknown;
}): string {
  const { block } = input;
  if (input.audience !== "visitor") return block.view;
  const set = viewSetOf(block.kind, block.view);
  if (set === null) return block.view;
  const preferred = preferredView(input.stored, block.kind, set.placement);
  if (preferred !== null && viewNeedsFail(block, preferred) === null) {
    return preferred;
  }
  if (viewNeedsFail(block, block.view) === null) return block.view;
  return set.floor;
}

/** The two `Storage` methods used (`localStorage` has them). */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored value (parsed JSON), or null when there is none, it does
 *  not parse, or the storage is missing or throws. */
export function loadVisitorPrefs(storage: PrefsStorage | undefined): unknown {
  try {
    const raw = storage?.getItem(VISITOR_PREFS_KEY) ?? null;
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Store `value` under the one key. False when there is no storage or it
 *  throws (blocked, full): the choice then lasts the visit only. */
export function saveVisitorPrefs(
  storage: PrefsStorage | undefined,
  value: unknown,
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(VISITOR_PREFS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
