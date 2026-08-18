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
 * WHY IT IS NOW SEVEN (§2, DEC-R6-16). The slope treatment is a third
 * APPEARANCE — normal-space isoclines plus an aspect tint — and it becomes the
 * default (DEC-R6-5), demoting the height ramp to a mode. Splitting appearance
 * and strategy into two pickers was offered and REJECTED for the reason the
 * paragraph above already gives: enumerating combinations is what makes
 * DEC-R3-17 true by construction, and two independent controls would reintroduce
 * the greying-out rule this design exists to make unrepresentable.
 *
 * **The accepted cost is a seven-entry picker in a header round 5 already calls
 * busy.** The rejected alternative worth remembering is moving the CPU/GPU axis
 * behind a debug hotkey — it is a diagnostic wearing a user control's clothes —
 * which would shrink the picker to three entries at the price of making the
 * on-device comparison it exists for harder to reach.
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
  "cpu-slope",
  "cpu-ramp",
  "gpu",
  "gpu-slope",
  "gpu-ramp",
  "none",
] as const;

export type GroundMode = (typeof GROUND_MODES)[number];

/** Which path displaces the plane. Appearance is not a strategy. */
export type GroundStrategy = "cpu" | "gpu" | "none";

/**
 * How the ground is COLOURED, independently of how it is displaced.
 *
 * `plain` is the lit surface on its own; `slope` adds §2's isoclines and aspect
 * tint on top of it; `ramp` swaps in the unlit hypsometric material.
 *
 * Named as its own union so `building-view` can switch on the appearance
 * without re-deriving it from the mode string in two places — the shape that
 * produced the `GroundDisplacement` type hole round 5 had to fix.
 */
export type GroundAppearance = "plain" | "slope" | "ramp";

/**
 * The mode a session starts in (§2, DEC-R6-5).
 *
 * CPU because that is the strategy that shipped; SLOPE because it answers the
 * standing complaint the ramp does not. R5-2 reports that the terrain reads as
 * flat; a height ramp recolours flat-looking ground and leaves it looking flat
 * in a different colour, while contour lines of slope make the SHAPE legible.
 *
 * **THIS REVERSES DEC-R5-4**, which made the ramp the default barely a day
 * earlier — and there is now a measurement behind the reversal rather than only
 * a preference. The DEC-R4-5 gate added in §1 found that with the height ramp
 * on, the ground OUT-SATURATES the affordance grid: the ramp is a deliberately
 * loud blue-to-white scale with magenta for missing DEM, and DEC-R4-5 says the
 * heat ramp must stay the loudest thing on screen. The diagnostic was breaching
 * the constraint it was supposed to sit beneath.
 *
 * The ramp is NOT deleted. "Did the DEM load, or is this place just flat?" is a
 * real question and the ramp answers it best; it is a mode now rather than the
 * default.
 */
export const DEFAULT_GROUND_MODE: GroundMode = "cpu-slope";

/** Human-readable, for the picker. */
export function groundModeLabel(mode: GroundMode): string {
  switch (mode) {
    case "cpu":
      return "CPU ground";
    case "cpu-slope":
      return "CPU ground + slope";
    case "cpu-ramp":
      return "CPU ground + height ramp";
    case "gpu":
      return "GPU ground";
    case "gpu-slope":
      return "GPU ground + slope";
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
    case "cpu-slope":
    case "cpu-ramp":
      return "cpu";
    case "gpu":
    case "gpu-slope":
    case "gpu-ramp":
      return "gpu";
    case "none":
      return "none";
  }
}

/**
 * Whether a click on the ground yields a destination worth trusting.
 *
 * **ONLY THE CPU PATH DISPLACES THE POSITION BUFFER**, and the raycaster reads
 * nothing else. `BuildingView.setTerrain` skips the CPU displacement entirely
 * when the strategy is not `cpu` — that is the whole point of the W23
 * comparison, which measures the two paths against each other — so under `gpu`
 * the plane the ray meets is FLAT while the plane the user is looking at is
 * displaced in the vertex shader.
 *
 * The error is HORIZONTAL, which is what makes it worth refusing rather than
 * tolerating: `main.ts` reads `x` and `z` off the hit to name a lat/lng, so an
 * oblique click on a hillside lands roughly `relief / tan(elevation)` away from
 * where the user pointed. Heidelberg is in the corpus precisely because it has
 * tens of metres of relief inside one tile.
 *
 * `none` is refused for the plainer reason: there is no ground on screen to
 * click, and ordering an agent onto an invisible surface is a click with no
 * visible cause.
 *
 * Raised in review on #274.
 */
export function groundIsOrderable(strategy: GroundStrategy): boolean {
  return strategy === "cpu";
}

/** How a mode colours the ground. */
export function groundAppearance(mode: GroundMode): GroundAppearance {
  switch (mode) {
    case "cpu-slope":
    case "gpu-slope":
      return "slope";
    case "cpu-ramp":
    case "gpu-ramp":
      return "ramp";
    case "cpu":
    case "gpu":
    case "none":
      return "plain";
  }
}

/** Whether the height-ramp material is used. */
export function groundShowsRamp(mode: GroundMode): boolean {
  return groundAppearance(mode) === "ramp";
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
