/**
 * HUD status summary — turns the REAL HUD scene state (the indicator meshes
 * the framework presenter attached to the camera) plus the target list into
 * a one-line DOM status.
 *
 * Deliberately reads the presenter's OUTPUT (camera children by name +
 * visibility) instead of re-running the placement math: the status line is
 * then evidence of what the HUD actually shows, which is what the Playwright
 * walk-flow spec asserts hysteresis transitions against.
 *
 * The entrance readout is the one exception to "scene output only": redraw
 * counts and their cost are not in the scene graph, so the presenter's
 * `entranceStats()` is passed in as a fourth input (HUD diamond entrance
 * plan, M4) — it is the number the owner reads on the headset to judge the
 * animation's cost against the 11 ms frame budget.
 */

import type * as THREE from "three";
import type { EntranceStats } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

/** The structural slice of a camera child the summary reads.
 * `isSprite` is three.js's Sprite marker — absent (undefined) on meshes. */
export interface HudIndicatorLike {
  readonly name: string;
  readonly visible: boolean;
  readonly isSprite?: boolean;
}

/** How the HUD renders its indicators — sprites (image toggle) vs meshes
 * (procedural cone/ring). "mixed" is a Sprite circle next to a Mesh arrow:
 * the framework's `circleEntrance` without `arrowSprite` produces it, the
 * demo's own derivation never does (image indicators gate the entrance).
 * (Module-private: consumers read it via `HudSceneSummary["indicatorStyle"]`.) */
type IndicatorStyle = "procedural" | "image" | "mixed";

export interface HudSceneSummary {
  targets: number;
  /** Visible edge arrows (off-screen targets). */
  arrows: number;
  /** Visible on-screen rings. */
  rings: number;
  /** Targets with no visible indicator (hidden / "arrived"). */
  hidden: number;
  /** Distance to the nearest target in meters, or null with no targets. */
  nearest: number | null;
  /** Indicator render style, or null while no indicators exist. */
  indicatorStyle: IndicatorStyle | null;
  /** The presenter's entrance readout for the last frame, or null when not passed. */
  entrance: EntranceStats | null;
}

function countVisible(
  children: readonly HudIndicatorLike[],
  name: string,
): number {
  let count = 0;
  for (const child of children) {
    if (child.name === name && child.visible) count += 1;
  }
  return count;
}

/**
 * Derive the render style from the indicator children's object kind —
 * the presenter names sprite and mesh indicators identically, so `isSprite`
 * is the only distinguishing signal. Deliberately ignores visibility (the
 * style is knowable while everything is hidden) and the label sprite
 * (always a THREE.Sprite regardless of the toggle).
 */
function deriveIndicatorStyle(
  children: readonly HudIndicatorLike[],
): IndicatorStyle | null {
  let sprites = 0;
  let meshes = 0;
  for (const child of children) {
    if (child.name !== "wayfinding-arrow" && child.name !== "wayfinding-circle")
      continue;
    if (child.isSprite) sprites += 1;
    else meshes += 1;
  }
  if (sprites === 0 && meshes === 0) return null;
  if (sprites > 0 && meshes > 0) return "mixed";
  return sprites > 0 ? "image" : "procedural";
}

/**
 * Summarize the HUD's current scene output for a target list.
 * `cameraChildren` is the presenter's camera `.children` array (extra
 * non-HUD children are ignored by name). `entrance` is the presenter's
 * `entranceStats()` for the frame, when the host has it.
 */
export function summarizeHudScene(
  cameraChildren: readonly HudIndicatorLike[],
  cameraPosition: THREE.Vector3,
  targets: readonly THREE.Vector3[],
  entrance: EntranceStats | null = null,
): HudSceneSummary {
  const arrows = countVisible(cameraChildren, "wayfinding-arrow");
  const rings = countVisible(cameraChildren, "wayfinding-circle");
  let nearest: number | null = null;
  for (const target of targets) {
    const distance = cameraPosition.distanceTo(target);
    if (nearest === null || distance < nearest) nearest = distance;
  }
  return {
    targets: targets.length,
    arrows,
    rings,
    hidden: Math.max(0, targets.length - arrows - rings),
    nearest,
    indicatorStyle: deriveIndicatorStyle(cameraChildren),
    entrance,
  };
}

/**
 * The entrance readout in two parts: the per-frame trio (animating count,
 * redraws, their milliseconds) only while an entrance animates or redrew in
 * this frame, and the accumulated pair ("last entrance", "peak") for as
 * long as any entrance has cost anything — the latter is the number held
 * against the headset's 11.1 ms budget at 90 Hz, read AFTER the entrance.
 */
function formatEntrance(entrance: EntranceStats | null): string {
  if (!entrance) return "";
  // Per frame while it runs, and the ACCUMULATED figures for as long as an
  // entrance has ever run: a single frame's draw sits under the browser
  // clock's 100 µs floor on a desktop, the entrance's total (~27 redraws)
  // and its peak frame do not (owner decision, 2026-09-06) — and the total
  // is the number the owner reads on the headset AFTER the entrance, so it
  // must not vanish the frame after settling (PR #423 review).
  const live =
    entrance.animating === 0 && entrance.redraws === 0
      ? ""
      : ` · entrance ${entrance.animating} animating · ` +
        `${entrance.redraws} redraws · ${entrance.drawMs.toFixed(2)} ms`;
  const accumulated =
    entrance.entranceMs === 0 && entrance.peakDrawMs === 0
      ? ""
      : ` · last entrance ${entrance.entranceMs.toFixed(2)} ms` +
        ` · peak ${entrance.peakDrawMs.toFixed(2)} ms`;
  return live + accumulated;
}

/** Format a summary as the status line, e.g.
 * `targets 4 · arrows 3 · rings 1 · hidden 0 · nearest 19.2 m ·
 * procedural indicators` (the style suffix drops out while unknown; the
 * entrance suffix — `· entrance 1 animating · 1 redraws · 0.04 ms` — only
 * while an entrance is running). */
export function formatHudStatus(summary: HudSceneSummary): string {
  const nearest =
    summary.nearest === null ? "–" : `${summary.nearest.toFixed(1)} m`;
  const style =
    summary.indicatorStyle === null
      ? ""
      : ` · ${summary.indicatorStyle} indicators`;
  return (
    `targets ${summary.targets} · arrows ${summary.arrows} · ` +
    `rings ${summary.rings} · hidden ${summary.hidden} · nearest ${nearest}` +
    style +
    formatEntrance(summary.entrance)
  );
}
