/**
 * The land-use tint on the demo's lit ground material: which tint is applied,
 * whether it shows, and what colour the material has without one.
 *
 * WHY A MODULE AND NOT THREE FIELDS IN `building-view.ts`. Three inputs decide
 * what the ground shows - the tint of the latest full build, the
 * "land-use colours" layer switch, and the ground appearance (the height ramp
 * swaps in another material, so the tint is off there, owner Q6 of the city
 * objects plan 2026-11-07-2315) - and they arrive at different times: a build
 * reply, a click on the switch, a pick in the ground menu. Spread over the view
 * they would be three places that each have to remember the other two. Here
 * one rule says it: drawn = a tint is applied AND wanted AND not the ramp.
 *
 * THE MATERIAL COLOUR HAS ONE OWNER IN BOTH STATES (colour schemes plan
 * 2026-11-10-0841 section 4.3, review MAJOR 1). With a tint applied the
 * material is white and the patch multiplies by the tint's neutral (the
 * scheme's ground) or a class colour; without one the material carries the
 * scheme's ground itself. `setGroundColour` stores the ground and writes it
 * only while no tint is applied, so switching the tint off never squares the
 * neutral and dropping a tint never restores a stale colour.
 *
 * @see land-use-tint.ts.md
 */

import type * as THREE from "three";
import type { GroundTint } from "gps-plus-slam-osm";
import {
  applyGroundTint,
  type AppliedGroundTint,
} from "gps-plus-slam-osm/three";

import type { GroundAppearance } from "./ground-mode.js";

export interface LandUseTint {
  /**
   * The tint of the latest full build, or `undefined` when the build carried
   * none. Replaces (and frees) the previous one; the same object again is a
   * no-op.
   */
  setTint(tint: GroundTint | undefined): void;
  /** The "land-use colours" layer switch. */
  setWanted(wanted: boolean): void;
  /** The ground appearance; `ramp` hides the tint. */
  setAppearance(appearance: GroundAppearance): void;
  /**
   * The scheme's ground as a packed sRGB `0xrrggbb`: the material colour while
   * no tint is applied. `RangeError` for anything but an integer in range.
   */
  setGroundColour(rgb: number): void;
  /** Whether the tint is drawn now. */
  showing(): boolean;
  /** Frees the applied tint and leaves the material with the ground colour. */
  dispose(): void;
}

export interface LandUseTintOptions {
  /** Starts wanted (the layer's default is on). */
  readonly wanted?: boolean;
  readonly appearance?: GroundAppearance;
  /** The renderer's maximum anisotropy, for a grazing view of the texture. */
  readonly anisotropy?: number;
}

/** Controls the land-use tint on `material`, which starts untinted. */
export function landUseTint(
  material: THREE.MeshStandardMaterial,
  options: LandUseTintOptions = {},
): LandUseTint {
  let wanted = options.wanted ?? true;
  let appearance: GroundAppearance = options.appearance ?? "plain";
  let groundRgb = material.color.getHex();
  let current: GroundTint | undefined;
  let applied: AppliedGroundTint | undefined;

  const wantedNow = (): boolean => wanted && appearance !== "ramp";
  const sync = (): void => applied?.setEnabled(wantedNow());
  const drop = (): void => {
    applied?.dispose();
    applied = undefined;
    material.color.setHex(groundRgb);
  };

  return {
    setTint(tint) {
      if (tint === current) return;
      drop();
      current = tint;
      if (tint === undefined) return;
      applied = applyGroundTint(material, tint, {
        enabled: wantedNow(),
        anisotropy: options.anisotropy ?? 1,
      });
    },
    setWanted(next) {
      wanted = next;
      sync();
    },
    setAppearance(next) {
      appearance = next;
      sync();
    },
    setGroundColour(rgb) {
      if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff) {
        throw new RangeError(`ground colour ${String(rgb)} is not 0xrrggbb`);
      }
      groundRgb = rgb;
      if (applied === undefined) material.color.setHex(rgb);
    },
    showing: () => applied !== undefined && wantedNow(),
    dispose() {
      drop();
      current = undefined;
    },
  };
}
