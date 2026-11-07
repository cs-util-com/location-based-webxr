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

import { bodyPictureAssets } from "gps-plus-slam-app-framework/ar/tour-body-assets";
import type { NarrationVerdict } from "./narration-timing.js";

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
 * only views with a renderer here; `silent` joins with its view. Each
 * set's FIRST member is its floor, whose needs always hold.
 *
 * `captions` is a visitor's member only: no creator's view names it (a
 * creator places a text; the strip is how a visitor follows its voice),
 * so it joins the world set it is chosen from. Its world drawing is the
 * reading sign; the strip is the page's (`captions-strip.ts`).
 *
 * `storedAt` names a member the device stores under another placement
 * key than the set's: captions are a SCREEN view in the design (§3.2,
 * §4: `{"world":"lectern","screen":"captions"}`), so they are stored at
 * `screen`, beside the world's choice, and a `world: "captions"` is not
 * read.
 */
const VIEW_SETS: readonly (Omit<ViewSet, "floor"> & {
  readonly storedAt?: Readonly<Partial<Record<string, ViewPlacement>>>;
})[] = [
  {
    kind: "longText",
    placement: "world",
    members: ["reading", "lectern", "captions"],
    storedAt: { captions: "screen" },
  },
];

type SetSpec = (typeof VIEW_SETS)[number];

function asSet(spec: SetSpec | undefined): ViewSet | null {
  const floor = spec?.members[0];
  return spec === undefined || floor === undefined
    ? null
    : {
        kind: spec.kind,
        placement: spec.placement,
        members: spec.members,
        floor,
      };
}

/** The set `view` of `kind` belongs to, or null (a story's `card`, a kind
 *  with no set). */
export function viewSetOf(kind: string, view: string): ViewSet | null {
  return asSet(
    VIEW_SETS.find((s) => s.kind === kind && s.members.includes(view)),
  );
}

/** The set of `kind` at `placement`, or undefined. */
function specAt(kind: string, placement: string): SetSpec | undefined {
  return VIEW_SETS.find((s) => s.kind === kind && s.placement === placement);
}

/** The placement key a member of `spec` is stored under. */
function slotOf(spec: SetSpec, view: string): ViewPlacement {
  return spec.storedAt?.[view] ?? spec.placement;
}

/** The placement keys `spec`'s members are stored under, those of the
 *  members stored elsewhere first (they are the more specific choice). */
function slotsOf(spec: SetSpec): readonly ViewPlacement[] {
  const others = Object.values(spec.storedAt ?? {}).filter(
    (slot): slot is ViewPlacement =>
      slot !== undefined && slot !== spec.placement,
  );
  return [...new Set([...others, spec.placement])];
}

/** The member stored at `slot` of `byKind`, or null for anything else (a
 *  name not in the set, or a member that belongs under another key). */
function memberAt(
  spec: SetSpec,
  byKind: Record<string, unknown>,
  slot: ViewPlacement,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(byKind, slot)) return null;
  const view = byKind[slot];
  return typeof view === "string" &&
    spec.members.includes(view) &&
    slotOf(spec, view) === slot
    ? view
    : null;
}

/** Whether a long text's body shows a picture (a picture block at any
 *  depth; an inline one shows only its alt text). Each body is parsed
 *  once (`bodyPictureAssets` remembers it). */
export function bodyHasPictures(body: string): boolean {
  return bodyPictureAssets(body).length > 0;
}

/**
 * Why `view` cannot show `block` whole, as the switch says it, or null
 * when its needs hold. The lectern shows the plain text only, so a body
 * with pictures would lose them there. Captions follow the voice by its
 * read-along timing: a text that declares none, or whose timing was
 * found stale (`verdict`, `narration-timing.ts`), cannot show them. A
 * verdict not known yet counts as holding: the timing is read only when
 * the text opens, and a stale one then moves the text back.
 */
