/**
 * AR-space correction: the cost of one bake (every tracked object moved
 * once for one relocalization jump) at 100, 1,000 and 10,000 objects.
 *
 * Why this test matters: the bake runs inside the store notification that
 * records the jump, so it lands in one XR frame. The budget is 2 ms for
 * 1,000 objects on a development machine; a regression that rebuilt the
 * correction per object (instead of once per parent and epoch) or walked
 * the scene per object would show up here and nowhere else.
 *
 * Parameters: object count (100 / 1,000 / 10,000) and layout (all direct
 * children of `arContent`, or spread over 10 containers with their own
 * transforms, which needs one prepared correction per container). Timing
 * is best-of-N jumps (min damps scheduler noise). Nothing here asserts a
 * duration (machine speed must not decide a gate): the measured table is
 * printed and appended to AR_SPACE_SWEEP_OUT when that is set, and the 2 ms
 * budget is judged from a local run, never tuned to pass.
 *
 * Local runs (Windows, node 24, three runs, best of 9 each, P read fresh
 * once per parent at every jump): direct children 0.75-0.87 ms at 100,
 * 1.06-1.70 ms at 1,000, 6.7-7.5 ms at 10,000; in 10 containers
 * 0.55-0.66, 0.71-0.96 and 4.3-7.0 ms. About 0.5 ms of each is
 * the store dispatch itself (development-mode checks included). Before the
 * correction was shared per parent, 1,000 direct children took 15-24 ms;
 * the sibling test in ar-content-watcher.test.ts pins that sharing exactly,
 * without a clock.
 */
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureStore } from '@reduxjs/toolkit';
import {
  arSpaceCorrectionReducer,
  relocalizationObserved,
} from '../state/ar-space-correction-slice';
import { enableArSpaceCorrection } from './ar-content-watcher';

const COUNTS = [100, 1_000, 10_000] as const;
const LAYOUTS = ['direct', '10 containers'] as const;
const TIMING_RUNS = 9;

function report(table: string): void {
  console.info(table);
  const out = process.env.AR_SPACE_SWEEP_OUT;
  if (out) appendFileSync(out, `${table}\n`);
}

/** Best-of-N wall time of one bake of `count` objects, ms. */
function bakeMs(count: number, layout: (typeof LAYOUTS)[number]): number {
  const store = configureStore({
    reducer: { arSpaceCorrection: arSpaceCorrectionReducer },
  });
  const arWorldGroup = new THREE.Group();
  const { arContent, arCorrection } = enableArSpaceCorrection({
    store,
    arWorldGroup,
  });
  const parents: THREE.Object3D[] = [arContent];
  if (layout === '10 containers') {
    parents.length = 0;
    for (let i = 0; i < 10; i++) {
      const box = arCorrection.container(new THREE.Group());
      box.position.set(i, 0, -i);
      box.rotation.y = i * 0.3;
      arContent.add(box);
      parents.push(box);
    }
  }
  for (let i = 0; i < count; i++) {
    const coin = new THREE.Mesh();
    coin.position.set(i % 37, (i % 5) * 0.2, -(i % 23));
    coin.rotation.y = i * 0.01;
    parents[i % parents.length]!.add(coin);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < TIMING_RUNS; run++) {
    const t = 1000 + run * 100;
    const yaw = 0.01 * (run + 1);
    const start = performance.now();
    store.dispatch(
      relocalizationObserved({
        t,
        tLast: t - 33,
        lastPose: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
        tPrev: null,
        prevPose: null,
        newPose: {
          position: [0.5, 1.5, -0.2],
          rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
        },
      })
    );
    best = Math.min(best, performance.now() - start);
  }
  arCorrection.dispose();
  return best;
}

describe('ar-content-watcher perf', () => {
  it(
    'reports one bake at 100, 1,000 and 10,000 objects',
    { timeout: 120_000 },
    () => {
      const rows: string[] = [];
      for (const layout of LAYOUTS) {
        for (const count of COUNTS) {
          const ms = bakeMs(count, layout);
          rows.push(
            `bake ${layout} n=${count}: best of ${TIMING_RUNS} ${ms.toFixed(3)} ms`
          );
        }
      }
      report(rows.join('\n'));
      expect(rows).toHaveLength(COUNTS.length * LAYOUTS.length);
    }
  );
});
