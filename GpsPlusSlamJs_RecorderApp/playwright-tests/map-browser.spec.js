import { test, expect } from './e2e-test.js';
import { waitForTestHooksSubset } from './test-helpers.js';

/**
 * Map-Centric Recording Browser E2E Tests (Step 4B)
 *
 * Why these tests matter:
 * The map browser is a Leaflet component, so its layout and interactions can't
 * be unit-tested (the repo covers Leaflet views with e2e). These tests assert
 * the D3a layout contract (full-bleed map + floating overlays — NOT a split or
 * a modal) and the core interactions: name search filters the tour list, a tile
 * selection narrows the list to that tile's tours, and picking a tour invokes
 * single-tour playback (D3). The pure tile/filter logic is unit-tested
 * separately in src/ui/map-browser-index.test.ts.
 *
 * The browser is mounted via the `mountMapBrowser` test hook with fixture tours
 * (GPS paths reduced to H3 coverage), so no real recordings folder is needed.
 */

// Two tours in the same area; one shares a point so they can co-occur on a tile.
const FIXTURE = [
  {
    filename: 'Paris-session-2026-03-01_09-00-00utc.zip',
    scenario: 'Paris',
    path: [
      { lat: 50.7495, lng: 6.4793 },
      { lat: 50.7475, lng: 6.4812 },
    ],
  },
  {
    filename: 'Tokyo-session-2026-03-02_09-00-00utc.zip',
    scenario: 'Tokyo',
    path: [
      { lat: 50.7475, lng: 6.4812 },
      { lat: 50.7451, lng: 6.4804 },
    ],
  },
];

test.describe('Map-Centric Recording Browser', () => {
  test('a full-bleed map under floating overlays: search, tile selection, playback and close @pr', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
    await waitForTestHooksSubset(page, () => window.testHooks?.mountMapBrowser);
    const ok = await page.evaluate(
      (fixture) => window.testHooks.mountMapBrowser(fixture),
      FIXTURE
    );
    expect(ok).toBe(true);
    await page
      .locator('[data-testid=map-browser]')
      .waitFor({ state: 'visible' });

    const tourItems = page.locator('[data-testid=map-browser-tour-item]');
    const listHeader = page.locator('[data-testid=map-browser-list-header]');

    await test.step('the map fills the viewport', async () => {
      // Why: D3a requires the map to fill the whole window with overlays on top,
      // like a maps app — never a side-by-side column or a centered card.
      const viewport = page.viewportSize();
      const mapBox = await page
        .locator('[data-testid=map-browser-map]')
        .boundingBox();
      expect(mapBox).not.toBeNull();
      expect(Math.abs(mapBox.width - viewport.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(mapBox.height - viewport.height)).toBeLessThanOrEqual(2);

      // Leaflet initialised the full-bleed map element (it adds `leaflet-container`
      // to the element it mounts into).
      await expect(
        page.locator('[data-testid=map-browser-map].leaflet-container')
      ).toBeVisible();
    });

    await test.step('search and tour list float on top', async () => {
      await expect(
        page.locator('[data-testid=map-browser-search]')
      ).toBeVisible();
      await expect(
        page.locator('[data-testid=map-browser-tour-list]')
      ).toBeVisible();
      // Default list shows all tours (no tile selected yet).
      await expect(tourItems).toHaveCount(2);
      await expect(listHeader).toContainText('All tours');
    });

    await test.step('the name search filters, case-insensitive', async () => {
      const search = page.locator('[data-testid=map-browser-search]');
      await search.fill('paris');
      await expect(tourItems).toHaveCount(1);
      await expect(tourItems).toContainText('Paris-session');

      await search.fill('');
      await expect(tourItems).toHaveCount(2);
    });

    await test.step('selecting a tile narrows the list', async () => {
      const tiles = await page.evaluate(() =>
        window.__mapBrowserInstance.getRenderedTiles()
      );
      expect(tiles.length).toBeGreaterThan(0);

      await page.evaluate(
        (tile) => window.__mapBrowserInstance.selectTile(tile),
        tiles[0]
      );

      await expect(listHeader).toContainText('Tile');
      await expect(
        page.locator('[data-testid=map-browser-clear-tile]')
      ).toBeVisible();
      // At least one tour crosses any rendered tile.
      expect(await tourItems.count()).toBeGreaterThanOrEqual(1);

      // "Show all" clears the tile selection.
      await page.locator('[data-testid=map-browser-clear-tile]').click();
      await expect(listHeader).toContainText('All tours');
    });

    await test.step('picking a tour triggers single-tour playback', async () => {
      await tourItems.first().click();
      const played = await page.evaluate(() => window.__mapBrowserPlayed);
      expect(played).toHaveLength(1);
      expect(played[0]).toContain('.zip');
    });

    await test.step('the close button tears it down', async () => {
      await page.locator('[data-testid=map-browser-close]').click();
      await expect(page.locator('[data-testid=map-browser]')).toHaveCount(0);
    });
  });
});

