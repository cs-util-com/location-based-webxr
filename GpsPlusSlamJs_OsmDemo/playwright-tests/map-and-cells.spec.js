// @ts-check
/**
 * The 2D map and the affordance grid: the cells, the explanation panel, the
 * legend, region and cell selection, and the layer switch that gates the cell
 * data.
 *
 * Split out of the single 4 486-line `osm-demo.spec.js` so the suite's shape
 * and its growth are visible; `fixtures.js` carries the shared setup and the
 * reasoning for why the whole suite is offline.
 */

import { test, expect } from "@playwright/test";

import {
  AT_FIXTURE,
  captureUiBaseline,
  resetUi,
  stubNetwork,
  waitForRefresh,
  enableCellLayer,
  REPAINT,
} from "./fixtures.js";

/**
 * ONE BOOT FOR THIS WHOLE FILE (DEC-S5), instead of one per test.
 *
 * The boot — `stubNetwork` → `goto` → `waitForRefresh` through three
 * progressive scoring rings — was measured at ~74% of the entire e2e suite's
 * work, and it was being paid once per test to assert things about a map that
 * had not changed. Seven of this file's ten tests share this page; each is
 * returned to the baseline by `resetUi` rather than by a reload, because a
 * reload IS the boot.
 *
 * THE BASELINE IS WHATEVER THE BOOT PRODUCED — captured, never imposed. The
 * first version forced the cells ON, reasoning that five of the seven tests
 * enable them anyway and would then skip a refetch. It cost more than it saved:
 * the reset re-checked a layer the previous test had switched off, only for the
 * next test to switch it off again, and that off/on/off churn — which no
 * per-test boot ever performs — broke a 3D region pick that passed in isolation
 * and failed after its predecessor. Restoring to the captured default makes the
 * common case a genuine no-op.
 *
 * THREE TESTS ARE NOT HERE and take Playwright's own `{ page }` fixture, each
 * for a reason `resetUi` cannot fix — a different network stub, a fetch that
 * can only be watched from cells-OFF, and a geo-event marker with no control
 * that removes it. `fixtures.js` records each one next to `resetUi`.
 *
 * @type {import('@playwright/test').Page}
 */
let shared;
/** @type {{category: string, cells: boolean, showBelow: boolean}} */
let baseline;

test.beforeAll(async ({ browser }) => {
  shared = await browser.newPage();
  await stubNetwork(shared);
  await shared.goto(AT_FIXTURE);
  await waitForRefresh(shared);
  baseline = await captureUiBaseline(shared);
});

test.afterAll(async () => {
  await shared.close();
});

// Runs for the isolated tests too, where it resets a page they do not use — a
// few cheap reads, and cheaper than the two ways of avoiding it (duplicating
// this hook into all five subject describes, or guarding on the test's name).
test.beforeEach(async () => {
  await resetUi(shared, baseline);
});

