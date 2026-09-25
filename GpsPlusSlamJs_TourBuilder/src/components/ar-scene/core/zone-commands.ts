/**
 * Zone edges → scene commands (TASK.md §2.3.8: "given the store's per-object
 * zone states, decide which knights should currently be visible").
 *
 * Component 4 writes `zones.byWaypointId`; component 8 reacts to the **edges**,
 * not the levels (contract D15/§2.5). This module is the pure diff: two zone
 * snapshots in, an ordered command list out. Nothing here fetches, parses,
 * shows or disposes — the runtime executes what this decides.
 *
 * Component 4 guarantees single-step transitions, so `IDLE→ACTIVE` should never
 * appear. We still expand an illegal skip into its two legal steps rather than
 * throwing: a scene that renders correctly when its upstream misbehaves is worth
 * more than one that asserts. The expansion keeps the "build before show"
 * ordering that hides the parse jank (§2.5.3).
 *
 * @see plans/2026-07-31-ar-scene-plan.md §5
 */

import type { ZoneState } from "../../../store/types.js";

/** Per-waypoint zone snapshot (the `zones` slice shape). */
export type ZoneMap = Readonly<Record<string, ZoneState>>;

export type ZoneCommand =
  /** Enter PREFETCHING: request the asset, parse + instantiate INVISIBLY. */
  | { readonly kind: "build"; readonly id: string }
  /** Enter ACTIVE: flip visible, mark visited. */
  | { readonly kind: "show"; readonly id: string }
  /** Leave ACTIVE downward: hide, but keep the parsed model warm (contract §2.5). */
  | { readonly kind: "hide"; readonly id: string }
  /** Enter IDLE: drop the clone, release the blob refs, dispose the transcript. */
  | { readonly kind: "teardown"; readonly id: string };

/** Rank used to walk an illegal multi-zone jump one legal step at a time. */
const RANK: Readonly<Record<ZoneState, number>> = {
  IDLE: 0,
  PREFETCHING: 1,
  ACTIVE: 2,
};

/** The command for one single-step edge (`from` and `to` are adjacent). */
function commandForStep(
  id: string,
  from: ZoneState,
  to: ZoneState,
): ZoneCommand | null {
  if (from === "IDLE" && to === "PREFETCHING") return { kind: "build", id };
  if (from === "PREFETCHING" && to === "ACTIVE") return { kind: "show", id };
  if (from === "ACTIVE" && to === "PREFETCHING") return { kind: "hide", id };
  if (from === "PREFETCHING" && to === "IDLE") return { kind: "teardown", id };
  return null;
}

/**
 * Diff two zone snapshots into the commands the scene must execute, in order.
 *
 * - Waypoints present in `prev` but missing from `next` (tour cleared) are torn
 *   down from whatever zone they were in.
 * - A waypoint appearing for the first time is treated as coming from `IDLE`,
 *   which is exactly how `initZones` seeds it.
 */
export function diffZones(
  prev: ZoneMap,
  next: ZoneMap,
): readonly ZoneCommand[] {
  const commands: ZoneCommand[] = [];

  for (const [id, to] of Object.entries(next)) {
    const from = prev[id] ?? "IDLE";
    if (from === to) continue;
    pushSteps(commands, id, from, to);
  }

  for (const [id, from] of Object.entries(prev)) {
    if (id in next) continue;
    if (from === "IDLE") continue;
    pushSteps(commands, id, from, "IDLE");
  }

  return commands;
}

/** Walk `from → to` one adjacent zone at a time, emitting each step's command. */
function pushSteps(
  out: ZoneCommand[],
  id: string,
  from: ZoneState,
  to: ZoneState,
): void {
  const order: readonly ZoneState[] = ["IDLE", "PREFETCHING", "ACTIVE"];
  const step = RANK[to] > RANK[from] ? 1 : -1;
  for (let r = RANK[from]; r !== RANK[to]; r += step) {
    const command = commandForStep(id, order[r]!, order[r + step]!);
    if (command !== null) out.push(command);
  }
}

/**
 * Which waypoints should currently be visible — the literal §2.3.8 helper.
 * Visibility is exactly ACTIVE; PREFETCHING models exist but stay invisible.
 */
export function selectVisibleWaypointIds(zones: ZoneMap): readonly string[] {
  return Object.entries(zones)
    .filter(([, zone]) => zone === "ACTIVE")
    .map(([id]) => id);
}
