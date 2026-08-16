import { test, expect } from './e2e-test.js';
import { waitForTestHooksSubset } from './test-helpers.js';

/**
 * §3c — GPS accuracy ellipsoid bounding-box test (rec31 investigation).
 *
 * Why this test matters: the accuracy-aware raw-GPS marker introduced in §3
 * scales a unit sphere by `(latLongAccuracy, altitudeAccuracy, latLongAccuracy)`.
 * The visual diagnostic only works if the rendered ellipsoid is **noticeably
 * larger** for a low-accuracy event (large reported uncertainty in metres)
 * than for a high-accuracy one (small reported uncertainty). Unit tests
 * already cover `mesh.scale` directly; this Playwright spec
 * adds the end-to-end invariant: a real Three.js scene running in a real
 * browser reports the expected `THREE.Box3.setFromObject` ratio.
 *
 * We deliberately compare bounding boxes (not pixel diffs) because:
 *  - pixel diffs are brittle across renderers / CI agents
 *  - bounding-box math is the actual invariant the visualizer guarantees
 *
 * Cross-link: ../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-investigate-rec31-altitude-drop.md (§3c).
 */

async function waitForAccuracyHooks(page) {
  await waitForTestHooksSubset(
    page,
    () =>
      window.testHooks?.addGpsEventForTest &&
      window.testHooks?.getRawGpsMarkerWorldSizes &&
      window.testHooks?.setGpsEventVisualizerZeroRef &&
      window.testHooks?.clearGpsEventVisualizer
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  await waitForAccuracyHooks(page);
  await page.evaluate(() => {
    window.testHooks.clearGpsEventVisualizer();
    window.testHooks.setGpsEventVisualizerZeroRef(50.0, 8.0);
  });
});

test.describe('GPS accuracy ellipsoid (§3c)', () => {
  test('test hooks for accuracy ellipsoid are exposed', async ({ page }) => {
    const hooks = await page.evaluate(() => ({
      hasAdd: typeof window.testHooks.addGpsEventForTest === 'function',
      hasSizes:
        typeof window.testHooks.getRawGpsMarkerWorldSizes === 'function',
    }));
    expect(hooks.hasAdd).toBe(true);
    expect(hooks.hasSizes).toBe(true);
  });

  test('low-accuracy event (large latLongAccuracy in metres) produces markedly larger bbox than high-accuracy event', async ({
    page,
  }) => {
    // Add a tight high-accuracy (≈ 5 m) event followed by a sloppy
    // low-accuracy (≈ 40 m) event at the same world position so positions
    // do not bias the bbox — only the accuracy-driven scale does.
    await page.evaluate(() => {
      window.testHooks.addGpsEventForTest([0, 0, 0], [0, 0, 0], {
        horizontal: 5,
        vertical: 5,
      });
      window.testHooks.addGpsEventForTest([0, 0, 0], [0, 0, 0], {
        horizontal: 40,
        vertical: 40,
      });
    });

    const sizes = await page.evaluate(() =>
      window.testHooks.getRawGpsMarkerWorldSizes()
    );

    expect(sizes).toHaveLength(2);

    // First event (high accuracy, 5 m): diameter ≈ 2 × 5 = 10 m per axis.
    // Second event (low accuracy, 40 m): diameter ≈ 80 m per axis. Allow
    // tolerance for sphere tessellation.
    expect(sizes[0].x).toBeGreaterThan(8);
    expect(sizes[0].x).toBeLessThan(12);
    expect(sizes[1].x).toBeGreaterThan(70);
    expect(sizes[1].x).toBeLessThan(90);

    // The ratio is the actual user-visible invariant: a low-accuracy 40 m
    // event must dominate a high-accuracy 5 m event by ≈ 8× in every axis.
    const ratioX = sizes[1].x / sizes[0].x;
    const ratioY = sizes[1].y / sizes[0].y;
    const ratioZ = sizes[1].z / sizes[0].z;
    expect(ratioX).toBeGreaterThan(6);
    expect(ratioX).toBeLessThan(10);
    expect(ratioY).toBeGreaterThan(6);
    expect(ratioY).toBeLessThan(10);
    expect(ratioZ).toBeGreaterThan(6);
    expect(ratioZ).toBeLessThan(10);
  });

  test('missing accuracy falls back to legacy 4cm fixed sphere', async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.testHooks.addGpsEventForTest([0, 0, 0], [0, 0, 0]); // no accuracy
    });

    const sizes = await page.evaluate(() =>
      window.testHooks.getRawGpsMarkerWorldSizes()
    );

    expect(sizes).toHaveLength(1);
    // Radius halved 0.08 → 0.04 (D5), so 2 × 4 cm = 0.08 m. Tolerance for
    // sphere tessellation.
    expect(sizes[0].x).toBeGreaterThan(0.05);
    expect(sizes[0].x).toBeLessThan(0.1);
  });

  test('asymmetric accuracy produces tall narrow ellipsoid (or wide short)', async ({
    page,
  }) => {
    // The rec31 case: small horizontal but large vertical uncertainty would
    // appear as a tall narrow ellipsoid.
    await page.evaluate(() => {
      window.testHooks.addGpsEventForTest([0, 0, 0], [0, 0, 0], {
        horizontal: 3,
        vertical: 30,
      });
    });

    const sizes = await page.evaluate(() =>
      window.testHooks.getRawGpsMarkerWorldSizes()
    );

    expect(sizes).toHaveLength(1);
    // Vertical (y) ≈ 60 m, horizontal (x, z) ≈ 6 m → y/x ratio ≈ 10.
    expect(sizes[0].y / sizes[0].x).toBeGreaterThan(8);
    expect(sizes[0].y / sizes[0].x).toBeLessThan(12);
  });
});