test.describe("the affordance map", () => {
  test("draws the cells, the extent, the outlines, the popup — and redraws on a category switch", async () => {
    // FIVE BEHAVIOURS, ONE BOOT, and the plan for this budgeted two tests here.
    // One is enough: the first four are read-only, and the category switch is the
    // only mutation, so it simply goes last. The ordering rule does the work that
    // a second boot would have.
    // CELLS ON: they start OFF since DEC-R7b-6, and this test is about the
    // grid. Switching them on here rather than changing the default keeps the
    // default itself asserted in one place (the layer-toggle test).
    await enableCellLayer(shared); // async since round 10 stage B

    await test.step("draws res-13 cells over the basemap", async () => {
      // The class exists so this assertion cannot be satisfied by the region
      // outlines: Leaflet renders every polygon as an indistinguishable <path>,
      // and a test matching all of them would pass with an empty grid.
      const cells = shared.locator("#map path.affordance-cell");
      await expect(cells.first()).toBeVisible();
      expect(await cells.count()).toBeGreaterThan(10);
    });

    await test.step("draws the fetched extent as a box, and says how big it is", async () => {
      // WHY THIS MATTERS. "One res-7 tile" is the unit the whole plan is written
      // in, and it stays an abstraction until it is drawn over a city. The box is
      // also NOT the hexagon — Overpass has no hexagon primitive, so the query
      // covers the tile's bounding box and we pay ~39% over-fetch on every tile.
      // Both shapes are asserted because drawing only the box would confirm the
      // exact misreading the display exists to correct.
      await expect(
        shared.locator("#map path.fetch-extent").first(),
      ).toBeVisible();
      await expect(
        shared.locator("#map path.fetch-tile-hex").first(),
      ).toBeVisible();

      // The picture answers "how big" only roughly; the status line has to carry
      // the number, or the over-fetch stays invisible on a zoomed-out map.
      const status = await shared.locator("#status").textContent();
      expect(status).toMatch(/box per tile/);
      expect(status).toMatch(/hexagon/);
      expect(status).not.toMatch(/NaN|Infinity/);
    });

    await test.step("draws region outlines, and draws them OVER the cells", async () => {
      const outlines = shared.locator("#map path.region-outline");
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
      const order = await shared.evaluate(() => {
        const paths = [...document.querySelectorAll("#map svg path")];
        return {
          lastCell: paths.findLastIndex((p) =>
            p.classList.contains("affordance-cell"),
          ),
          firstRegion: paths.findIndex((p) =>
            p.classList.contains("region-outline"),
          ),
        };
      });
      expect(order.firstRegion).toBeGreaterThanOrEqual(0);
      expect(order.firstRegion).toBeGreaterThan(order.lastCell);
    });

    await test.step("a cell popup names the OSM elements that produced its score, and they are clickable", async () => {
      // Any new tab must land on a fixture, never on openstreetmap.org: this
      // suite is offline by policy, and that is about not hammering donated
      // infrastructure before it is about determinism. Routed on the CONTEXT, not
      // the page, so it also covers the tab the link opens.
      await shared
        .context()
        .route("https://www.openstreetmap.org/**", (route) =>
          route.fulfill({ contentType: "text/html", body: "<html>osm</html>" }),
        );

      const cell = shared.locator("#map path.affordance-cell").first();
      await cell.hover();

      // HOVER gives the number. That is all it can give: Leaflet tooltips are
      // non-interactive by design.
      const tooltip = shared.locator(".leaflet-tooltip").first();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText("walkable =");

      // CLICK gives the evidence. Provenance is the whole reason the C# reference
      // kept a contributing-entries map: it turns "that cell looks wrong" into
      // "that cell is wrong BECAUSE of way/12345" in one click.
      await cell.click();
      const popup = shared.locator(".leaflet-popup");
      await expect(popup).toBeVisible();

      // It STAYS open when the pointer leaves — the whole difference from a
      // tooltip, and what makes the links reachable at all.
      await shared.mouse.move(0, 0);
      await expect(popup).toBeVisible();

      // THE ASSERTION THAT WAS MISSING, and the reason this shipped broken. The
      // old test asserted the link was PRESENT (`toHaveCount(1)`) — which a dead
      // link satisfies exactly as well as a live one. These links lived in a
      // tooltip, which Leaflet renders with `pointer-events: none`, so the demo's
      // advertised core debugging affordance had never once been clickable while
      // the suite stayed green. Presence is not reachability: click it.
      const link = popup.locator('a[href*="openstreetmap.org/"]').first();
      await expect(link).toHaveAttribute(
        "href",
        /openstreetmap\.org\/(node|way|relation)\/\d+/,
      );
      const opened = await Promise.all([
        shared.waitForEvent("popup"),
        link.click(),
      ]);
      expect(opened[0].url()).toMatch(/openstreetmap\.org\//);

      // CLOSED before the next step. A Leaflet popup is an overlay pane above the
      // cells, and the step below hovers one to read its tooltip — an open popup
      // left behind would swallow that hover and fail a step that is not about
      // popups at all.
      await shared.locator(".leaflet-popup-close-button").click();
      await expect(popup).toHaveCount(0);
    });

    await test.step("switching category redraws the grid", async () => {
      const other = await shared.evaluate(() => {
        const select = document.getElementById("category");
        const values = [...(select?.querySelectorAll("option") ?? [])].map(
          (o) => o.value,
        );
        return values.find((v) => v !== "walkable") ?? "";
      });
      test.skip(other === "", "rule table declares only one category");

      await shared.locator("#category").selectOption(other);

      // THROUGH THE HELPER, NOT A BARE `toContainText` — the second instance of
      // a flake this file has already diagnosed once (see the "my location"
      // test, fixed 2026-08-02 with the same reasoning). Choosing a category
      // kicks off a full rescore; the bare assertion allowed only Playwright's
      // default 5 s, which under the ROOT cascade's contention expires while the
      // status line still reads "Fetching and scoring around 50.92310,
      // 6.94450…" — the pipeline working correctly and slowly, not a defect.
      // Captured exactly that way on 2026-08-04, having passed the package's own
      // gate twice; the extra load of the other seven packages is the difference.
      // `waitForRefresh` allows 60 s and waits for the progressive widening to
      // settle, which nearly every other test here already relies on.
      await waitForRefresh(shared);
      await expect(shared.locator("#status")).toContainText(`${other} regions`);

      // A category switch that rescored but never repainted would leave the map
      // showing `walkable` under a `restingArea` label — the exact kind of stale
      // view a status-line-only assertion cannot see.
      //
      // ASSERTED VIA THE TOOLTIP, not the fill. The earlier version read the fill
      // before and after and then only checked both for non-nullness, so a cell
      // that kept its exact `walkable` colour passed — which is precisely the
      // failure the comment claims to catch. Comparing the fills instead would be
      // legitimately flaky, because two categories can land a given cell in the
      // same colour bucket. The tooltip cannot be stale: `map-view.ts` rebuilds it
      // per render with `tooltipFor(cell, category, score)`, so it NAMES the
      // category the paths were drawn for.
      const cell = shared.locator("#map path.affordance-cell").first();
      await expect(cell).toBeVisible();
      await cell.hover();
      await expect(shared.locator(".leaflet-tooltip").first()).toContainText(
        `${other} =`,
      );

      // W2, added 2026-07-29. Everything above proves the map REDREW; none of it
      // proves a person could tell. Until the legend landed, the only place the
      // app named the current category was inside a tooltip, so the reported
      // symptom — "switching category did not reset the map" — was reachable with
      // this test passing: every category scores nearly every rule, and
      // `heatScale` re-normalises to each category's own maximum, so the same
      // hexagons come back in similar colours. The legend is the fix, and this is
      // the assertion that keeps it honest.
      await expect(shared.locator("#legend .legend-category")).toHaveText(
        other,
      );
    });
  });
});

test.describe("explaining one cell", () => {
  test("opens a panel, reveals the bands, explains a veto, and follows the selection", async () => {
    // FOUR BEHAVIOURS, ONE BOOT. The plan budgeted two tests here; one is enough
    // because the only genuinely irreversible act — MOVING the user, which drops
    // the selection — is the last thing the last step does. Everything before it
    // either reads or toggles a switch it puts back.
    // CELLS ON: they start OFF since DEC-R7b-6, and this test is about the
    // grid. Switching them on here rather than changing the default keeps the
    // default itself asserted in one place (the layer-toggle test).
    await enableCellLayer(shared); // async since round 10 stage B

    const panel = shared.locator("#details");

    await test.step("clicking a cell opens a details panel explaining its score", async () => {
      await expect(panel).toBeHidden();

      await shared.locator("#map path.affordance-cell").first().click();
      await expect(panel).toBeVisible();

      // The panel must carry what the popup cannot: every contributing feature,
      // expandable to its individual TAGS. "Which element made this 9?" was
      // already answerable; "which TAG made it 0?" is what this exists for.
      const feature = panel.locator("details.panel-feature").first();
      await expect(feature).toBeVisible();
      await feature.locator("summary").click();
      await expect(feature.locator("tr.panel-tag").first()).toBeVisible();

      // Dismissing it deselects, rather than merely hiding a still-selected cell
      // — otherwise re-clicking the same cell would appear to do nothing.
      await panel.locator(".panel-close").click();
      await expect(panel).toBeHidden();
      await shared.locator("#map path.affordance-cell").first().click();
      await expect(panel).toBeVisible();

      // Deselected again, so the next step starts where a fresh boot would.
      await panel.locator(".panel-close").click();
      await expect(panel).toBeHidden();
    });

    await test.step("the checkbox reveals sub-threshold cells in three distinct bands", async () => {
      const cells = shared.locator("#map path.affordance-cell");
      const before = await cells.count();

      await shared.locator("#show-below").check();

      // More cells, and specifically the two the old single skip made
      // indistinguishable: a hard veto and "no rule said anything here". Being
      // able to tell those apart is the entire point of the checkbox — and the
      // vetoed cell was previously the one cell that could not be clicked to ask
      // why it was vetoed, because it was not drawn.
      await expect
        .poll(async () => cells.count(), REPAINT)
        .toBeGreaterThan(before);
      // BOTH of the two that were previously indistinguishable, not just one.
      // Asserting only the identity band would pass on a fixture with no vetoed
      // cells at all — and the vetoed cell is the one the checkbox exists for.
      // The park fixture carries 15 of them against the checked-in rule table.
      await expect(
        shared.locator("#map path.affordance-cell-identity").first(),
      ).toBeAttached();
      await expect(
        shared.locator("#map path.affordance-cell-veto").first(),
      ).toBeAttached();

      // The legend grows the three band swatches with it: colours on screen that
      // the legend does not explain are worse than no legend.
      await expect(shared.locator("#legend .legend-band")).toHaveCount(3);
    });

    await test.step("a vetoed cell explains WHY it is zero, which is the whole round", async () => {
      // THE HEADLINE CLAIM, asserted end to end for the first time. Everything
      // else in this round is scaffolding for one question the owner asked of a
      // cemetery tile: "why is this zero when it is also a park and a meadow?"
      //
      // Answering it needs four separate pieces to line up — the cell must be
      // DRAWN (W7), be CLICKABLE, open a panel (W6), and that panel must name the
      // vetoing element and mark the tag that did it (explainCell). Each of those
      // is unit-tested in isolation; nothing until now proved they connect.
      //
      // The reveal switch is already on from the step above, which is the state
      // this step needs — it is checked again rather than assumed, because a step
      // that silently depends on its predecessor is the coupling fusion has to
      // avoid.
      await shared.locator("#show-below").check();
      const vetoed = shared.locator("#map path.affordance-cell-veto").first();
      await expect(vetoed).toBeVisible();
      await vetoed.click();

      await expect(panel).toBeVisible();

      // The sentence a table of numbers cannot say. "Nothing is mapped here",
      // "something vetoed it" and "it scored but under the bar" all render as
      // near-identical rows; the summary is what separates them.
      await expect(panel.locator(".panel-summary")).toContainText(/vetoed/i);

      // The vetoing FEATURE is marked, and open by default — the reader should
      // not have to guess which of several rows holds the answer.
      const vetoFeature = panel.locator("details.panel-feature-veto").first();
      await expect(vetoFeature).toBeVisible();
      await expect(vetoFeature).toHaveAttribute("open", "");

      // And the vetoing TAG inside it, which is the actual answer: not "some
      // element zeroed this" but "this key=value did".
      await expect(
        vetoFeature.locator("tr.panel-tag-veto").first(),
      ).toBeVisible();

      // THE OTHER HALF OF THE QUESTION, and the reason a tree was built rather
      // than a one-line "vetoed by X" banner. The owner asked to see that it
      // "was a meadow and a park and maybe even had a bench, but that the
      // cemetery reset it to zero regardless of how high the other ratings
      // were" — so the outvoted contributors must still be listed under the veto.
      expect(
        await panel.locator("details.panel-feature").count(),
      ).toBeGreaterThan(1);

      // And "what about the bench?" — the tags the veto short-circuit never
      // evaluated, rendered struck through. That row class exists for exactly
      // this sentence and had never been looked at outside a unit test. Every
      // vetoed cell in the park fixture carries between one and five of them.
      await expect(panel.locator("tr.panel-tag-skipped").first()).toBeVisible();

      // Back to the boot state: the reveal off, and nothing selected.
      await panel.locator(".panel-close").click();
      await shared.locator("#show-below").uncheck();
    });

    await test.step("the selection follows a category switch and is dropped when the user moves", async () => {
      // The store's central promise: the panel can never describe a cell in a
      // category the map is no longer showing, and can never describe a cell
      // belonging to a place the user has left. Both rules live in one reducer,
      // one line apart, and both are invisible to every other test here.
      await shared.locator("#map path.affordance-cell").first().click();
      await expect(panel).toBeVisible();
      await expect(panel.locator(".panel-header strong")).toContainText(
        "walkable",
      );

      // A category change KEEPS the selection — "what does this same cell score
      // for battleArea?" is the obvious next click, and clearing it would make
      // that question impossible to ask.
      const other = await shared.evaluate(() => {
        const select = document.getElementById("category");
        const values = [...(select?.querySelectorAll("option") ?? [])].map(
          (o) => o.value,
        );
        return values.find((v) => v !== "walkable") ?? "";
      });
      test.skip(other === "", "rule table declares only one category");
      await shared.locator("#category").selectOption(other);
      // A category change starts its OWN progressive refresh (W16), and the panel
      // is re-explained on each ring. Capturing state before that settles races
      // three republishes — which is what made this test flaky in the suite while
      // passing standalone.
      await waitForRefresh(shared);

      await expect(panel).toBeVisible();
      // Re-explained in the NEW category, not left showing the old answer.
      await expect(panel.locator(".panel-header strong")).toContainText(other);

      // Moving the user DROPS it: the cell belongs to the place being left.
      //
      // The click has to land on BARE map, and that is not incidental. A click on
      // a cell selects without moving — Leaflet's `bindPopup` stops propagation,
      // so the map's own click handler never fires — while a click on empty map
      // moves without selecting. Asserting the precondition means a fixture whose
      // grid grows to cover this point fails loudly here rather than quietly
      // passing for the wrong reason.
      const point = { x: 60, y: 60 };
      const box = await shared.locator("#map").boundingBox();
      if (box === null) throw new Error("no map box");
      const onCell = await shared.evaluate(
        ([x, y]) =>
          document
            .elementFromPoint(x, y)
            ?.classList.contains("affordance-cell") === true,
        [box.x + point.x, box.y + point.y],
      );
      expect(onCell).toBe(false);

      await shared.locator("#map").click({ position: point });
      await expect(panel).toBeHidden();
    });
  });
});

/**
 * W12 / finding R3-8 — one scale, and a legend that says when there is no ramp.
 */
test.describe("the legend", () => {
  test("keeps its scale, and says when nothing qualifies", async () => {
    // TWO BEHAVIOURS, ONE BOOT. The boot is ~4.8 s of a ~6.5 s test and both of
    // these want the identical one, so paying it twice bought nothing. They stay
    // separately named through `test.step`, which is what keeps a failure
    // pointing at one behaviour rather than at a pair — see
    // GpsPlusSlamJs_Docs/docs/2026-08-02-0612-osm-demo-e2e-fusion-plan.md.

    await test.step("keeps its scale when the cells layer is switched off", async () => {
      // THE DEFECT, and it is not in the notes: the scale was derived from the
      // cells the MAP was handed, and those are filtered by this switch. So
      // switching it off collapsed the ramp — the legend went to "1 to 1" and the
      // 2D region fills were coloured on an empty scale while the 3D slabs used a
      // different one. Two views, two scales, the same regions.
      const legend = shared.locator("#legend");
      const before = await legend.textContent();
      expect(before).not.toBeNull();

      await shared.locator("#layer-cells").uncheck();
      await expect(shared.locator("#map path.affordance-cell")).toHaveCount(0);

      // The cells are gone from the map; the scale describes the data, not the
      // drawing, so the legend must be unchanged.
      await expect(legend).toHaveText(before ?? "");

      // RESTORED before the next step. This step's own claim is that the legend
      // does not depend on the switch, so leaving it off would be harmless here —
      // but a step that hands the next one a state it did not ask for is how
      // fused tests start failing for reasons that are not about them.
      //
      // THROUGH THE HELPER, not a hand-rolled check-and-assert. Switching this
      // layer on is a REFETCH, not a redraw (cells are data-gated since round 10
      // stage B), so the whole progressive cycle runs and the default 5 s expect
      // timeout is racing it on a loaded machine. This site hand-rolled exactly
      // what `enableCellLayer` was given a `waitForRefresh` for in 518fd7d — the
      // FOURTH appearance of that same failure, and it duly failed in a full
      // gate run while passing in isolation.
      await enableCellLayer(shared);
    });

    await test.step("says nothing qualifies instead of showing a 1-to-1 ramp", async () => {
      // The reported symptom, as an assertion. Any category with no cell above the
      // bar produces a degenerate scale; the fixture's own categories are used
      // rather than a hardcoded name, so this stays true if the rule table moves.
      const picker = shared.locator("#category");
      const values = await shared
        .locator("#category option")
        .evaluateAll((nodes) =>
          nodes.map((node) => /** @type {HTMLOptionElement} */ (node).value),
        );

      for (const value of values) {
        await picker.selectOption(value);
        await waitForRefresh(shared);
        const text = (await shared.locator("#legend").textContent()) ?? "";
        // Either there is a real ramp, or there is a sentence — never a ramp whose
        // two ends carry the same number.
        const min = await shared.locator("#legend .legend-min").count();
        if (min === 0) {
          expect(text).toContain("no cell scores above");
          return;
        }
      }
      // Not a failure: this fixture may have data for every category. Recorded so
      // a green run cannot be mistaken for proof that the empty state was reached.
      test.info().annotations.push({
        type: "note",
        description: "every category had cells above the bar in this fixture",
      });
    });
  });
});

/**
 * W13 / finding R3-8 — "show cells below the threshold does nothing".
 *
 * The switch was wired correctly the whole time. What it revealed was
 * near-invisible: a 1 px 50 %-opacity dashed outline on the map, and in 3D every
 * sub-threshold cell painted at the ramp's darkest stop over dark ground.
 */
test.describe("revealing the sub-threshold cells", () => {
  test("changes BOTH views, and the cells it reveals are interrogable", async () => {
    // CELLS ON: they start OFF since DEC-R7b-6, and this test is about the
    // grid. Switching them on here rather than changing the default keeps the
    // default itself asserted in one place (the layer-toggle test).
    // Through the helper: the cells arrive asynchronously since round 10 stage
    // B, and `before2d` is captured immediately below. Without the wait it was
    // captured as ZERO -- so the "and back" assertion compared 1387 against 0
    // and the test failed for a reason that had nothing to do with show-below.
    await enableCellLayer(shared);

    await test.step("changes BOTH views, in both directions", async () => {
      const canvas = shared.locator("#scene canvas");
      const shot = () =>
        shared.evaluate(() => {
          const el = document.querySelector("#scene canvas");
          return el instanceof HTMLCanvasElement ? el.toDataURL() : "";
        });
      await expect(canvas).toBeVisible();

      const cells = shared.locator("#map path.affordance-cell");
      const before2d = await cells.count();
      const before3d = await shot();

      await shared.locator("#show-below").check();

      // 2D: more cells on screen. 3D: a different picture. Both halves, because
      // the reported symptom was that nothing appeared to happen at all.
      await expect.poll(() => cells.count()).toBeGreaterThan(before2d);
      await expect.poll(shot, REPAINT).not.toBe(before3d);

      // AND BACK, which is the half that catches a redraw that only ever adds.
      await shared.locator("#show-below").uncheck();
      await expect.poll(() => cells.count()).toBe(before2d);
    });

    await test.step("an identity cell can still be clicked to ask why", async () => {
      // DEC-7's stated reason for revealing these cells at all: a hidden cell is
      // the one cell you cannot click to ask why. W13 changes the identity band's
      // TREATMENT — outline, not fill — and DEC-R3-21 keeps it interrogable.
      //
      // ASSERTED ON THE MAP, where a specific band can be addressed by class. The
      // 3D half of the same guarantee is the invisible pick face, which
      // `cell-mesh.test.ts` pins directly: a canvas click cannot be aimed at a
      // particular band without solving for the projection first.
      //
      // The switch is checked again here rather than inherited: the step above
      // ends by unchecking it, because "and back" is half of ITS claim.
      await shared.locator("#show-below").check();
      // THE CELL NEAREST THE MAP CENTRE, not the first in DOM order.
      //
      // Leaflet puts its controls in the CORNERS — zoom top-left, attribution
      // bottom-right — and they sit above the tile/vector panes. `.first()`
      // takes whatever the renderer happened to emit first, which can be a cell
      // underneath one of them; the centre is clickable by construction.
      //
      // This is what made the test fail on CI and never locally, from #256
      // onward: an eighth layer switch made the header taller, the map shorter,
      // and the first identity cell moved under the attribution bar. Whether it
      // lands there depends on font metrics, so Linux failed and Windows did
      // not. CI named it once the click stopped being forced:
      // "<div class=leaflet-control-attribution> intercepts pointer events".
      const identity = await shared.evaluate(() => {
        const map = document.querySelector("#map");
        if (map === null) return null;
        const box = map.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        let best = null;
        let bestDistance = Infinity;
        document
          .querySelectorAll("#map path.affordance-cell-identity")
          .forEach((path, index) => {
            const r = path.getBoundingClientRect();
            const d = Math.hypot(
              r.left + r.width / 2 - cx,
              r.top + r.height / 2 - cy,
            );
            if (d < bestDistance) {
              bestDistance = d;
              best = index;
            }
          });
        return best;
      });
      expect(identity).not.toBeNull();
      const identityCell = shared
        .locator("#map path.affordance-cell-identity")
        .nth(identity);
      await expect(identityCell).toBeVisible();

      // NOT `force: true`, and that is the diagnostic.
      //
      // `force` skips the actionability check — including "is this element
      // covered by another one?" — and dispatches at the coordinates anyway. So
      // an intercepted click looked identical to a click that landed and did
      // nothing, which is exactly the ambiguity that has cost four wrong
      // diagnoses of this CI-only failure.
      //
      // Without force, Playwright NAMES the element it is waiting for instead of
      // silently clicking through it — which is what tells an intercepted click
      // apart from one that landed and did nothing. The poll below covers the
      // second case.
      await identityCell.click();

      // ASSERTED THROUGH THE APP'S OWN STATE, not just on the panel.
      //
      // The bare `toBeVisible` here failed in CI on five consecutive PRs and
      // never once locally, and its message — "13 x locator resolved to <aside
      // hidden>" — could not distinguish the two ways this goes silent: the
      // worker no longer holding the cell, or the reply being dropped because
      // the selection changed mid-flight. A failure that cannot name its own
      // cause costs a debugging cycle every time it appears.
      //
      // So the poll reports the STATUS LINE alongside the panel state, and it
      // distinguishes the two ways the panel can be up:
      //
      // - `explained` — a real explanation, which is the only pass. Keyed on
      //   `.panel-threshold`, which only `DetailsPanel.render` emits.
      // - `unavailable` — the panel is up and saying it has nothing to explain.
      //   Since #265 that is a PANEL mode rather than a status-line error, so a
      //   bare `toBeVisible()` here would now go green on it. Naming it keeps
      //   this assertion about the explanation rather than about the overlay.
      // - `hidden` — nothing rendered. The status line comes with it, because
      //   that is where a refresh failure would show. A healthy-looking status
      //   line here means the click selected nothing, or the answer was dropped
      //   as stale on arrival (`explain-cycle.ts` returns silently for that, by
      //   design — a superseded answer is not an event the user should see).
      await expect
        .poll(
          async () => {
            const details = shared.locator("#details");
            if (!(await details.isVisible())) {
              return `hidden — status: ${await shared.locator("#status").textContent()}`;
            }
            const explained = await details.locator(".panel-threshold").count();
            if (explained > 0) return "explained";
            return `unavailable — panel: ${await details.textContent()}`;
          },
          { timeout: 30000 },
        )
        .toBe("explained");
    });
  });
});

test.describe("selecting a region", () => {
  /**
   * WHY THESE TESTS EXIST (DEC-R7b-3a). A testing session asked to click a heat
   * area and see its details, and reported that clicking one already showed a
   * bounding box. It did not: regions had a tooltip in 2D, no click handler in
   * either view, and were absent from the 3D raycast set by construction. What
   * was seen was the browser's focus outline on a Leaflet `<path>`.
   *
   * TWO TESTS RATHER THAN TWO STEPS, and that is a correction rather than a
   * style choice. Written as steps in one test, the 3D half ran against a panel
   * the 2D half had already opened — so `toBeVisible` passed on stale content
   * and the real assertion failed for a reason that had nothing to do with 3D.
   * The two routes to `regionSelected` are independent (a Leaflet handler and a
   * three.js raycast) and are now tested independently.
   */
  test("opens the details panel from the 2D map", async () => {
    const panel = shared.locator("#details");

    // CELLS OFF FIRST, and that is the realistic flow rather than a test
    // convenience: the cell layer draws in a pane ABOVE the region pane, so a
    // click anywhere a cell covers reaches the cell. That is deliberate --
    // `resolvePick` prefers the finer claim in 3D for the same reason -- and it
    // means a region is reachable exactly where the grid is not.
    await shared.locator("#layer-cells").uncheck();

    // The FILLED class, not the outline: an unfilled sub-threshold outline is
    // also a `<path>`, and matching it would pass while nothing was selected.
    const region = shared.locator("#map .region-fill").first();
    await region.waitFor({ state: "visible" });
    await region.click({ force: true });

    await expect(panel).toBeVisible();
    const stats = panel.locator(".panel-stats");
    await expect(stats).toBeVisible();
    // The statistic the whole panel exists for: the colour is the median, and
    // the range is what the colour cannot say.
    await expect(stats).toContainText("median");
    await expect(stats).toContainText("range");

    // CLOSING DESELECTS, so the SAME region can be re-opened. `details-panel.ts.md`
    // states this invariant and it was honoured for cells only: `onClose`
    // cleared `selectedCell` and left `selectedRegion` set, so a second click on
    // the same region dispatched an identical value and the panel stayed shut —
    // a dead click, which is exactly the defect the invariant describes.
    // Unfindable with a page per test, because nothing ever clicked a region
    // twice; the shared-page pilot surfaced it as one test breaking the next.
    await panel.locator(".panel-close").click();
    await expect(panel).toBeHidden();
    await region.click({ force: true });
    await expect(panel).toBeVisible();
  });

  // ITS OWN PAGE, and this one is an honest defeat rather than a known
  // limitation like the other three. It passes alone on the shared page and
  // fails after its predecessor, so something that test leaves behind breaks the
  // 3D raycast — and four attempts did not find what. Ruled out and disproved by
  // measurement, not by argument: the layer-baseline churn (fixed anyway), a
  // missing wait after hiding the cells (added anyway), and the leaked region
  // selection (a real app defect, fixed in `main.ts` and now pinned by the 2D
  // test above). None of them was it.
  //
  // Isolating it keeps six of ten tests sharing a page rather than blocking the
  // whole file on one unexplained interaction. **Left deliberately visible**: if
  // the shared page is ever extended to the other spec files, this is the known
  // unsolved case, and the 3D raycast is where to start looking.
  test("opens the same panel from the 3D scene", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    const shared = page;

    // WITH THE CELLS HIDDEN, which is the point rather than a convenience: a
    // slab lies directly under the grid and `resolvePick` prefers the finer
    // claim, so a region is reachable exactly where the grid is not.
    //
    // AND THE HIDING IS NOW WAITED FOR. On a per-test boot this `uncheck()` was
    // a no-op — DEC-R7b-6 makes cells-off the default, so the box was already
    // clear — and the click that follows was therefore never racing anything.
    // On the file's shared page the baseline has the cells ON, so this is a real
    // state change, and clicking before the grid has gone picks a cell instead
    // of the slab underneath it. The test relied on a default it described as
    // deliberate; now it establishes the state it needs.
    await shared.locator("#layer-cells").uncheck();
    await expect(shared.locator("#map path.affordance-cell")).toHaveCount(0);

    const canvas = shared.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");
    await shared.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const panel = shared.locator("#details");
    await expect(panel).toBeVisible();
    // The SAME panel and the same mode a 2D click produces -- one selection, one
    // explanation, and the panel does not know which view produced it.
    await expect(panel.locator(".panel-stats")).toContainText("median");
  });

  test("replaces a region selection when a cell is selected", async () => {
    // The mutual-exclusivity rule, seen from the outside. There is one panel, so
    // there is one selection; a region panel left under a cell selection would
    // be a confidently wrong answer.

    const panel = shared.locator("#details");

    await shared.locator("#layer-cells").uncheck();
    const region = shared.locator("#map .region-fill").first();
    await region.waitFor({ state: "visible" });
    await region.click({ force: true });
    await expect(panel.locator(".panel-stats")).toBeVisible();

    await enableCellLayer(shared); // async since round 10 stage B
    const cell = shared.locator("#map .affordance-cell").first();
    await cell.click({ force: true });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".panel-stats")).toHaveCount(0);
  });
});

