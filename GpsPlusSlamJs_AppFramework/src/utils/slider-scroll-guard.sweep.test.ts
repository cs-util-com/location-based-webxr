/**
 * Threshold sweep for slider-scroll-guard.ts (owner rule 2026-09-13: a
 * verdict from one parameter value is provisional).
 *
 * Why this test matters: the guard's rule has two numbers, the travel before
 * a gesture's direction is trusted (`intentPx`, shipped 12 since 2026-09-30, 10 before) and the steepest
 * angle that still counts as a horizontal drag (`horizontalMaxDeg`, shipped
 * 45). This file runs the REAL guard over three families of gestures for
 * every pair in 4-16 px x 30-60 degrees and prints where each family breaks,
 * so a later change of either number is taken with the whole range in view.
 * It asserts only the shipped pair; the table is the measurement. The
 * second sweep, of the tap window, is described at its own block below.
 *
 * The families, in CSS px (a phone's dp is about one CSS px):
 * - scroll swipes leaning 0-40 degrees off vertical, with and without a
 *   3 px sideways twitch first (the Chromium direction-lock case): must never
 *   edit;
 * - horizontal drags leaning 0-35 degrees off horizontal: must always edit;
 * - taps whose finger wanders 0-8 px (below Chromium's own tap slop), in
 *   90 ms: must commit.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  guardSlidersIn,
  SLIDER_GUARD_TUNING,
  type SliderGuardTuning,
} from './slider-scroll-guard.js';
import {
  simulateNativeSliderGesture,
  type GesturePoint,
} from '../test-utils/pointer-gestures.js';

const START = 500;
const STEP_PX = 6;
const STEPS = 20;

function slider(): HTMLInputElement {
  document.body.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '2000';
  input.step = '1';
  input.value = String(START);
  document.body.appendChild(input);
  return input;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** A path from (START, 400) in STEPS steps along `deg` above the horizontal. */
