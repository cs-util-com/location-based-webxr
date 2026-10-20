/**
 * The visitor's content, per station (visitor plan 2026-10-18-2349 §3, M2): the side table that keeps each station's three.js handles by
 * station id, so only the stations the page asks for stand in the scene.
 * The store says WHICH (the present station, or every one under "show
 * all", `visitor-guide-slice.ts`); this module never reads the store.
 *
 * - **Parts.** A station holds named parts (its `tour.json` items, its walk
 *   photos, the ring around a code), each a recipe that decodes and places
 *   its objects under the station's group. Nothing is decoded until the
 *   station is shown.
 * - **Shown.** A shown station renders its parts into a detached group;
 *   once every part settled, the group enters the scene at opacity 0 and
 *   fades in over `fadeMs`.
 * - **One at a time.** A group enters only while no other station is still
 *   fading out (the leaving station's content goes before the next
 *   one's comes). "Show all" enters every station at once.
 * - **Left.** A station no longer shown fades out, then leaves the scene and
 *   frees every part (textures, materials, geometries). Shown again while it
 *   fades out, it fades back in without decoding again; shown again later,
 *   it decodes again, its files read from the archive once more.
 * - **Always shown.** Content no station holds (`alwaysShown`) stands
 *   whatever the page asks: it neither waits for a station's fade-out nor
 *   holds a station back, and it decodes in its own lane, so a long loose
 *   walk never delays the present station's content.
 * - **A part that throws** is left out and not built again for this table
 *   (a session): `onFailed` is said once.
 * - **Late renders are dropped.** A render that lands after its station was
 *   left (or the part replaced, or the table disposed) is disposed at once
 *   and never enters the scene.
 * - **One render at a time per lane**, in the order asked: "show all" on a
 *   long tour decodes one station's part after another, never every photo
 *   at once; the always-shown content has the second lane.
 *
 * Fades advance on `update(nowMs)`: the page calls it on every store change
 * and camera frame, and `registerFrame` (the AR frame loop) calls it every
 * rendered frame, so a fade is smooth on a phone and still finishes where
 * no frame loop runs (the e2e fakes).
 *
 * @see station-content.ts.md
 */

import { Group, type Object3D } from "three";
import { createLogger } from "gps-plus-slam-app-framework/utils/logger";

import {
  CONTENT_FADE_MS,
  setSubtreeOpacity,
  stepAlpha,
} from "./content-fade.js";
import { createKeyedChain } from "./keyed-chain.js";

const log = createLogger("StationContent");

/** What one part placed: its object count, what it could not place, and how
 *  to take it all out again (freeing its textures). */
export interface RenderedPart {
  readonly count: number;
  readonly skipped: readonly string[];
  dispose(): void;
}

/** One station's part: a recipe run each time the station is shown. */
export interface ContentPart {
  /** What it places: the tour's own items, the walk's photos, or the ring
   *  around a code. Counts are kept per kind. */
  readonly kind: "content" | "capture-spots" | "ring";
  /** Decode and place under `parent` (the station's group). `alive()` turns
   *  false once the result would be dropped: a long decode may stop early. */
  render(parent: Object3D, alive: () => boolean): Promise<RenderedPart>;
}

export interface StationContentDeps {
  /** Where a shown station's group is added (the scene root). */
  readonly scene: Object3D;
  /** The page clock (ms), read when a fade changes direction. */
  now(): number;
  /** The fade's length (ms); default `CONTENT_FADE_MS`. */
  readonly fadeMs?: number;
  /** Register a per-rendered-frame callback (the AR frame loop); returns
   *  its unregister. Absent: fades advance on `update` calls only. */
  registerFrame?(fn: () => void): () => void;
  /** A part's render was kept for a shown station (the viewing log). */
  onMounted?(
    stationId: string,
    rendered: RenderedPart,
    part: ContentPart,
  ): void;
  /** A part's render threw (a label or plane constructor): it is left out,
   *  for the table's life. */
  onFailed?(stationId: string, part: ContentPart, error: unknown): void;
  /** Content no station holds: shown whatever `show` says, outside the
   *  one-station-at-a-time rule, decoded in its own lane. Default: none. */
  alwaysShown?(stationId: string): boolean;
}

export interface StationContent {
  /** Set (null: remove) one named part of a station. A part replaced or
   *  removed is disposed; one added to a station already shown renders at
   *  once into its group. */
  setPart(stationId: string, key: string, part: ContentPart | null): void;
  /** The stations whose content should show; every other one fades out. */
  show(stationIds: ReadonlySet<string>): void;
  /** Advance the fades and let ready stations enter, at `nowMs`. */
  update(nowMs: number): void;
  /** Whether any station holds a part of this kind. */
  has(kind: ContentPart["kind"]): boolean;
  /** Whether anything shown now (a shown station, or always-shown content)
   *  holds a part: false while every part waits at a station not shown. */
  showsAny(): boolean;
  /** What stands, of this kind, for the stations shown now. */
  shown(kind: ContentPart["kind"]): { count: number; skipped: string[] };
  /** Take everything out and free it; later calls do nothing. */
  dispose(): void;
}

