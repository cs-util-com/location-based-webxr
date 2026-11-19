/**
 * The city's look on the page: which colours the drawn city wears and how
 * bright its neutral surfaces are. One owner for the scheme of the mesh
 * being drawn, the time-of-day look weights, the shared look mix, the
 * plates' colour, the scheme's brightness trim and the noon gain, so a
 * rebuilt city, a new set of weights and a scheme switch all read the same
 * held values. Three.js objects only; the state the app is about (the
 * scheme chosen, the sun) lives in the store, and this holds what was last
 * drawn from it.
 *
 * @see city-look.ts.md
 */

import type * as THREE from "three";
import {
  createLookMix,
  setTreeLookWeights,
  setTrimWeights,
  type LookMix,
} from "gps-plus-slam-osm/three";

import {
  colourSchemeOf,
  MAX_BRIGHTNESS_TRIM,
  MIN_BRIGHTNESS_TRIM,
} from "./colour-schemes.js";
import type { GroundSlopeColours } from "./ground-slope-colours.js";
import { TIME_OF_DAY } from "./look-choice.js";
import {
  applySurfaceGain,
  drawMeshLayers,
  LANDUSE_PLATE_TAG,
  NEUTRAL_CONTEXT,
  type BuildingStats,
  type MeshLayerContext,
  type MeshLayers,
} from "./mesh-layers.js";
import { mixedPageLook } from "./mixed-page-look.js";
import type { TransferableMesh } from "./worker/protocol.js";

/** What the city look writes to beyond its own objects (`CityLook`). */
export interface CityLookTargets {
  /** The city's root: buildings, roads, plates and trees are drawn under it. */
  readonly root: THREE.Object3D;
  /** The ground's material colour (sRGB `0xrrggbb`) and slope colours. */
  readonly setGroundColours: (
    ground: number,
    slope: GroundSlopeColours,
  ) => void;
  /** The land-use tint's look weights; undefined for a fixed scheme. */
  readonly setLandUseLookWeights: (
    lookWeights: readonly number[] | undefined,
  ) => void;
}

/** The caller's part of a draw context: the look decides the plates and the mix. */
export type CityDrawContext = Omit<
  MeshLayerContext,
  "drawnHostLayers" | "looks" | "plateColour"
>;

/**
 * The smallest weight move that re-mixes the drawn trees: one 8-bit step.
 * Their mix is a CPU pass over every tree instance, the one cost of a sun
 * step that grows with the city; the looks' colours are 8-bit, so a move
 * below one step per weight shifts a tree by about one display step at
 * most, which a moving sun hides, while a sun step moves the weights by far
 * less (a timelapse frame by about 1/1000).
 */
export const TREE_MIX_STEP = 1 / 255;

/**
 * The page's city look (see the file header). Every setter is a uniform,
 * colour or material write, never a rebuild.
 */
export class CityLook {
  /** The shared mix every look material of a time-of-day build reads. */
  readonly mix: LookMix = createLookMix();
  private surfaceGain = 1;
  private brightnessTrim = 1;
  private weights: readonly number[] | undefined;
  private plateColour = colourSchemeOf(undefined).ground.plates;
  /** The weights the drawn trees were last mixed at. */
  private treeWeights: readonly number[] | undefined;

  constructor(private readonly targets: CityLookTargets) {}

  /** The look weights last set, or undefined while a fixed scheme is drawn. */
  get lookWeights(): readonly number[] | undefined {
    return this.weights;
  }

  /** The surface gain times the trim, as the neutral surfaces wear it. */
  get neutralSurfaceFactor(): number {
    return this.surfaceGain * this.brightnessTrim;
  }

  /**
   * Follows the scheme a drawn mesh was BUILT in (`mesh.colourScheme`),
   * never the viewer's choice, so the ground never changes before the
   * buildings it belongs with: a time-of-day build takes `lookWeights`,
   * a fixed scheme its own ground, slope, plates and brightness trim.
   */
  followScheme(
    scheme: string | undefined,
    lookWeights: readonly number[],
  ): void {
    if (scheme === TIME_OF_DAY) {
      this.setLookWeights(lookWeights);
      return;
    }
    const look = colourSchemeOf(scheme);
    this.setLookWeights(undefined);
    this.targets.setGroundColours(look.city.ground, look.ground.slope);
    this.setPlateColour(look.ground.plates);
    this.setBrightnessTrim(look.brightnessTrim);
  }