function line(deg: number, twitch: boolean): GesturePoint[] {
  const points: GesturePoint[] = [{ x: START, y: 400 }];
  let { x, y } = points[0] as GesturePoint;
  if (twitch) {
    x += 3;
    y -= 1;
    points.push({ x, y });
  }
  for (let i = 0; i < STEPS; i++) {
    x += STEP_PX * Math.cos(rad(deg));
    y -= STEP_PX * Math.sin(rad(deg));
    points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return points;
}

interface Outcome {
  readonly scrollEdits: string[];
  readonly dragsLost: string[];
  readonly tapsLost: string[];
}

/** Scroll swipes the browser takes over; each that edited, by lean. */
function scrollEdits(): string[] {
  const out: string[] = [];
  for (const lean of [0, 10, 20, 25, 30, 35, 40]) {
    for (const twitch of [false, true]) {
      const input = slider();
      simulateNativeSliderGesture(input, line(90 - lean, twitch), {
        end: 'cancel',
        touchEvents: true,
        afterCancel: [{ x: START + 40, y: 200 }],
      });
      if (input.value !== String(START)) {
        out.push(`${lean}°${twitch ? '+twitch' : ''}`);
      }
    }
  }
  return out;
}

/** Horizontal drags; each that did not end at the finger, by lean. */
function dragsLost(): string[] {
  const out: string[] = [];
  for (const lean of [0, 10, 20, 25, 30, 35]) {
    const input = slider();
    const path = line(lean, false);
    simulateNativeSliderGesture(input, path, { touchEvents: true });
    const last = path[path.length - 1] as GesturePoint;
    if (input.value !== String(last.x)) out.push(`${lean}°`);
  }
  return out;
}

const WANDER_DIRECTIONS = [
  ['x', 1, 0],
  ['y', 0, 1],
  ['diag', 0.7, 0.7],
] as const;

/** 90 ms taps whose finger wanders; each that was not committed. */
function tapsLost(): string[] {
  const out: string[] = [];
  for (const wander of [0, 2, 4, 6, 8]) {
    for (const [name, ux, uy] of WANDER_DIRECTIONS) {
      const input = slider();
      const end = {
        x: START + 100 + Math.round(wander * ux),
        y: 400 + Math.round(wander * uy),
      };
      simulateNativeSliderGesture(input, [{ x: START + 100, y: 400 }, end], {
        durationMs: 90,
        touchEvents: true,
      });
      if (input.value === String(START)) out.push(`${wander}px ${name}`);
    }
  }
  return out;
}

function run(tuning: SliderGuardTuning): Outcome {
  const dispose = guardSlidersIn(document, tuning);
  try {
    return {
      scrollEdits: scrollEdits(),
      dragsLost: dragsLost(),
      tapsLost: tapsLost(),
    };
  } finally {
    dispose();
  }
}

describe('slider-scroll-guard threshold sweep', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('holds every family at the shipped rule, and prints where each pair breaks', () => {
    const rows: string[] = [];
    for (const intentPx of [4, 6, 8, 10, 12, 14, 16]) {
      for (const horizontalMaxDeg of [30, 37.5, 45, 52.5, 60]) {
        const o = run({ ...SLIDER_GUARD_TUNING, intentPx, horizontalMaxDeg });
        const cell = (list: string[]): string =>
          list.length === 0 ? 'ok' : list.join(' ');
        rows.push(
          `${intentPx}px ${horizontalMaxDeg}°: scroll-edits=${cell(o.scrollEdits)} | drags-lost=${cell(o.dragsLost)} | taps-lost=${cell(o.tapsLost)}`
        );
      }
    }
    // The measurement, for the record (read in the test output).
    console.log(`slider guard sweep\n${rows.join('\n')}`);

    const shipped = run(SLIDER_GUARD_TUNING);
    // Measured 2026-09-30: at the former 10 px, a swipe leaning 40 degrees
    // off vertical that STARTS with a sideways twitch edited the value (the
    // twitch tipped the first 10 px past the diagonal). The owner chose 12 px
    // (2026-09-30), which holds it; this pins that.
    expect(shipped.scrollEdits).toEqual([]);
    expect(shipped.dragsLost).toEqual([]);
    expect(shipped.tapsLost).toEqual([]);
  });
});

/*
 * The tap window (`tapMaxMs`, shipped 300) swept over 150-800 ms and with no
 * window at all (review 2026-09-30, A2). The window exists because "a hold
 * is how a scroll begins" (owner decision 2026-07-28); this measures whether
 * it is what stops any scroll from editing, or whether the direction rule
 * and the browser's pointercancel already do. Families, all with Chromium's
 * touch events:
 * - scrolls that start with a still dwell of 0-800 ms, leaning 0-40 degrees,
 *   ended by the browser (pointercancel) or by a lift: must never edit;
 * - still presses the browser cancelled, 60-1000 ms: must never edit;
 * - presses the browser never cancelled, 60-1000 ms, standing still or
 *   wandering 6 px diagonally (inside Chromium's tap slop): what the window
 *   acts on;
 * - a 10 px vertical creep the browser never cancelled (below the 12 px
 *   intent threshold, so the direction rule cannot see it): the one shape
 *   where the window could tell a scroll's start from a tap.
 */
const STEP_MS = 20;
const PRESS_MS = [60, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000];
const TAP_WINDOWS_MS = [150, 200, 250, 300, 400, 500, 600, 800, Infinity];

/** A still dwell of `dwellMs`, then a swipe `lean` degrees off vertical. */
function dwellThenSwipe(dwellMs: number, lean: number): GesturePoint[] {
  const dwell: GesturePoint[] = Array.from(
    { length: dwellMs / STEP_MS },
    () => ({ x: START, y: 400 })
  );
  return [...dwell, ...line(90 - lean, false)];
}

