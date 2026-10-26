/**
 * The film's small curves. The three easings are the prototype's own (`sm`, `eo`,
 * `bk`), each an exact CSS cubic bezier: with the control x at 1/3 and 2/3
 * the bezier's x is its parameter, so its y is any cubic through (0, 0)
 * and (1, 1), and these three are such cubics. They are evaluated by the
 * framework's shared solver, not by private copies.
 *
 * @see film-math.ts.md
 */
import { cubicBezierEasing } from "gps-plus-slam-app-framework/utils/cubic-bezier-easing";

import { clamp01 } from "./clamp01.js";

/** Progress of `t` through `[a, b]`, clamped to [0, 1]. Requires a < b. */
export function seg(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

/** One hump: sin(pi x) inside (0, 1), 0 elsewhere (a button press). */
export function bump(x: number): number {
  return x > 0 && x < 1 ? Math.sin(Math.PI * x) : 0;
}

/** 3x^2 - 2x^3 (smoothstep on [0, 1]): cubic-bezier(1/3, 0, 2/3, 1). */
export const smoothEase = cubicBezierEasing(1 / 3, 0, 2 / 3, 1);

/** 1 - (1 - x)^3 (ease-out cubic): cubic-bezier(1/3, 1, 2/3, 1). */
export const easeOut = cubicBezierEasing(1 / 3, 1, 2 / 3, 1);

/**
 * the prototype's back-out, 1 + 2.7 (x - 1)^3 + 1.7 (x - 1)^2: its slope at 0 is
 * c + 3 = 4.7, so y1 = 4.7 / 3; flat at 1, so y2 = 1.
 */
export const backOut = cubicBezierEasing(1 / 3, 4.7 / 3, 2 / 3, 1);
