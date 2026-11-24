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

/**
 * The bottom-row recording controls and the HUD box: the phase button must
 * cover none of them, and taking its row out of the layout must move none of
 * them.
 */
const FIXED_CONTROLS = [
  '#btn-stop',
  '#recording-indicator',
  '#btn-ref-point',
  '#btn-new-ref-point',
  '#btn-map',
  '#btn-map-zoom-in',
  '#btn-map-zoom-out',
  '#status',
  '#hud > div',
];

/**
 * The ref-point hint stacks ABOVE the phase row by design (both sit in the
 * bottom-anchored controls overlay), so it moves up by the row's height when
 * the button is shown. It must still never be covered.
 */
const STACKED_ABOVE = ['#ref-point-hint'];

async function boxesOf(page, selectors) {
  const boxes = {};
  for (const selector of selectors) {
    boxes[selector] = await page.locator(selector).boundingBox();
  }
  return boxes;
}

/** Everything the HUD can show during a recording, at once: the worst case. */
async function showFullHud(page) {
  await page.evaluate(() => {
    for (const id of [
      'gps-info',
      'ar-info',
      'sync-info',
      'abs-compass-info',
      'qr-info',
      'frame-count-info',
      'tracking-quality',
    ]) {
      document.getElementById(id)?.classList.remove('hidden');
    }
    document.getElementById('tq-state').textContent = 'Converged';
    document.getElementById('tq-confidence').textContent = '(92%)';
    document.getElementById('qr-status').textContent = 'QR: none';
    const hint = document.getElementById('ref-point-hint');
    hint.textContent = 'Near reference point';
    hint.classList.remove('hidden');
    // Worst case for width: the secondary "add new ref point" button too.
    document.getElementById('btn-new-ref-point')?.classList.remove('hidden');
  });
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
  test(`${viewport.name}: a tap marks the next phase, the summary counts them, and the button covers no control and shifts no bottom-row control`, async ({
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

    await test.step('covers no control, with the full HUD showing', async () => {
      await showFullHud(page);
      const withButton = await boxesOf(page, FIXED_CONTROLS);
      const stacked = await boxesOf(page, STACKED_ABOVE);
      const phaseBox = await phaseButton.boundingBox();

      for (const [selector, box] of Object.entries({
        ...withButton,
        ...stacked,
      })) {
        expect(box, `${selector} is laid out`).not.toBeNull();
        expect(overlaps(phaseBox, box), `phase button covers ${selector}`).toBe(
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

      // Shifts no bottom-row control and not the HUD: each sits exactly where
      // it sits with the phase button's row taken out of the layout.
      await page.evaluate(() =>
        document.getElementById('phase-mark-row')?.classList.add('hidden')
      );
      const withoutButton = await boxesOf(page, FIXED_CONTROLS);
      await page.evaluate(() =>
        document.getElementById('phase-mark-row')?.classList.remove('hidden')
      );
      expect(withButton).toEqual(withoutButton);
    });

    await test.step('each tap confirms its number, a double tap is dropped', async () => {
      // The clock is pinned so the 500 ms double-tap guard is tested by
      // moving time, not by waiting for it.
      const t0 = new Date('2026-01-01T12:00:00Z').getTime();
      await page.clock.setFixedTime(t0);
      await phaseButton.click();
      await expect(page.locator('#toast-container')).toContainText(
        'Phase 1 marked'
      );
      await expect(phaseButton).toHaveText('🏁 Phase 1');
      await phaseButton.click();
      await expect(page.locator('#toast-container')).toContainText(
        'Phase 1 already marked'
      );
      await expect(phaseButton).toHaveText('🏁 Phase 1');
      await page.clock.setFixedTime(t0 + 1000);
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