/**
 * The status line's view of the tour's own items (`tour-flow.ts`
 * `ArStatusInput.content`): none until a station holds one; then how many
 * stand for the stations shown now, and how many of those could not load.
 * A tour placed with no station shown reads "placed" with a count of 0.
 */
export function contentStatus(
  content: Pick<StationContent, "has" | "shown"> | null,
):
  | { readonly kind: "none" }
  | {
      readonly kind: "placed";
      readonly count: number;
      readonly skipped: number;
    } {
  if (content === null || !content.has("content")) return { kind: "none" };
  const shown = content.shown("content");
  return { kind: "placed", count: shown.count, skipped: shown.skipped.length };
}

/** The name of a station's group in the scene (what the e2e suite reads). */
function stationContentName(stationId: string): string {
  return `station-content:${stationId}`;
}

type Phase = "idle" | "loading" | "ready" | "in" | "out";

interface Entry {
  readonly id: string;
  readonly parts: Map<string, ContentPart>;
  /** Kept renders, by part key. */
  readonly rendered: Map<string, { part: ContentPart; result: RenderedPart }>;
  phase: Phase;
  group: Group | null;
  /** Bumped whenever the station's group is dropped: a render started
   *  before is stale. */
  token: number;
  /** Renders of this group still running (loading phase). */
  pending: number;
  alpha: number;
  lastMs: number;
}

