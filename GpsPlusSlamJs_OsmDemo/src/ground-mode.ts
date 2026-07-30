/**
 * Which surface is drawn as the ground: CPU terrain, GPU terrain, or none.
 *
 * WHY IT IS A MODE AND NOT A LAYER (DEC-R3-3). `ALL_LAYERS` means "things the
 * scene can draw", and these three are not three things — they are one thing
 * drawn three ways, two of which are the same surface produced by different
 * paths. The round-2 A/B toggle (`GPU ground`, W23) was kept out of the registry
 * for exactly that reason and this keeps it out.
 *
 * WHY IT GAINED A THIRD STATE. The round-3 notes asked for a dropdown over
 * "OpenStreetMap ground / CPU ground / GPU ground", to fix ground areas being
 * invisible under the terrain. Two of those three are not the same kind of
 * thing: the OSM ground areas are CONTENT — the `plates` layer — while CPU and
 * GPU are strategies for the same terrain, so one exclusive picker would have
 * made "OSM areas lying on the terrain", the physically correct picture the
 * geometry is built for, unselectable. The owner's revision was `CPU / GPU /
 * No ground`, with `plates` staying an ordinary layer: the terrain can be taken
 * away to inspect the areas alone, and every combination stays reachable.
 *
 * The invisibility itself is fixed by W10 rather than by this control.
 *
 * @see ground-mode.ts.md
 */

/** The modes, in the order the picker offers them. */
export const GROUND_MODES = ["cpu", "gpu", "none"] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

/** The mode a session starts in: the CPU path, as before this control existed. */
export const DEFAULT_GROUND_MODE: GroundMode = "cpu";

/** Human-readable, for the picker. */
export function groundModeLabel(mode: GroundMode): string {
  switch (mode) {
    case "cpu":
      return "CPU ground";
    case "gpu":
      return "GPU ground";
    case "none":
      return "No ground";
  }
}

/**
 * Narrows an untrusted string, falling back to the default.
 *
 * UNTRUSTED because the store holds this as a plain `string` — the framework
 * slice may not name a demo type (the publish boundary that made `layers` a
 * `Record<string, boolean>`) — and because this is a candidate for a URL
 * parameter. Falling back rather than throwing: an unknown mode should leave the
 * demo usable, and "the ground vanished because of a typo in a query string" is
 * the worst of the available outcomes.
 */
export function parseGroundMode(value: string | undefined): GroundMode {
  return (GROUND_MODES as readonly string[]).includes(value ?? "")
    ? (value as GroundMode)
    : DEFAULT_GROUND_MODE;
}

/**
 * Whether the terrain height ramp can do anything in this mode (DEC-R3-17).
 *
 * `terrainDebug` re-colours the ground plane IN PLACE rather than adding a
 * surface of its own (`layer-order.ts` says so), so with the plane hidden the
 * switch is a control that does nothing — which is the shape of half the
 * findings this round is about. The UI disables it rather than hiding it, so it
 * does not appear to vanish, and its value survives the return to `cpu`/`gpu`.
 */
export function groundDebugAvailable(mode: GroundMode): boolean {
  return mode !== "none";
}