interface WindowOutcome {
  readonly scrollEdits: string[];
  readonly cancelledPressEdits: number[];
  readonly stillPressesLost: number[];
  readonly wanderingPressesLost: number[];
  readonly creepsCommitted: number[];
}

/** Run `path` as one touch gesture on a fresh slider; true when it edited. */
function edits(
  path: GesturePoint[],
  end: 'up' | 'cancel',
  durationMs: number
): boolean {
  const input = slider();
  simulateNativeSliderGesture(input, path, {
    end,
    durationMs,
    touchEvents: true,
  });
  return input.value !== String(START);
}

function scrollEditsWithDwell(): string[] {
  const out: string[] = [];
  for (const dwellMs of [0, 200, 400, 800]) {
    for (const lean of [0, 20, 40]) {
      for (const end of ['cancel', 'up'] as const) {
        const path = dwellThenSwipe(dwellMs, lean);
        if (edits(path, end, STEP_MS * (path.length - 1))) {
          out.push(`${dwellMs}ms/${lean}°/${end}`);
        }
      }
    }
  }
  return out;
}

function windowRun(tapMaxMs: number): WindowOutcome {
  const dispose = guardSlidersIn(document, {
    ...SLIDER_GUARD_TUNING,
    tapMaxMs,
  });
  const at: GesturePoint = { x: START + 100, y: 400 };
  const wander: GesturePoint[] = [at, { x: at.x + 6, y: at.y + 6 }];
  const creep: GesturePoint[] = [
    at,
    { x: at.x, y: at.y - 5 },
    { x: at.x, y: at.y - 10 },
  ];
  try {
    return {
      scrollEdits: scrollEditsWithDwell(),
      cancelledPressEdits: PRESS_MS.filter((ms) => edits([at], 'cancel', ms)),
      stillPressesLost: PRESS_MS.filter((ms) => !edits([at], 'up', ms)),
      wanderingPressesLost: PRESS_MS.filter((ms) => !edits(wander, 'up', ms)),
      creepsCommitted: PRESS_MS.filter((ms) => edits(creep, 'up', ms)),
    };
  } finally {
    dispose();
  }
}

describe('slider-scroll-guard tap-window sweep', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stops no scroll at any window: its only effect is to discard uncancelled presses that outlast it', () => {
    // Why this test matters: it is the evidence for keeping or dropping the
    // window. Measured 2026-09-30 across 150-800 ms and with no window: every
    // scroll and every cancelled press stays unedited at every value, so the
    // window is not what keeps the reported bug fixed; what it does decide
    // is whether a press the browser never took over sets the value.
    const rows: string[] = [];
    const list = (xs: readonly (string | number)[]): string =>
      xs.length === 0 ? 'none' : xs.join(' ');
    for (const tapMaxMs of TAP_WINDOWS_MS) {
      const o = windowRun(tapMaxMs);
      const label = tapMaxMs === Infinity ? 'no window' : `${tapMaxMs}ms`;
      rows.push(
        `${label}: scroll-edits=${list(o.scrollEdits)} | cancelled-press-edits=${list(o.cancelledPressEdits)} | still-presses-lost=${list(o.stillPressesLost)} | wandering-presses-lost=${list(o.wanderingPressesLost)} | 10px-creeps-committed=${list(o.creepsCommitted)}`
      );
      expect(o.scrollEdits).toEqual([]);
      expect(o.cancelledPressEdits).toEqual([]);
      const longer = PRESS_MS.filter((ms) => ms > tapMaxMs);
      const within = PRESS_MS.filter((ms) => ms <= tapMaxMs);
      expect(o.stillPressesLost).toEqual(longer);
      expect(o.wanderingPressesLost).toEqual(longer);
      expect(o.creepsCommitted).toEqual(within);
    }
    // The measurement, for the record (read in the test output).
    console.log(`slider guard tap-window sweep\n${rows.join('\n')}`);
  });
});
