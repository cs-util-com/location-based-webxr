import { test, expect } from './e2e-test.js';
import { fakeWebXRSupport, waitForTestHooks } from './test-helpers.js';

/**
 * Phase Marker E2E Test
 *
 * Why this test matters: the "Mark phase" button is how a walker tells the
 * offline analysis where each test-protocol step starts. Unit tests pin the
 * handler and the slice; only a real page shows that the button is wired to
 * them, that a tap confirms itself on screen, that the count reaches the
 * summary, and that the new button does not shift or cover the recording
 * controls on a phone in either orientation.
 */

const PHONE_VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
];

/** Bounding boxes of the controls the phase button must leave alone. */
async function controlBoxes(page) {
  const ids = [
    'btn-stop',
    'recording-indicator',
    'btn-ref-point',
    'btn-new-ref-point',
    'btn-map',
    'btn-map-zoom-in',
    'btn-map-zoom-out',
    'status',
  ];
  const boxes = {};
  for (const id of ids) {
    boxes[id] = await page.locator(`#${id}`).boundingBox();
  }
  return boxes;
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

for (const viewport of PHONE_VIEWPORTS) {
  test(`${viewport.name}: a tap marks the next phase, the summary counts them, and the button covers and shifts nothing`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await fakeWebXRSupport(page);
    await page.goto('/');
    await waitForTestHooks(page);

    const phaseButton = page.locator('#btn-phase-mark');

    await test.step('hidden until a recording runs, then shown', async () => {
      await expect(phaseButton).toBeHidden();
      await page.evaluate(() => window.testHooks.startRecordingWithoutAr());
      await expect(phaseButton).toBeVisible();
      await expect(page.locator('#btn-stop')).toBeVisible();
    });

    await test.step('shifts and covers none of the recording controls', async () => {
      // Worst case for width: the secondary "add new ref point" button too.
      await page.evaluate(() =>
        document.getElementById('btn-new-ref-point')?.classList.remove('hidden')
      );
      const withButton = await controlBoxes(page);
      const phaseBox = await phaseButton.boundingBox();

      for (const [id, box] of Object.entries(withButton)) {
        expect(box, `#${id} is laid out`).not.toBeNull();
        expect(overlaps(phaseBox, box), `phase button covers #${id}`).toBe(
          false
        );
      }
      // Inside the viewport, and no horizontal page scroll.
      expect(phaseBox.x).toBeGreaterThanOrEqual(0);
      expect(phaseBox.y).toBeGreaterThanOrEqual(0);
      expect(phaseBox.x + phaseBox.width).toBeLessThanOrEqual(viewport.width);
      expect(phaseBox.y + phaseBox.height).toBeLessThanOrEqual(viewport.height);
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth
      );
      expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
      // A thumb-sized target.
      expect(phaseBox.height).toBeGreaterThanOrEqual(40);

      // Shifts nothing: every other control sits exactly where it sits with
      // the phase button's row taken out of the layout.
      await page.evaluate(() =>
        document.getElementById('phase-mark-row')?.classList.add('hidden')
      );
      const withoutButton = await controlBoxes(page);
      await page.evaluate(() =>
        document.getElementById('phase-mark-row')?.classList.remove('hidden')
      );
      expect(withButton).toEqual(withoutButton);
    });

    await test.step('each tap confirms its number', async () => {
      await phaseButton.click();
      await expect(page.locator('#toast-container')).toContainText(
        'Phase 1 marked'
      );
      await expect(phaseButton).toHaveText('🏁 Phase 1');
      await phaseButton.click();
      await expect(page.locator('#toast-container')).toContainText(
        'Phase 2 marked'
      );
      await expect(phaseButton).toHaveText('🏁 Phase 2');
    });

    await test.step('the summary counts the markers', async () => {
      await page.evaluate(() => window.testHooks.stopRecordingWithoutAr());
      await expect(page.locator('#session-summary-panel')).toBeVisible();
      await expect(page.locator('#summary-phase-markers')).toHaveText('2');
      await expect(phaseButton).toBeHidden();
    });
  });
}
