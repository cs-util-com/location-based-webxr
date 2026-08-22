/**
 * Named looks for the affordance grid, cycled by a hotkey (§3, DEC-R6-9/10/22).
 *
 * WHY THIS STAGE EXISTS AT ALL, given the shiny-surfaces work already shipped.
 * That round moved the cells from `MeshBasicMaterial` to a lit
 * `MeshStandardMaterial` at opacity 0.8 with faked bevel normals — and the owner
 * looked at the result and still preferred the prototype. So this is not "make
 * it shiny" a second time; it is a structured experiment over the four
 * ingredients that were NOT copied.
 *
 * **LOOK BEFORE TUNING.** §1 changed the exposure of the whole scene (ACES) and
 * gave every surface an environment map. Half of "shinier" is exposure, so some
 * of the remaining gap may already be closed — and §10.2 of the shiny-surfaces
 * plan (emissive at 0.85 flattening the bevel) was measured under the OLD
 * lighting and should be assumed invalid.
 *
 * PRESETS RATHER THAN PER-AXIS TOGGLES (DEC-R6-10). Four independent switches is
 * sixteen combinations, which means no combination is tested and the e2e suite
 * cannot pin a default. These axes also interact — opacity changes what the
 * bevel is worth, height changes what opacity is worth — so whole looks are what
 * a person actually judges.
 *
 * WHEN THIS FILE GOES AWAY (DEC-R6-22). When a preset wins it becomes the
 * default and the losing branches are deleted in the same commit as the
 * decision. **That cannot happen until §6 has landed**, because two of the axes
 * are premised on the wider heat radius: the opacity trade is only bearable
 * because the grid covers a ~326 m disc today, and `fog: false` is a no-op until
 * the cells reach far enough for haze to touch them.
 *
 * @see cell-presets.ts.md
 */

/** One named look. Every field is stated on every preset — see `CELL_PRESETS`. */
export interface CellPreset {
  readonly name: string;
  /** Shown in the hotkey help and the status line. */
  readonly description: string;
  /**
   * Face opacity, 0..1.
   *
   * The specular is exactly the part alpha eats, so at 0.55 the highlight the
   * lit material exists for is 55 % of a highlight. Fully opaque hides the
   * ground beneath — which since §2 is the slope treatment, so this trade got
   * more expensive rather than less.
   */
  readonly opacity: number;
  /**
   * Give each cell real thickness with side faces, rather than a faked bevel.
   *
   * The side faces catch light at a different angle from the top, which is a
   * large part of what makes the prototype's tiles read as objects. Costs
   * vertices in the worker on every publish.
   */
  readonly extrude: boolean;
  /**
   * Scale each cell's height by its score, so the overlay is a bar field.
   *
   * The "Inversion" prototype's idea, recorded in §9 of the shiny-surfaces plan
   * and never tried. Colour and height then carry the same value redundantly, so
   * a tile reads at any opacity because its silhouette carries the score.
   *
   * **The axis most in tension with DEC-R4-5**: it doubles the visual weight of
   * the loudest cells, which is what that constraint is about.
   */
  readonly heightByScore: boolean;
  /** Exempt the grid from distance haze, as the prototype's overlay is. */
  readonly fog: boolean;
  /**
   * Extra metres between the terrain and the grid.
   *
   * The prototype's tiles float clear of its city, and that isolation is part of
   * why they pop. It also breaks the "this cell IS this ground" reading, which
   * is the overlay's entire claim — so it is an axis rather than a setting.
   */
  readonly liftM: number;
}

/**
 * How tall an extruded cell is, in metres, before any score scaling.
 *
 * BOUNDED BY THE LAYER LADDER, not chosen for looks: `layer-order.ts` allows
 * 0.04 m per layer step, and a prism taller than its step punches through
 * whatever sits above it. This is deliberately under that.
 */
export const CELL_PRISM_HEIGHT_M = 0.03;

/**
 * The tallest a score-scaled cell may become, in metres.
 *
 * Far above the layer step, and that is accepted: a bar field is explicitly NOT
 * a thin overlay, so it leaves the ladder's regime on purpose. If it wins, the
 * ladder has to be revisited rather than the height reduced — which is a thing
 * to know before judging it.
 */
export const CELL_BAR_MAX_HEIGHT_M = 8;

/**
 * The looks, in cycling order.
 *
 * `current` is FIRST and is the default, so the suite pins what ships and the
 * hotkey walks away from it rather than towards it.
 */
export const CELL_PRESETS: readonly CellPreset[] = [
  {
    name: "current",
    description: "as shipped: 0.8 opacity, faked bevel",
    opacity: 0.8,
    extrude: false,
    heightByScore: false,
    fog: true,
    liftM: 0,
  },
  {
    name: "opaque",
    description: "fully opaque, faked bevel — the cheapest axis on its own",
    opacity: 1,
    extrude: false,
    heightByScore: false,
    fog: true,
    liftM: 0,
  },
  {
    name: "prototype",
    description: "opaque prisms, no fog, lifted clear of the ground",
    opacity: 1,
    extrude: true,
    heightByScore: false,
    fog: false,
    liftM: 0.5,
  },
  {
    name: "bars",
    description: "score as height — colour and silhouette carry the same value",
    opacity: 1,
    extrude: true,
    heightByScore: true,
    fog: true,
    liftM: 0,
  },
  {
    name: "translucent",
    description: "0.55 opacity, matching the 2D map's fill",
    opacity: 0.55,
    extrude: false,
    heightByScore: false,
    fog: true,
    liftM: 0,
  },
];

/** The preset a session starts in, and the one the e2e suite pins. */
export const DEFAULT_CELL_PRESET = "current";

/** A preset by name, falling back to the default rather than throwing. */
export function cellPreset(name: string): CellPreset {
  const found = CELL_PRESETS.find((preset) => preset.name === name);
  // Falling back rather than throwing: this is a candidate for a URL parameter
  // and a typo should leave the demo usable, exactly as `parseGroundMode` does.
  return found ?? (CELL_PRESETS[0] as CellPreset);
}

/**
 * The next preset in the cycle, wrapping.
 *
 * An unknown name starts the cycle from the beginning rather than getting stuck.
 */
export function nextCellPreset(name: string): string {
  const index = CELL_PRESETS.findIndex((preset) => preset.name === name);
  const next = CELL_PRESETS[(index + 1) % CELL_PRESETS.length];
  return next?.name ?? DEFAULT_CELL_PRESET;
}

/**
 * Whether two presets differ in a way the WORKER has to rebuild for.
 *
 * Opacity, fog and lift are material and transform changes the view can make on
 * its own; extrusion and bar height change the vertex buffers, which are built
 * in the worker. Cycling should not pay for a republish it does not need — and
 * more importantly, a caller that rebuilt on every press would make the hotkey
 * feel broken on a large working set.
 */
export function needsMeshRebuild(from: CellPreset, to: CellPreset): boolean {
  return from.extrude !== to.extrude || from.heightByScore !== to.heightByScore;
}
