/**
 * How the ground is drawn: which path displaces it, and how it is coloured.
 *
 * WHY IT IS A MODE AND NOT A LAYER (DEC-R3-3). `ALL_LAYERS` means "things the
 * scene can draw", and the CPU and GPU entries are not two things — they are one
 * surface produced by different paths. The round-2 A/B toggle (`GPU ground`,
 * W23) was kept out of the registry for exactly that reason and this keeps it
 * out.
 *
 * WHY IT GAINED A THIRD STATE. The round-3 notes asked for a dropdown over
 * "OpenStreetMap ground / CPU ground / GPU ground", to fix ground areas being
 * invisible under the terrain. Two of those three are not the same kind of
 * thing: the OSM ground areas are CONTENT — the `plates` layer — while CPU and
 * GPU are strategies for the same terrain, so one exclusive picker would have
 * made "OSM areas lying on the terrain", the physically correct picture the
 * geometry is built for, unselectable. The owner's revision was `CPU / GPU /
 * No ground`, with `plates` staying an ordinary layer.
 *
 * WHY IT IS NOW FIVE, AND WHY THAT IS NOT JUST "MORE" (W6, DEC-R5-4). The height
 * ramp used to be `terrainDebug`, a switch in the layer registry, and round 5
 * asked for it to become the default appearance. It was never really a layer: it
 * re-colours the ground plane IN PLACE rather than adding a surface, which is
 * why it needed a special "greyed out under No ground" rule that no other layer
 * has.
 *
 * The obvious fold — CPU / GPU / Height ramp / No ground — was offered and
 * REJECTED, because choosing the ramp would then silently choose a strategy too,
 * and the CPU-vs-GPU comparison is the whole reason this picker exists. So the
 * list enumerates every combination of the two axes instead. That keeps both
 * independently reachable without adding a second control to a header the same
 * round's feedback already calls too busy, and it makes DEC-R3-17 true by
 * CONSTRUCTION: there is no `none-ramp` entry to choose, so no control can be
 * offered that does nothing.
 *
 * @see ground-mode.ts.md
 */

/**
 * The modes, in the order the picker offers them.
 *
 * Grouped by strategy rather than by appearance, so each ramp entry sits next to
 * the plain entry it modifies and the list reads as "CPU, CPU with the ramp,
 * GPU, GPU with the ramp, off".
 */
export const GROUND_MODES = [
  "cpu",
  "cpu-ramp",
  "gpu",
  "gpu-ramp",
  "none",
] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

/** Which path displaces the plane. The ramp is a material, not a strategy. */
export type GroundStrategy = "cpu" | "gpu" | "none";

/**
 * The mode a session starts in (DEC-R5-4).
 *
 * CPU because that is the strategy that shipped; the ramp because the owner
 * asked for it after looking at the plain ground during the long first load.
 * **This overrides DEC-R4-5's standing "the height ramp stays off by default"**,
 * taken twenty hours earlier — and the reason that decision gave has not
 * expired, so the palette is the thing to watch: the affordance heat ramp must
 * still be the loudest thing on screen now that building and road colours have
 * landed.
 */
export const DEFAULT_GROUND_MODE: GroundMode = "cpu-ramp";

/** Human-readable, for the picker. */
export function groundModeLabel(mode: GroundMode): string {
  switch (mode) {
    case "cpu":
      return "CPU ground";
    case "cpu-ramp":
      return "CPU ground + height ramp";
    case "gpu":
      return "GPU ground";
    case "gpu-ramp":
      return "GPU ground + height ramp";
    case "none":
      return "No ground";
  }
}

/**
 * Which displacement path a mode drives.
 *
 * `building-view` cares about this and nothing else: the ramp is a material swap
 * on the same plane, and BOTH materials carry the displacement, so switching
 * appearance must not re-apply the terrain or recompile a shader.
 */
export function groundStrategy(mode: GroundMode): GroundStrategy {
  switch (mode) {
    case "cpu":
    case "cpu-ramp":
      return "cpu";
    case "gpu":
    case "gpu-ramp":
      return "gpu";
    case "none":
      return "none";
  }
}

/** Whether the height-ramp material is used. */
export function groundShowsRamp(mode: GroundMode): boolean {
  return mode === "cpu-ramp" || mode === "gpu-ramp";
}

/**
 * Narrows an untrusted string, falling back to the default.
 *
 * UNTRUSTED because the store holds this as a plain `string` — the framework
 * slice may not name a demo type — and because this is a candidate for a URL
 * parameter. Falling back rather than throwing: an unknown mode should leave the
 * demo usable, and "the ground vanished because of a typo in a query string" is
 * the worst of the available outcomes.
 *
 * THIS IS ALSO THE WHOLE MIGRATION for the retired `terrainDebug` layer, and
 * that is a finding rather than an omission. Nothing persists the demo's layer
 * set — `osm-store.ts` uses a plain `configureStore` with none of the framework's
 * persistence middleware — and `serialiseLayers`/`parseLayers` have no
 * production caller, so a stored or URL-supplied `terrainDebug` has never been
 * reachable. The fallback above covers it; new migration code would be machinery
 * for a state that cannot exist.
 */
export function parseGroundMode(value: string | undefined): GroundMode {
  return (GROUND_MODES as readonly string[]).includes(value ?? "")
    ? (value as GroundMode)
    : DEFAULT_GROUND_MODE;
}
