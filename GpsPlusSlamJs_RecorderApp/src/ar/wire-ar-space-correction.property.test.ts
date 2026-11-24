/**
 * Property: whatever the order of jumps, tile adds and QR rewrites, every
 * tile and QR object ends on the product of exactly the jumps observed
 * after its capture time, applied to its raw pose. The oracle composes the
 * raw frame switches itself; it never reads the module's corrections.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as THREE from 'three';
import { setZeroPos } from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { relocalizationObserved } from 'gps-plus-slam-app-framework/state/ar-space-correction-slice';
import { createQrDebugView } from 'gps-plus-slam-app-framework/ar/qr/qr-debug-view';
import { createRecorderStore } from '../state/recorder-store';
import { createStoreRef } from '../state/store-ref';
import { FrameTileVisualizer } from '../visualization/frame-tile-visualizer';
import { wireArSpaceCorrection } from './wire-ar-space-correction';

const T0 = 1_700_000_000_000;
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

const rawRigid = (yaw: number, x: number, z: number) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    ONE
  );

function poseOf(m: THREE.Matrix4) {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  return {
    position: [p.x, p.y, p.z] as [number, number, number],
    rotation: [q.x, q.y, q.z, q.w] as [number, number, number, number],
  };
}

const localOf = (o: THREE.Object3D) =>
  new THREE.Matrix4().compose(o.position, o.quaternion, o.scale);

const maxDiff = (a: THREE.Matrix4, b: THREE.Matrix4) =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i]!)));

type Step =
  | {
      kind: 'jump';
      gapMs: number;
      yaw: number;
      x: number;
      xSign: number;
      z: number;
    }
  | { kind: 'tile'; capturedOffsetMs: number }
  | { kind: 'qr'; capturedOffsetMs: number };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('jump' as const),
    gapMs: fc.integer({ min: 200, max: 1500 }),
    yaw: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    // The feed only dispatches a step over 1 m, so a jump is at least that.
    x: fc.double({ min: 1.01, max: 20, noNaN: true }),
    xSign: fc.constantFrom(-1, 1),
    z: fc.double({ min: -20, max: 20, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant('tile' as const),
    capturedOffsetMs: fc.integer({ min: 0, max: 8000 }),
  }),
  fc.record({
    kind: fc.constant('qr' as const),
    capturedOffsetMs: fc.integer({ min: 0, max: 8000 }),
  })
);

describe('wireArSpaceCorrection (property)', () => {
  it('each tile and QR object carries exactly the jumps after its capture time', () => {
    // Why this test matters: tiles arrive late and the QR cube is rewritten
    // from older observations every frame, in any order relative to the
    // jumps; a jump applied twice, or one missed, leaves content off its
    // physical place, and only a random interleaving finds such orders.
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 10 }),
        (steps) => {
          const store = createRecorderStore({
            storageBackend: new NullStorageBackend(),
          });
          store.dispatch(setZeroPos({ lat: 50, lon: 8 }));
          const arWorldGroup = new THREE.Group();
          const correction = wireArSpaceCorrection({
            arWorldGroup,
            storeRef: createStoreRef(store),
            enabled: true,
          });
          const tiles = new FrameTileVisualizer(arWorldGroup, {
            onPlaced: correction.onPlaced!,
          });
          const qr = createQrDebugView(arWorldGroup, {
            onPlaced: correction.onPlaced!,
          });
          const camera = new THREE.Matrix4().makeTranslation(0, 1.5, 0);
          const jumps: Array<{ t: number; J: THREE.Matrix4 }> = [];
          const expected: Array<{
            object: () => THREE.Object3D;
            t: number;
            raw: THREE.Matrix4;
          }> = [];
          let lastT = T0;
          let qrEntry: { t: number; raw: THREE.Matrix4 } | null = null;
          const rawPose = new THREE.Matrix4().compose(
            new THREE.Vector3(0.5, 1, -2),
            new THREE.Quaternion().setFromAxisAngle(UP, 0.3),
            ONE
          );

          // Time runs forward: content is placed before the next jump is
          // observed, so its capture time is before that jump (the feed
          // dispatches in the jump frame before the frame's captures run).
          // Jumps are at least 200 ms apart, so up to lastT + 199 is allowed.
          const capturedAt = (offsetMs: number) =>
            Math.min(T0 + offsetMs, lastT + 199);
          steps.forEach((step, i) => {
            if (step.kind === 'jump') {
              const t = lastT + step.gapMs;
              lastT = t;
              const J = rawRigid(step.yaw, step.xSign * step.x, step.z);
              jumps.push({ t, J });
              store.dispatch(
                relocalizationObserved({
                  t,
                  tLast: t - 33,
                  lastPose: poseOf(camera),
                  tPrev: null,
                  prevPose: null,
                  newPose: poseOf(J.clone().multiply(camera)),
                })
              );
            } else if (step.kind === 'tile') {
              const t = capturedAt(step.capturedOffsetMs);
              const file = `f/${i}.jpg`;
              const p = poseOf(rawPose);
              tiles.addTile(
                { imageFile: file, ...p, screenRotation: 0, capturedAt: t },
                new THREE.Texture()
              );
              const tile = arWorldGroup.getObjectByName(`frame-tile-${file}`)!;
              // The raw capture pose with the tile's own aspect scale; never
              // read back after the add, which may already be corrected.
              const raw = new THREE.Matrix4().compose(
                new THREE.Vector3().setFromMatrixPosition(rawPose),
                new THREE.Quaternion().setFromRotationMatrix(rawPose),
                tile.scale
              );
              expected.push({ object: () => tile, t, raw });
            } else {
              const t = capturedAt(step.capturedOffsetMs);
              qr.update(poseOf(rawPose), null, t);
              qrEntry = { t, raw: rawPose.clone() };
            }
          });
          if (qrEntry !== null) {
            const entry: { t: number; raw: THREE.Matrix4 } = qrEntry;
            const axis =
              arWorldGroup.getObjectByName('qr-debug-basis')!.children[0]!;
            expected.push({ object: () => axis, t: entry.t, raw: entry.raw });
          }

          for (const { object, t, raw } of expected) {
            const want = raw.clone();
            for (const jump of jumps) {
              if (jump.t > t) want.premultiply(jump.J);
            }
            expect(maxDiff(localOf(object()), want)).toBeLessThan(1e-7);
          }
          qr.dispose();
          tiles.dispose();
          correction.dispose();
        }
      ),
      { numRuns: 60 }
    );
  });
});