export function viewNeedsFail(
  block: TourBlock,
  view: string,
  verdict?: NarrationVerdict,
): string | null {
  if (block.kind !== "longText") return null;
  if (view === "lectern" && bodyHasPictures(block.body)) {
    return "shows no pictures";
  }
  if (
    view === "captions" &&
    (block.narration?.timing === undefined || verdict === "stale")
  ) {
    return "needs a timing";
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
 * newer app sharing the storage may know it. With captions stored (at
 * `screen`) and a world view too, captions are the choice.
 */
export function preferredView(
  stored: unknown,
  kind: string,
  placement: ViewPlacement,
): string | null {
  return preferredViews(stored, kind, placement)[0] ?? null;
}

/** Every stored choice for the set of `kind` at `placement`, the more
 *  specific first (captions, then the world's view). */
function preferredViews(
  stored: unknown,
  kind: string,
  placement: ViewPlacement,
): readonly string[] {
  const spec = specAt(kind, placement);
  const byKind = objectAt(objectAt(stored, "views"), kind);
  if (spec === undefined || byKind === null) return [];
  return slotsOf(spec)
    .map((slot) => memberAt(spec, byKind, slot))
    .filter((view): view is string => view !== null);
}

/**
 * A new stored value with the choice for `kind` at `placement` set, or
 * cleared with null ("Use the creator's choice again"). Every other key
 * is kept as it was, those this app does not know included; `stored` is
 * not changed. A stored value that is not an object starts afresh.
 *
 * A member is stored under its own key (`slotOf`): captions at `screen`,
 * keeping the world's choice; a world view clears stored captions (the
 * visitor picked it over them); null clears both. A value at `screen`
 * this app does not know is kept.
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
  const byKind: Record<string, unknown> = { ...(objectAt(views, kind) ?? {}) };
  const spec = specAt(kind, placement);
  const slot =
    spec === undefined || view === null ? placement : slotOf(spec, view);
  if (spec !== undefined && slot === spec.placement) {
    for (const other of slotsOf(spec)) {
      if (other !== slot && memberAt(spec, byKind, other) !== null) {
        delete byKind[other];
      }
    }
  }
  if (view === null) delete byKind[slot];
  else byKind[slot] = view;
  return { ...root, views: { ...views, [kind]: byKind } };
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
  /** The block's read-along verdict, where the page knows it. */
  readonly verdict?: NarrationVerdict;
}): string {
  const { block, verdict } = input;
  if (input.audience !== "visitor") return block.view;
  const set = viewSetOf(block.kind, block.view);
  if (set === null) return block.view;
  const fails = (view: string): boolean =>
    viewNeedsFail(block, view, verdict) !== null;
  // Captions first where stored, then the world's choice (rule 3 over
  // the visitor's two stored choices).
  const preferred =
    preferredViews(input.stored, block.kind, set.placement).find(
      (view) => !fails(view),
    ) ?? null;
  return shownMember({
    creator: block.view,
    preferred,
    floor: set.floor,
    fails,
  });
}

/**
 * Rules 3-5 of `shownView` within one set: the preferred member if its
 * needs hold, else the creator's view if its needs hold, else the floor.
 * `fails` says whether a member's needs fail for the block.
 */
export function shownMember(input: {
  readonly creator: string;
  readonly preferred: string | null;
  readonly floor: string;
  readonly fails: (view: string) => boolean;
}): string {
  const { creator, preferred, floor, fails } = input;
  if (preferred !== null && !fails(preferred)) return preferred;
  if (!fails(creator)) return creator;
  return floor;
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

/**
 * A visitor's choice for `kind` at `placement` (null: the creator's
 * again), merged into a FRESH read of the device - never into the value
 * read at the page's start, which would delete keys another tab (a newer
 * app) wrote since - and stored. When the device gives nothing (no value,
 * or it cannot be read), `inStore` (the page's value, with this visit's
 * earlier choices) is the base. `value` is what the page's store takes;
 * `kept`: whether the device keeps it.
 */
export function storeVisitorChoice(
  storage: PrefsStorage | undefined,
  inStore: unknown,
  kind: string,
  placement: ViewPlacement,
  view: string | null,
): { readonly value: Record<string, unknown>; readonly kept: boolean } {
  const fresh = loadVisitorPrefs(storage);
  const value = withPreferredView(fresh ?? inStore, kind, placement, view);
  return { value, kept: saveVisitorPrefs(storage, value) };
}
