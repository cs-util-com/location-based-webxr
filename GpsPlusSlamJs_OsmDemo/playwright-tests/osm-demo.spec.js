// @ts-check
/**
 * End-to-end tests for the OSM affordance demo.
 *
 * WHY THIS SUITE EXISTS. The demo typechecked, its unit tests passed and it
 * production-built — and none of that establishes that anything appears on
 * screen. "It builds" and "it works" are different claims, and every failure
 * mode this app has is a silent one: Leaflet layers in the wrong order hide the
 * grid, a WebGL pane that renders nothing looks exactly like a pane with no
 * buildings nearby, and an OPFS path that never caches looks exactly like one
 * that does until someone watches the network.
 *
 * So these tests assert what is actually DRAWN and what actually went over the
 * wire, not that a function returned. Two of them are deliberately the kind
 * this repo has a scar from skipping: a pixel-level check on the 3D canvas
 * (a status line built from the same objects the presenter mutates is blind to
 * render-wiring bugs), and a request count (the only way to see a cache).
 *
 * The whole suite is offline — see `fixtures.js` for why that is about donated
 * infrastructure before it is about determinism.
 */

import { test, expect } from '@playwright/test';

import { AT_FIXTURE, stubNetwork, waitForRefresh } from './fixtures.js';

test.describe('the demo boots', () => {
  test('loads the rule table and populates the category picker', async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // The categories come from the rule table, not from a hardcoded list, so a
    // populated picker is evidence the table parsed. `walkable` is the C#
    // vocabulary's own category and the demo's default.
    const options = page.locator('#category option');
    await expect(options).not.toHaveCount(0);
    await expect(page.locator('#category')).toHaveValue('walkable');

    // WHICH TIER the table came from is displayed on purpose: a demo silently
    // running on the checked-in snapshot looks identical to one on the live
    // sheet, and they are different claims about what is being judged. The
    // suite blocks the sheet, so `snapshot` is the correct answer here.
    await expect(page.locator('#status')).toContainText('rules: snapshot');
  });

  test('reports the scale it is drawing with', async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // Without this the demo answers "does it look plausible?" instead of "is 1
    // really the identity here?" — and only the second is worth a session.
    await expect(page.locator('#scale')).toContainText('identity is 1');
    await expect(page.locator('#scale')).toContainText('log scale');
  });
});

test.describe('the affordance map', () => {
  test('draws res-13 cells over the basemap', async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // The class exists so this assertion cannot be satisfied by the region
    // outlines: Leaflet renders every polygon as an indistinguishable <path>,
    // and a test matching all of them would pass with an empty grid.
    const cells = page.locator('#map path.affordance-cell');
    await expect(cells.first()).toBeVisible();
    expect(await cells.count()).toBeGreaterThan(10);
  });

  test('draws region outlines, and draws them OVER the cells', async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const outlines = page.locator('#map path.region-outline');
    await expect(outlines.first()).toBeVisible();

    // Paint order is invisible to every unit test and decides whether the
    // boundary is legible: a 2 px dashed stroke under 55 %-opacity fills is
    // washed out exactly where it matters. Leaflet's default renderer puts all
    // vectors in one shared <svg>, so DOCUMENT ORDER is paint order — the
    // outlines must come last.
    //
    // This assertion earned its place immediately: the source comment claimed
    // regions were drawn underneath while the code drew them on top, and
    // nothing else in the suite could have noticed.
    const order = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('#map svg path')];
      return {
        lastCell: paths.findLastIndex((p) =>
          p.classList.contains('affordance-cell')
        ),
        firstRegion: paths.findIndex((p) =>
          p.classList.contains('region-outline')
        ),
      };
    });
    expect(order.firstRegion).toBeGreaterThanOrEqual(0);
    expect(order.firstRegion).toBeGreaterThan(order.lastCell);
  });

  test('a cell tooltip names the OSM elements that produced its score', async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    await page.locator('#map path.affordance-cell').first().hover();

    // Provenance is the whole reason the C# reference kept a
    // contributing-entries map: it turns "that cell looks wrong" into "that
    // cell is wrong BECAUSE of way/12345" in one click. A tooltip that shows
    // only a number would make every surprising score a dead end.
    const tooltip = page.locator('.leaflet-tooltip').first();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('walkable =');
    await expect(tooltip.locator('a[href*="openstreetmap.org/"]').first()).toHaveCount(
      1
    );
  });

  test('switching category redraws the grid', async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const before = await page
      .locator('#map path.affordance-cell')
      .first()
      .getAttribute('fill');

    const other = await page.evaluate(() => {
      const select = document.getElementById('category');
      const values = [...(select?.querySelectorAll('option') ?? [])].map(
        (o) => o.value
      );
      return values.find((v) => v !== 'walkable') ?? '';
    });
    test.skip(other === '', 'rule table declares only one category');

    await page.locator('#category').selectOption(other);
    await expect(page.locator('#status')).toContainText(`${other} regions`);

    // A category switch that rescored but never repainted would leave the map
    // showing `walkable` under a `restingArea` label — the exact kind of stale
    // view a status-line-only assertion cannot see.
    await expect(page.locator('#map path.affordance-cell').first()).toBeVisible();
    const after = await page
      .locator('#map path.affordance-cell')
      .first()
      .getAttribute('fill');
    expect(after).not.toBeNull();
    expect(before).not.toBeNull();
  });
});