export function createStationContent(deps: StationContentDeps): StationContent {
  const fadeMs = deps.fadeMs ?? CONTENT_FADE_MS;
  const entries = new Map<string, Entry>();
  const renders = createKeyedChain();
  const isAlways = (id: string): boolean => deps.alwaysShown?.(id) === true;
  /** Parts whose render threw: never built again by this table. */
  const failed = new WeakSet<ContentPart>();
  let wanted: ReadonlySet<string> = new Set();
  const isWanted = (id: string): boolean => isAlways(id) || wanted.has(id);
  let disposed = false;
  /** `show` is following the entries; an update asked meanwhile waits
   *  for its end (`updateDue`). */
  let following = false;
  let updateDue = false;
  const unregisterFrame =
    deps.registerFrame?.(() => {
      update(deps.now());
    }) ?? null;

  function entryOf(id: string): Entry {
    let entry = entries.get(id);
    if (entry === undefined) {
      entry = {
        id,
        parts: new Map(),
        rendered: new Map(),
        phase: "idle",
        group: null,
        token: 0,
        pending: 0,
        alpha: 0,
        lastMs: deps.now(),
      };
      entries.set(id, entry);
    }
    return entry;
  }

  /** Out of the scene, every render freed, back to idle. */
  function teardown(entry: Entry): void {
    entry.token += 1;
    if (entry.group !== null) {
      deps.scene.remove(entry.group);
      entry.group.removeFromParent();
    }
    for (const { result } of entry.rendered.values()) result.dispose();
    entry.rendered.clear();
    entry.group = null;
    entry.phase = "idle";
    entry.pending = 0;
    entry.alpha = 0;
  }

  /** Render one part into the entry's group, unless it goes stale first. */
  function renderPart(entry: Entry, key: string, part: ContentPart): void {
    const group = entry.group;
    if (group === null || failed.has(part)) return;
    const token = entry.token;
    const alive = (): boolean =>
      !disposed && entry.token === token && entry.parts.get(key) === part;
    const counted = entry.phase === "loading";
    if (counted) entry.pending += 1;
    const lane = isAlways(entry.id) ? "always" : "stations";
    void renders
      .run(lane, async () => (alive() ? part.render(group, alive) : null))
      .catch((error: unknown): null => {
        // A part that could not be placed is left out for good (not built
        // again on the next entry); the station shows the rest. Not one
        // whose station was left meanwhile: its throw may be the stop.
        if (alive()) {
          failed.add(part);
          deps.onFailed?.(entry.id, part, error);
        }
        return null;
      })
      .then((result) => {
        try {
          if (result !== null && !alive()) result.dispose();
          else if (result !== null) {
            entry.rendered.set(key, { part, result });
            // A part landing in a group already in the scene takes its
            // alpha.
            setSubtreeOpacity(group, entry.alpha);
            deps.onMounted?.(entry.id, result, part);
          }
        } catch (error: unknown) {
          // The mount stands; only its report failed.
          log.warn("a station content mount callback threw", error);
        } finally {
          // A throwing mount callback must not strand the station loading.
          if (counted && entry.token === token) settleOne(entry);
        }
      });
  }

  function settleOne(entry: Entry): void {
    entry.pending -= 1;
    if (entry.pending > 0 || entry.phase !== "loading") return;
    entry.phase = "ready";
    // Inside `show` the stations after this one are not marked leaving
    // yet: the update runs once `show` has followed every entry.
    if (following) updateDue = true;
    else update(deps.now());
  }

  function startLoading(entry: Entry): void {
    entry.group = new Group();
    entry.group.name = stationContentName(entry.id);
    entry.phase = "loading";
    entry.alpha = 0;
    for (const [key, part] of entry.parts) renderPart(entry, key, part);
    // Every part failed before (or none may be built): nothing pends.
    if (entry.pending === 0) {
      entry.pending = 1;
      settleOne(entry);
    }
  }

  /** Bring one entry in line with the wanted set. */
  function follow(entry: Entry): void {
    const want = isWanted(entry.id) && entry.parts.size > 0;
    switch (entry.phase) {
      case "idle":
        if (want) startLoading(entry);
        return;
      case "loading":
      case "ready":
        if (!want) teardown(entry);
        return;
      case "in":
        if (!want) {
          entry.phase = "out";
          entry.lastMs = deps.now();
        }
        return;
      case "out":
        if (want) {
          entry.phase = "in";
          entry.lastMs = deps.now();
        }
        return;
    }
  }

  function update(nowMs: number): void {
    if (disposed) return;
    for (const entry of entries.values()) {
      if (entry.phase !== "in" && entry.phase !== "out") continue;
      const target = entry.phase === "in" ? 1 : 0;
      const before = entry.alpha;
      entry.alpha = stepAlpha(
        entry.alpha,
        target,
        nowMs - entry.lastMs,
        fadeMs,
      );
      entry.lastMs = nowMs;
      if (entry.phase === "out" && entry.alpha <= 0) teardown(entry);
      else if (entry.group !== null && entry.alpha !== before) {
        // A settled fade writes no material (every frame would otherwise).
        setSubtreeOpacity(entry.group, entry.alpha);
      }
    }
    // The next station enters only once the last one is gone; always-shown
    // content neither waits nor holds a station back.
    const stationLeaving = [...entries.values()].some(
      (entry) => entry.phase === "out" && !isAlways(entry.id),
    );
    for (const entry of entries.values()) {
      if (entry.phase !== "ready" || entry.group === null) continue;
      if (stationLeaving && !isAlways(entry.id)) continue;
      setSubtreeOpacity(entry.group, 0);
      deps.scene.add(entry.group);
      entry.phase = "in";
      entry.alpha = 0;
      entry.lastMs = nowMs;
    }
  }

  return {
    setPart(stationId, key, part) {
      if (disposed) return;
      const entry = entryOf(stationId);
      if (entry.parts.get(key) === (part ?? undefined)) return;
      const kept = entry.rendered.get(key);
      if (kept !== undefined) {
        kept.result.dispose();
        entry.rendered.delete(key);
      }
      if (part === null) entry.parts.delete(key);
      else entry.parts.set(key, part);
      if (entry.parts.size === 0) {
        teardown(entry);
        return;
      }
      // A station that waits to enter (ready) waits for the new part too,
      // and then fades in from 0 with it, rather than the part popping in
      // at whatever opacity the fade reached.
      if (part !== null && entry.phase === "ready") entry.phase = "loading";
      if (part !== null && entry.phase !== "idle") renderPart(entry, key, part);
      else follow(entry);
    },
    showsAny() {
      for (const entry of entries.values()) {
        if (entry.parts.size > 0 && isWanted(entry.id)) return true;
      }
      return false;
    },
    show(stationIds) {
      if (disposed) return;
      wanted = new Set(stationIds);
      following = true;
      try {
        for (const entry of entries.values()) follow(entry);
      } finally {
        following = false;
      }
      if (updateDue) {
        updateDue = false;
        update(deps.now());
      }
    },
    update,
    has(kind) {
      for (const entry of entries.values()) {
        for (const part of entry.parts.values()) {
          if (part.kind === kind) return true;
        }
      }
      return false;
    },
    shown(kind) {
      let count = 0;
      const skipped: string[] = [];
      for (const entry of entries.values()) {
        if (!isWanted(entry.id)) continue;
        for (const { part, result } of entry.rendered.values()) {
          if (part.kind !== kind) continue;
          count += result.count;
          skipped.push(...result.skipped);
        }
      }
      return { count, skipped };
    },
    dispose() {
      if (disposed) return;
      for (const entry of entries.values()) teardown(entry);
      disposed = true;
      entries.clear();
      unregisterFrame?.();
    },
  };
}