  /**
   * The time-of-day blend's normalised look weights (one per
   * `TIME_OF_DAY_LOOKS` entry), or undefined for a fixed scheme. With
   * weights everything the looks colour follows them at once: the ground
   * and slope, the plates, the land-use tint, the drawn trees (a CPU mix,
   * redone only once a weight has moved by `TREE_MIX_STEP` since the last)
   * and the buildings and roads (the trim weights carry each look's
   * brightness trim, so the material trim goes to 1). RangeError for
   * weights `mixedPageLook` refuses; nothing changes then.
   */
  setLookWeights(lookWeights: readonly number[] | undefined): void {
    if (lookWeights === undefined) {
      this.weights = undefined;
      this.treeWeights = undefined;
      this.targets.setLandUseLookWeights(undefined);
      return;
    }
    const mixed = mixedPageLook(lookWeights);
    this.weights = lookWeights;
    setTrimWeights(this.mix, mixed.trimWeights);
    this.setBrightnessTrim(1);
    this.targets.setLandUseLookWeights(lookWeights);
    const trees = this.treeWeights;
    if (
      trees === undefined ||
      lookWeights.some((w, k) => Math.abs(w - (trees[k] ?? 0)) >= TREE_MIX_STEP)
    ) {
      setTreeLookWeights(this.targets.root.children, lookWeights);
      this.treeWeights = lookWeights;
    }
    this.setPlateColour(mixed.plates);
    this.targets.setGroundColours(mixed.ground, mixed.slope);
  }

  /**
   * A fixed scheme's brightness trim, multiplied into the noon gain on the
   * neutral surfaces (buildings and roads) and nothing else. RangeError
   * outside the schemes' trim range. Returns whether it changed.
   */
  setBrightnessTrim(trim: number): boolean {
    if (
      !Number.isFinite(trim) ||
      trim < MIN_BRIGHTNESS_TRIM ||
      trim > MAX_BRIGHTNESS_TRIM
    ) {
      throw new RangeError(
        `brightness trim ${String(trim)} is outside ${MIN_BRIGHTNESS_TRIM}-${MAX_BRIGHTNESS_TRIM}`,
      );
    }
    if (trim === this.brightnessTrim) return false;
    this.brightnessTrim = trim;
    applySurfaceGain(this.targets.root, this.neutralSurfaceFactor);
    return true;
  }

  /** The noon gain (`surfaceGainAt`); RangeError unless positive and finite. */
  setSurfaceGain(gain: number): void {
    applySurfaceGain(this.targets.root, gain * this.brightnessTrim);
    this.surfaceGain = gain;
  }

  /**
   * Draws `mesh` under the root in the held look: a time-of-day build with
   * weights on the shared mix, its trees mixed; the plates in the held
   * colour; the neutral surfaces at the held gain and trim (new meshes
   * arrive at 1). Returns what `drawMeshLayers` drew.
   */
  draw(
    mesh: TransferableMesh,
    layers: MeshLayers | undefined,
    context: CityDrawContext | undefined,
  ): { objects: THREE.Object3D[]; stats: BuildingStats } {
    const weights =
      mesh.colourScheme === TIME_OF_DAY ? this.weights : undefined;
    const drawn = drawMeshLayers(
      mesh,
      layers,
      { ...(context ?? NEUTRAL_CONTEXT), plateColour: this.plateColour },
      weights === undefined ? undefined : this.mix,
    );
    for (const object of drawn.objects) this.targets.root.add(object);
    // New trees are always mixed, at the weights held now; the drawn ones
    // may sit up to one step behind, which no stored colour shows.
    if (weights !== undefined) setTreeLookWeights(drawn.objects, weights);
    applySurfaceGain(this.targets.root, this.neutralSurfaceFactor);
    return drawn;
  }

  /** Recolours the drawn plates and holds the colour for the next draw. */
  private setPlateColour(hex: number): void {
    this.plateColour = hex;
    this.targets.root.traverse((object) => {
      if (object.userData[LANDUSE_PLATE_TAG] !== true) return;
      const material = (object as THREE.Mesh).material as
        THREE.MeshStandardMaterial | undefined;
      material?.color.setHex(hex);
    });
  }
}