test.describe('Map-Centric Recording Browser — progressive streaming', () => {
  // Slice A: the map must mount immediately and stream tours onto it, with a
  // progress pill that counts up and then hides — instead of blocking on a
  // ~30s legacy backfill before anything is drawn.
  test('the map is there first, tours and tiles stream in, and the progress pill counts up and hides @pr', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
    await waitForTestHooksSubset(
      page,
      () =>
        window.testHooks?.mountMapBrowserEmpty &&
        window.testHooks?.streamMapBrowserRecording
    );
    const ok = await page.evaluate(
      (total) => window.testHooks.mountMapBrowserEmpty(total),
      FIXTURE.length
    );
    expect(ok).toBe(true);
    await page
      .locator('[data-testid=map-browser]')
      .waitFor({ state: 'visible' });

    const tourItems = page.locator('[data-testid=map-browser-tour-item]');
    const progress = page.locator('[data-testid=map-browser-progress]');
    const progressText = page.locator(
      '[data-testid=map-browser-progress-text]'
    );

    await test.step('progress before any recording streams in', async () => {
      // Why: the whole point of Slice A — the user sees (and can pan/zoom) the map
      // immediately, with a progress pill, rather than a 30s blank wait.
      const viewport = page.viewportSize();
      const mapBox = await page
        .locator('[data-testid=map-browser-map]')
        .boundingBox();
      expect(mapBox).not.toBeNull();
      expect(Math.abs(mapBox.width - viewport.width)).toBeLessThanOrEqual(2);

      // Progress pill is visible and reads "0 / total" before anything resolves.
      await expect(progress).toBeVisible();
      await expect(progressText).toContainText(`0 / ${FIXTURE.length}`);

      // No tours yet, no tiles yet.
      await expect(tourItems).toHaveCount(0);
    });

    await test.step('the first recording: one tour, tiles, progress 1 / total', async () => {
      await page.evaluate(
        ({ item, total }) =>
          window.testHooks.streamMapBrowserRecording(item, 1, total),
        { item: FIXTURE[0], total: FIXTURE.length }
      );
      await expect(tourItems).toHaveCount(1);
      await expect(progressText).toContainText(`1 / ${FIXTURE.length}`);
      const tilesAfterFirst = await page.evaluate(() =>
        window.__mapBrowserInstance.getRenderedTiles()
      );
      expect(tilesAfterFirst.length).toBeGreaterThan(0);
    });

    await test.step('the last recording: two tours, then the pill hides', async () => {
      await page.evaluate(
        ({ item, total }) =>
          window.testHooks.streamMapBrowserRecording(item, total, total),
        { item: FIXTURE[1], total: FIXTURE.length }
      );
      await expect(tourItems).toHaveCount(2);

      // Why: the durable-end-state rule — once done === total the pill shows a
      // brief confirmation and then disappears, leaving the map unobstructed.
      // Brief confirmation names the durable result…
      await expect(progressText).toContainText('recordings');
      // …then the pill auto-hides.
      await expect(progress).toBeHidden();
    });
  });
});

test.describe('Map-Centric Recording Browser — coverage backfill CTA (B1)', () => {
  // Slice B: once indexing finishes and there are legacy recordings carrying
  // coverage, an opt-in "Speed up future loads" button offers the one-time
  // in-zip embed. The click is the user gesture for the permission upgrade.
  const successOutcome = {
    embedded: FIXTURE.length,
    skipped: 0,
    failed: 0,
    permissionDenied: false,
  };
  const deniedOutcome = {
    embedded: 0,
    skipped: 0,
    failed: 0,
    permissionDenied: true,
  };

  async function mount(page, outcome) {
    const ok = await page.evaluate(
      ({ fixture, out }) =>
        window.testHooks.mountMapBrowserBackfill(fixture, out),
      { fixture: FIXTURE, out: outcome }
    );
    expect(ok).toBe(true);
    await page
      .locator('[data-testid=map-browser]')
      .waitFor({ state: 'visible' });
  }

  test('the CTA embeds on click, confirms and hides; a denied write leaves a retry label @pr', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#setup-modal').waitFor({ state: 'visible' });
    await waitForTestHooksSubset(
      page,
      () => window.testHooks?.mountMapBrowserBackfill
    );
    const cta = page.locator('[data-testid=map-browser-backfill]');

    await test.step('success', async () => {
      await mount(page, successOutcome);
      await expect(cta).toBeVisible();
      await expect(cta).toContainText('Speed up future loads');
      await expect(cta).toContainText(`${FIXTURE.length} recordings`);

      await cta.click();
      // Transitional in-progress state (async-UX rule).
      await expect(cta).toContainText('Embedding…');

      // Release the deferred backfill → final confirmation, then auto-hide.
      await page.evaluate(() => window.__releaseBackfill());
      await expect(cta).toContainText(`Embedded ${FIXTURE.length}`);
      await expect(cta).toBeHidden();

      const calls = await page.evaluate(() => window.__mapBrowserBackfillCalls);
      expect(calls).toBe(1);
    });

    await test.step('write access denied', async () => {
      await page.locator('[data-testid=map-browser-close]').click();
      await expect(page.locator('[data-testid=map-browser]')).toHaveCount(0);

      await mount(page, deniedOutcome);
      await expect(cta).toBeVisible();

      await cta.click();
      await expect(cta).toContainText('Embedding…');

      await page.evaluate(() => window.__releaseBackfill());
      // Failure path: the button stays visible with an actionable retry label.
      await expect(cta).toContainText('Write access denied');
      await expect(cta).toBeVisible();
      await expect(cta).toBeEnabled();
    });
  });
});