test.describe("the geo-event", () => {
  /**
   * WHY THIS TEST EXISTS (round 9). Everything below the button is unit-tested —
   * the seeded candidates, the climb, the gate, the ensure-then-pin ordering —
   * but none of that proves the worker call, the button state and the drawing
   * are wired to each other. This is the only assertion that the feature exists
   * from a user's point of view.
   *
   * It also pins the in-progress state, which the root CLAUDE.md requires of an
   * async control and which is easy to omit: the operation can score hundreds of
   * chunks, so a button that looked inert while it worked would read as broken.
   */
  test("finds an event from the button and draws it on the map", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const button = page.locator("#geo-event");
    await expect(button).toHaveText(/Next geo-event/);

    await button.click();

    // The label must reach a terminal state. Either outcome is a pass — a
    // fixture with no qualifying ground genuinely has no event, and asserting
    // "an event was found" would make this test depend on the fixture's heat
    // rather than on the wiring.
    await expect(button).toHaveText(/Event at|No event nearby/, {
      timeout: 30_000,
    });
    await expect(button).toBeEnabled();

    // And nothing failed: a geo-event error routes through the same channel a
    // fetch failure does, so the header would be showing it.
    await expect(page.locator("#status")).not.toContainText("geo-event failed");

    // If it found one, it is on the map. The winner carries a class of its own
    // so this cannot pass on a candidate marker.
    const label = await button.textContent();
    if (label?.includes("Event at") === true) {
      // THE DISTANCE AND DIRECTION ARE THE POINT (F56), not decoration. The
      // winner is usually off-screen, so this string is the only feedback the
      // user gets; a label that lost them would look identical to a working
      // one on a map that happens to be showing nothing.
      expect(label).toMatch(
        /\d+(\.\d+)? (m|km) (N|NE|E|SE|S|SW|W|NW) · searched \d+ tiles?$/,
      );

      // PRESENT, not VISIBLE, and the difference is a real property of the
      // feature rather than a test convenience. An event tile is ~900 m across
      // and the demo opens at zoom 18, which shows a couple of hundred metres --
      // so the winner is very often outside the viewport, and Leaflet renders an
      // off-screen path as `d="M0 0"`, which reads as hidden. Asserting
      // visibility would make this test pass or fail on where the seeded
      // candidate happened to land.
      await expect(page.locator("#map .geo-winner")).not.toHaveCount(0);
      await expect(page.locator("#map .geo-candidate")).not.toHaveCount(0);
    }
  });
});