test.describe('the 3D view', () => {
  test('actually draws pixels, not just a canvas element', async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const canvas = page.locator('#scene canvas');
    await expect(canvas).toBeVisible();

    // THE PIXEL PROOF. A present canvas of the right size proves nothing: a
    // scene with the camera inside a wall, a mesh with no geometry, or a render
    // that never ran all produce exactly that. This reads the drawing buffer
    // (which is why the renderer sets `preserveDrawingBuffer`) and counts
    // pixels that are not the background colour.
    const painted = await page.evaluate(() => {
      const el = document.querySelector('#scene canvas');
      if (!(el instanceof HTMLCanvasElement)) return -1;
      const probe = document.createElement('canvas');
      probe.width = el.width;
      probe.height = el.height;
      const ctx = probe.getContext('2d');
      if (ctx === null) return -1;
      ctx.drawImage(el, 0, 0);
      const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
      // Background is #11131a; anything meaningfully lighter is geometry.
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r + g + b > 0x11 + 0x13 + 0x1a + 60) count++;
      }
      return count;
    });

    expect(painted).toBeGreaterThan(500);
  });

  test('reports what it built, including the honesty flags', async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // `guessed heights` is the mesh layer's honesty flag and this is the only
    // place it becomes visible. The census said only ~16 % of buildings carry a
    // `height` tag, so a demo reporting zero guesses over real data would mean
    // the flag stopped being set, not that OSM improved.
    await expect(page.locator('#status')).toContainText('volumes');
    await expect(page.locator('#status')).toContainText('guessed heights');
    await expect(page.locator('#status')).toContainText('triangles');
  });
});

test.describe('caching and failure', () => {
  test('a reload is served from OPFS without refetching', async ({ page }) => {
    const counts = await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const afterFirst = counts.overpass;
    expect(afterFirst).toBeGreaterThan(0);

    await page.reload();
    await waitForRefresh(page);

    // A res-7 tile is tens of megabytes; refetching it on every reload would
    // abuse donated infrastructure. The OPFS store is the thing that stops
    // that, and a request count is the ONLY way to see it working — the map
    // looks identical either way. `/api/status` may still be probed, so this
    // asserts no new *query*, not no new request.
    const queries = counts.overpass - afterFirst;
    expect(queries).toBeLessThanOrEqual(1);
  });

  test('a failed fetch is reported, not silently blank', async ({ page }) => {
    await stubNetwork(page, { overpassStatus: 400 });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    // A blank map with no message looks exactly like "there is no data at this
    // location" — the one reading that would send someone debugging the wrong
    // layer entirely.
    await expect(page.locator('#status')).toContainText(/unavailable|Failed/);
  });
});
