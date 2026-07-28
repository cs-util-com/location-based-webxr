/**
 * Property-based tests for slider-scroll-guard.ts
 *
 * Why this test file matters:
 * The example tests pin a handful of hand-picked gestures; real fingers produce
 * arbitrary paths. These properties state the guard's contract over randomly
 * generated gestures without re-implementing its decision rule:
 * - A vertical-dominant swipe NEVER edits the value.
 * - A clearly horizontal drag ALWAYS ends with the browser's value (the guard
 *   must not break the control it protects).
 * - A gesture slower than the tap window only edits when it was horizontal.
 * - The guard always releases its state — after any gesture, ordinary
 *   (non-gesture) input events flow again.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { guardSliderAgainstScroll } from './slider-scroll-guard.js';
import {
  simulateNativeSliderGesture,
  type GesturePoint,
} from '../test-utils/pointer-gestures.js';

const START_VALUE = '50';

function makeGuardedSlider(): {
  slider: HTMLInputElement;
  inputEvents: number[];
} {
  document.body.innerHTML = '';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  // Wide enough that no generated path is clipped by the slider's own range —
  // clamping would confuse "the guard suppressed it" with "the value saturated".
  slider.max = '1200';
  slider.step = '1';
  slider.value = START_VALUE;
  document.body.appendChild(slider);
  guardSliderAgainstScroll(slider);
  const inputEvents: number[] = [];
  slider.addEventListener('input', () =>
    inputEvents.push(Number(slider.value))
  );
  return { slider, inputEvents };
}

/** Gesture start point, kept well inside the slider's value range. */
const arbStart = fc.record({
  x: fc.integer({ min: 0, max: 400 }),
  y: fc.integer({ min: 0, max: 800 }),
});

/**
 * A vertical-dominant swipe: every sample stays closer to the start in x than
 * in y, and the first step alone clears the intent threshold. Sideways jitter
 * is bounded by the accumulated vertical travel, which is how a real scroll
 * looks.
 */
const arbScrollPath = fc
  .tuple(
    arbStart,
    fc.array(
      fc.record({
        dy: fc.integer({ min: 12, max: 60 }),
        jitter: fc.integer({ min: -3, max: 3 }),
      }),
      { minLength: 1, maxLength: 12 }
    ),
    fc.boolean()
  )
  .map(([start, steps, downwards]) => {
    const path: GesturePoint[] = [start];
    let y = start.y;
    let travelled = 0;
    for (const step of steps) {
      travelled += step.dy;
      y += downwards ? step.dy : -step.dy;
      // Keep |dx| <= |dy| relative to the start so the path is a scroll by
      // construction, independent of the guard's exact thresholds.
      const dx = Math.max(-travelled, Math.min(travelled, step.jitter));
      path.push({ x: start.x + dx, y });
    }
    return path;
  });

/** An unambiguous sideways drag: large horizontal travel, no vertical. */
const arbHorizontalPath = fc
  .tuple(
    arbStart,
    fc.array(fc.integer({ min: 12, max: 80 }), { minLength: 1, maxLength: 8 })
  )
  .map(([start, steps]) => {
    const path: GesturePoint[] = [start];
    let x = start.x;
    for (const step of steps) {
      x += step; // rightwards only: keeps every x inside the slider's range
      path.push({ x, y: start.y });
    }
    return path;
  });

/**
 * A path that never travels far enough sideways to earn horizontal intent —
 * the finger may wander vertically or stand still, but stays within the intent
 * threshold in x.
 */
const arbNoSidewaysPath = fc
  .tuple(
    arbStart,
    fc.array(
      fc.record({
        dx: fc.integer({ min: -9, max: 9 }),
        y: fc.integer({ min: 0, max: 800 }),
      }),
      { minLength: 1, maxLength: 15 }
    )
  )
  .map(([start, steps]) => [
    start,
    ...steps.map((step) => ({ x: start.x + step.dx, y: step.y })),
  ]);

/** Any path at all — used for the "never gets stuck" property. */
const arbAnyPath = fc.array(
  fc.record({
    x: fc.integer({ min: 0, max: 400 }),
    y: fc.integer({ min: 0, max: 800 }),
  }),
  { minLength: 1, maxLength: 15 }
);

describe('slider-scroll-guard — property-based tests', () => {
  it('never changes the value for a vertical-dominant swipe', () => {
    fc.assert(
      fc.property(
        arbScrollPath,
        fc.constantFrom<'up' | 'cancel'>('up', 'cancel'),
        fc.integer({ min: 30, max: 3000 }),
        (path, end, durationMs) => {
          const { slider, inputEvents } = makeGuardedSlider();
          simulateNativeSliderGesture(slider, path, { end, durationMs });
          expect(slider.value).toBe(START_VALUE);
          expect(inputEvents).toEqual([]);
        }
      )
    );
  });

  it('always applies a clearly horizontal drag', () => {
    fc.assert(
      fc.property(arbHorizontalPath, (path) => {
        const { slider } = makeGuardedSlider();
        simulateNativeSliderGesture(slider, path);
        // The last sample crossed the intent threshold long before the end, so
        // the browser's final value must survive the guard.
        expect(slider.value).toBe(String(path[path.length - 1].x));
      })
    );
  });

  it('never edits on a gesture slower than the tap window without sideways travel', () => {
    // Why this property matters: the tap commit is deliberately time-bounded —
    // anything that lingers could be the dwell at the start of a scroll. With
    // no horizontal intent to fall back on, such a gesture must never edit,
    // whatever shape its path has (vertical, wandering, or standing still).
    fc.assert(
      fc.property(
        arbNoSidewaysPath,
        fc.integer({ min: 400, max: 5000 }),
        (path, durationMs) => {
          const { slider, inputEvents } = makeGuardedSlider();
          simulateNativeSliderGesture(slider, path, { durationMs });
          expect(slider.value).toBe(START_VALUE);
          expect(inputEvents).toEqual([]);
        }
      )
    );
  });

  it('always releases its state after a gesture ends', () => {
    // Why this property matters: a guard that forgets to clear its gesture
    // would silently freeze the slider for the rest of the session.
    fc.assert(
      fc.property(
        arbAnyPath,
        fc.constantFrom<'up' | 'cancel'>('up', 'cancel'),
        fc.constantFrom('touch', 'pen', 'mouse'),
        (path, end, pointerType) => {
          const { slider, inputEvents } = makeGuardedSlider();
          simulateNativeSliderGesture(slider, path, { end, pointerType });
          inputEvents.length = 0;

          slider.value = '123';
          slider.dispatchEvent(new Event('input'));

          expect(slider.value).toBe('123');
          expect(inputEvents).toEqual([123]);
        }
      )
    );
  });
});