test.describe("the cell layer toggle", () => {
  /**
   * WHY THIS TEST EXISTS (F58).
   *
   * Round 10 stage B made switching the cell layer ON asynchronous: the snapshot
   * omits the array while the layer is off, so the toggle triggers a refresh
   * rather than a redraw. The round-10 summary ESTIMATED that this stays under
   * the "few hundred milliseconds" at which the root `CLAUDE.md` requires an
   * in-progress state, and flagged the estimate as an estimate.
   *
   * MEASURED AT ~1880 ms with the tiles already held — about 5x over. So the
   * switch needs a transitional state, and this asserts it is reached rather
   * than asserting a latency bound, which would be a machine-speed test.
   *
   * The rule the removed `setAvailable` left behind applies: DISABLED, never
   * hidden, stored value untouched. A control that disappears reads as a bug,
   * and one whose value is silently reset loses the choice just made.
   */
  test("shows an in-progress state while the cells are fetched", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const toggle = page.locator("#layer-cells");
    const row = page.locator("label.layer-toggle", { has: toggle });

    // OBSERVED, NOT POLLED. The busy state is transient — on a warm fixture it
    // can close in a few milliseconds — and a poll interval wide enough to be
    // cheap is wide enough to miss it entirely. That is the same reasoning
    // `recordStatus` gives for watching `#status` with a MutationObserver, and
    // the same technique.
    //
    // Two sequential `expect`s were the first attempt and were worse than
    // wrong: they sampled two different instants, so the class check passed and
    // the disabled check then failed against a state that had already cleared.
    const observed = await page.evaluate(() => {
      const input = document.getElementById("layer-cells");
      const label = input?.closest("label");
      if (label === null || label === undefined) return Promise.resolve(null);
      /** @type {{busy: boolean, disabled: boolean}[]} */
      const seen = [];
      const sample = () => {
        seen.push({
          busy: label.classList.contains("layer-busy"),
          disabled: input instanceof HTMLInputElement ? input.disabled : false,
        });
      };
      const observer = new MutationObserver(sample);
      observer.observe(label, { attributes: true, subtree: true });
      const w = /** @type {Record<string, unknown>} */ (window);
      w["__busySamples"] = seen;
      w["__stopBusy"] = () => {
        observer.disconnect();
        return seen;
      };
      return Promise.resolve(true);
    });
    expect(observed).toBe(true);

    await toggle.check();

    // AND LEFT: the terminal state is the switch usable again, with the choice
    // preserved — not reset, which is the half a naive implementation loses.
    await expect(row).not.toHaveClass(/layer-busy/, { timeout: 30000 });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();
    await expect(page.locator("#map path.affordance-cell")).not.toHaveCount(0);

    // AND THE TRANSITIONAL STATE WAS ACTUALLY REACHED. Read only now, because
    // the observer had to outlive the whole operation — this is the assertion
    // the two racing `expect`s were trying and failing to make.
    const samples = await page.evaluate(() => {
      const w = /** @type {Record<string, unknown>} */ (window);
      const stop = w["__stopBusy"];
      return typeof stop === "function"
        ? /** @type {() => {busy: boolean, disabled: boolean}[]} */ (stop)()
        : [];
    });
    expect(
      samples.some((sample) => sample.busy && sample.disabled),
      "never saw the row busy AND the input disabled at the same moment",
    ).toBe(true);
  });

  test("leaves the switch usable when the refresh fails", async ({ page }) => {
    // THE FAILURE PATH, which `CLAUDE.md` requires alongside the success one.
    // A busy state that only clears on success strands the control forever, and
    // that is exactly the shape a `.then()` instead of a `.finally()` produces.
    // EVERY TILE REFUSED, from the start. `fetchFailed` then CLEARS the
    // snapshot, so the toggle sees nothing held, asks for a refresh, and that
    // refresh fails too -- which is the state the busy flag has to survive.
    //
    // (Written first as a `page.evaluate` calling a `__failWorker` hook that does
    // not exist, so the evaluate was a no-op and the test silently re-ran the
    // success path. An unfailable test, in the file where this round has been
    // cataloguing unfailable tests.)
    await stubNetwork(page, { overpassStatus: 400 });
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);
    await expect(page.locator("#status")).toContainText(/unavailable|Failed/);

    const toggle = page.locator("#layer-cells");
    const row = page.locator("label.layer-toggle", { has: toggle });

    // INSTALLED BEFORE THE CLICK. The busy window opens and closes inside the
    // operation, so an observer attached afterwards sees nothing and reports
    // "never busy" — which is what happened on the first attempt at this, for
    // the third time in this file.
    const seenBusy = await page.evaluate(() => {
      const input = document.getElementById("layer-cells");
      const label = input?.closest("label");
      if (label === null || label === undefined) return false;
      /** @type {boolean[]} */
      const seen = [];
      const observer = new MutationObserver(() => {
        seen.push(label.classList.contains("layer-busy"));
      });
      observer.observe(label, { attributes: true, subtree: true });
      const w = /** @type {Record<string, unknown>} */ (window);
      w["__stopFailBusy"] = () => {
        observer.disconnect();
        return seen;
      };
      return true;
    });
    expect(seenBusy).toBe(true);

    await toggle.check();

    // However it settles, the control comes back — AND WAS BUSY IN BETWEEN.
    //
    // `not.toHaveClass` alone cannot tell "cleared" from "never applied": it
    // succeeds on its first sample, so the assertion passed with
    // `withLayerBusy` deleted from `main.ts` entirely. The rewrite that fixed
    // the no-op `__failWorker` hook replaced an unfailable MECHANISM and kept an
    // unfailable ASSERTION, which is the same defect one level down.
    //
    // So the observer from the success test is installed here too, and the
    // busy state has to have been REACHED before it is allowed to be gone.
    await expect(row).not.toHaveClass(/layer-busy/, { timeout: 30000 });
    await expect(toggle).toBeEnabled();

    const failSamples = await page.evaluate(() => {
      const w = /** @type {Record<string, unknown>} */ (window);
      const stop = w["__stopFailBusy"];
      return typeof stop === "function"
        ? /** @type {() => boolean[]} */ (stop)()
        : [];
    });
    expect(
      failSamples.some((busy) => busy),
      "the switch never entered the busy state, so 'not busy' proves nothing",
    ).toBe(true);

    // NOTE ON WHAT THIS STILL DOES NOT COVER. `refresh()` does not reject here:
    // `update` collects refused tiles into `missingTiles` rather than throwing,
    // so an HTTP 400 is a SUCCESSFUL, empty refresh (`refresh-cycle.ts.md` says
    // so). The `finally`-versus-`then` distinction is unreachable from a browser
    // and is unit-tested on `withLayerBusy` instead.
  });
});
