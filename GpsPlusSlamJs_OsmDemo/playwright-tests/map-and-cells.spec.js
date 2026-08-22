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

import {
  test,
  expect,
  attachOnFailure,
  createPageDiagnostics,
} from "./e2e-test.js";

import {
  AT_FIXTURE,
  captureUiBaseline,
  resetUi,
  stubNetwork,
  waitForRefresh,
  enableCellLayer,
  walkByMapClick,
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
 * FOUR TESTS ARE NOT HERE and take Playwright's own `{ page }` fixture. Three
 * are known limitations `resetUi` cannot fix — a different network stub, a fetch
 * that can only be watched from cells-OFF, and a geo-event marker with no
 * control that removes it; `fixtures.js` records each next to `resetUi`. The
 * fourth is an unexplained 3D-raycast interaction, documented at the test.
 *
 * @type {import('@playwright/test').Page}
 */
let shared;
/** @type {{category: string, cells: boolean, showBelow: boolean}} */
let baseline;

/**
 * THE SHARED PAGE'S OWN DIAGNOSTICS. `e2e-test.js` wraps the `page` fixture, and
 * this file does not use it — so without this wiring the largest spec file in the
 * suite would be the one place a browser-side failure stays invisible. Created
 * before the first navigation, because a boot failure is exactly what it is for.
 *
 * @type {ReturnType<typeof createPageDiagnostics>}
 */
let sharedDiagnostics;

test.beforeAll(async ({ browser }) => {
  shared = await browser.newPage();
  sharedDiagnostics = createPageDiagnostics(shared, {
    baseUrl: test.info().project.use.baseURL,
  });
  await stubNetwork(shared);
  await shared.goto(AT_FIXTURE);
  await waitForRefresh(shared);
  baseline = await captureUiBaseline(shared);
});

test.afterAll(async () => {
  // GUARDED: if `beforeAll` throws -- a boot timeout is the likely one, since it
  // runs the whole fetch/score/widen chain -- `shared` is still undefined, and an
  // unguarded close reports a TypeError next to the real failure in a run that is
  // already hard to read.
  if (shared !== undefined) await shared.close();
});

// Runs for the isolated tests too, where it resets a page they do not use — a
// few cheap reads, and cheaper than the two ways of avoiding it (duplicating
// this hook into all five subject describes, or guarding on the test's name).
test.beforeEach(async () => {
  await resetUi(shared, baseline);
});

// Attach what the browser said, then clear it: one collector serves every test in
// this file, so without the reset each attachment would replay its predecessors'.
// TWO TOOLS DISAGREE HERE, and the disable is the resolution rather than a
// shortcut. Playwright REQUIRES a hook's first argument to be an object
// destructuring pattern — `async (_fixtures, testInfo)` fails at collection with
// "First argument must use the object destructuring pattern" — while eslint's
// `no-empty-pattern` rejects the `{}` that requirement forces. This hook needs no
// fixture at all, and naming one (`{ page }`) would instantiate a browser context
// for every test in the file, which is precisely what this file avoids.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  await attachOnFailure(sharedDiagnostics, testInfo);
  sharedDiagnostics.reset();
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
      await expect(tooltip).toContainText("battleArea =");

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
      // CLOSED, like the Leaflet popup below. With a page per test this tab died
      // with the context; on the file's shared context it would outlive the test
      // and accumulate across the file.
      await opened[0].close();

      // CLOSED before the next step. A Leaflet popup is an overlay pane above the
      // cells, and the step below hovers one to read its tooltip — an open popup
      // left behind would swallow that hover and fail a step that is not about
      // popups at all.
      await shared.locator(".leaflet-popup-close-button").click();
      await expect(popup).toHaveCount(0);
    });

    await test.step("switching category redraws the grid", async () => {
      // AGAINST THE CURRENT VALUE, never against a hard-coded name. A literal
      // here can select the category that is ALREADY showing once the default
      // changes (DEC-G3 moved it to `battleArea`), and a "switch" to the value
      // already selected fires no `change` event — so this step would pass
      // while testing nothing, which is worse than failing.
      const other = await shared.evaluate(() => {
        const select = document.getElementById("category");
        const values = [...(select?.querySelectorAll("option") ?? [])].map(
          (o) => o.value,
        );
        return values.find((v) => v !== select?.value) ?? "";
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
      // this test passing: every category scores nearly every rule, so the same
      // hexagons come back in similar colours whichever one is selected. The
      // legend is the fix, and this is the assertion that keeps it honest.
      //
      // (This used to cite `heatScale` re-normalising to each category's own
      // maximum. DEC-H5 deleted that mechanism and the reason outlived it: the
      // ambiguity is the OVERLAP between categories, which a fixed ramp does
      // nothing about.)
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
      // THE CURRENT PICKER VALUE, read rather than named, so this states "the
      // panel describes the category the map is showing" instead of restating
      // whatever the default happens to be this month (DEC-G3 changed it).
      const showing = await shared.locator("#category").inputValue();
      await expect(panel.locator(".panel-header strong")).toContainText(
        showing,
      );

      // A category change KEEPS the selection — "what does this same cell score
      // for the other category?" is the obvious next click, and clearing it
      // would make that question impossible to ask.
      //
      // AGAINST THE CURRENT VALUE, not a literal: see the sibling step above —
      // a "switch" to the already-selected category fires no `change` event and
      // this step would silently test nothing.
      const other = await shared.evaluate(() => {
        const select = document.getElementById("category");
        const values = [...(select?.querySelectorAll("option") ?? [])].map(
          (o) => o.value,
        );
        return values.find((v) => v !== select?.value) ?? "";
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
      // moves without selecting.
      //
      // THE PRECONDITION IS NOW ENFORCED BY CONSTRUCTION rather than asserted
      // after the fact. This step used to pin `{x: 60, y: 60}` and check that
      // nothing was under it, with a comment predicting that "a fixture whose
      // grid grows to cover this point fails loudly here". What actually moved
      // was not the fixture but the MAP: Leaflet holds the centre, so the
      // header growing ~7 px (J2's blocks) re-framed the view and slid a cell
      // under that pixel. The prediction was right about the failure mode and
      // wrong about the cause, which is why the fix is to stop naming a pixel:
      // `walkByMapClick` hit-tests candidates and throws if the map is wholly
      // covered — the same loud failure, without the standing coin-flip.
      await walkByMapClick(shared);
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

    // CLOSING DESELECTS, so the SAME region can be re-opened.
    // `details-panel.ts.md` states this invariant, and nothing had asserted it
    // for REGIONS — only for cells. It holds through a single dispatch:
    // `cellSelected(undefined)` clears the cell, the feature AND the region.
    //
    // This assertion was written believing it was reproducing a defect (that
    // closing left the region selected, making a second click dead). It was
    // not — the reducer already cleared it, and the "fix" was dead code,
    // reverted after review on #271. The assertion is kept because the
    // invariant genuinely lacked region coverage; only its motive was wrong.
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

    // WITH THE CELLS HIDDEN, which is the point rather than a convenience: a
    // slab lies directly under the grid and `resolvePick` prefers the finer
    // claim, so a region is reachable exactly where the grid is not.
    //
    // AND THE HIDING IS WAITED FOR — cheap insurance, not a fix for anything
    // observed. DEC-R7b-6 makes cells-off the default, so on this test's own
    // fresh page the `uncheck()` is a no-op and the click races nothing. The
    // wait costs one assertion and removes the test's dependence on that default
    // continuing to hold. (An earlier version of this comment justified the wait
    // by a cells-ON shared baseline; that baseline was reversed — the file now
    // captures the boot's own state — so the justification went with it.)
    await page.locator("#layer-cells").uncheck();
    await expect(page.locator("#map path.affordance-cell")).toHaveCount(0);

    // AND THE GROUND HIDDEN, which is the narrow case DEC-R11-21 left this
    // behaviour alive in. Stage 4 made a click on drawn ground ORDER THE AGENT,
    // and the ground outranks a region — because the slabs blanket the demo's
    // opening view, and with the old order the agent could never be ordered at
    // all. `building-view.ts` keeps a hidden ground plane out of the raycast
    // set, so with the "none" ground mode the slab genuinely is the thing under
    // the pointer and this route to `regionSelected` still exists.
    await page.locator("#ground-mode").selectOption("none");

    const canvas = page.locator("#scene canvas");
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("no canvas box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const panel = page.locator("#details");
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
    // "Show Quests" since 2026-08-19 (F4b). A UI STRING ONLY (DEC-U11): the
    // store, the worker protocol and every doc still say `geoEvent`, which is
    // why the selector below is unchanged and only the visible text moved.
    //
    // The label is also one of two CONSTANTS now (F4a) rather than the whole
    // description, so a test asserting it no longer proves a search ran -- what
    // proves that is the marker on the map and the toast, both asserted
    // elsewhere in this file.
    await expect(button).toHaveText(/Show Quests/);

    await button.click();

    // THE RESULT MOVED OFF THE BUTTON (F4a, 2026-08-19). It used to become the
    // description — which is exactly why it grew and shrank on every press —
    // and the outcome is now announced in the toast instead. So the terminal
    // state is asserted where it actually appears.
    //
    // Either outcome is a pass: a fixture with no qualifying ground genuinely
    // has no quest, and asserting "one was found" would make this test depend
    // on the fixture's heat rather than on the wiring.
    const toast = page.locator("#toast-root .toast");
    await expect(toast).toHaveText(/Quest at|No quest nearby/, {
      timeout: 30_000,
    });
    await expect(button).toBeEnabled();
    // AND THE BUTTON WENT BACK TO ITS CONSTANT, which is the half that would
    // otherwise go unasserted: a button still reading "Finding…" after the
    // search settled is the async-feedback defect, and a button that grew again
    // is the reported one.
    await expect(button).toHaveText(/Show Quests/);

    // And nothing failed. WATCHED ON THE TOAST, not the status line: errors
    // stopped being written to `#status` when the header's self-expanding rule
    // was retired (DEC-U10), so `geo-event failed` can never appear there and
    // this assertion held for a broken app too. Its sibling in
    // boot-and-shell.spec.js was repointed at the time; this one was missed.
    await expect(page.locator("#toast-root .toast")).not.toContainText(
      "geo-event failed",
    );

    // If it found one, it is on the map. The winner carries a class of its own
    // so this cannot pass on a candidate marker.
    const announced = (await toast.textContent()) ?? "";
    if (announced.includes("Quest at")) {
      // THE DISTANCE AND DIRECTION ARE THE POINT (F56), not decoration. The
      // winner is usually off-screen, so this string is the only feedback the
      // user gets; a label that lost them would look identical to a working
      // one on a map that happens to be showing nothing.
      // THE TILE COUNT IS GONE FROM THE SUCCESS PATH (F4e) and the distance
      // now lives in its own standing readout (F4a), so this asserts both
      // surfaces rather than one string:
      //
      // - the toast announces WHAT happened, once;
      // - the readout keeps saying WHERE, and re-reads as the user walks, which
      //   is F56's recorded win and the thing a constant label would otherwise
      //   have deleted.
      expect(announced).toMatch(
        /Quest at .+ · \d+(\.\d+)? (m|km) (N|NE|E|SE|S|SW|W|NW)$/,
      );
      expect(announced).not.toContain("searched");
      await expect(page.locator("#quest-readout")).toHaveText(
        /\d+(\.\d+)? (m|km) (N|NE|E|SE|S|SW|W|NW)/,
      );

      // VISIBLE, NOT MERELY PRESENT — AND THAT IS THE PAN'S TEST (F4c,
      // DEC-U12, 2026-08-19).
      //
      // This used to assert PRESENCE only, with a comment explaining that an
      // event tile is ~900 m across against a viewport showing a couple of
      // hundred metres, so the winner is very often outside it and Leaflet
      // renders an off-screen path as `d="M0 0"` — which reads as hidden.
      //
      // That reasoning was exactly what F56's label existed to compensate for,
      // and DEC-U12 removes the premise: the map now pans to the winner, so it
      // is ON SCREEN. Asserting visibility is therefore both stronger and the
      // only test the pan has — without it, deleting the `panTo` call leaves
      // the whole suite green.
      await expect(page.locator("#map .geo-winner")).not.toHaveCount(0);

      // THE WINNER IS AT THE VIEWPORT CENTRE, WHICH IS THE PAN (F4c, DEC-U12).
      //
      // `toBeVisible()` was tried first and is NOT a test of the pan: with the
      // `panTo` call deleted the seeded winner still happened to be on screen,
      // so the assertion passed against the mutant. Centring is the thing
      // `panTo` actually does, so it is the thing to assert.
      //
      // This also replaces an older comment claiming the winner is "very often
      // outside the viewport" and that asserting visibility would make the test
      // depend on where the candidate landed. That was true, and DEC-U12
      // removed the premise it rested on.
      const winnerBox = await page
        .locator("#map .geo-winner")
        .first()
        .boundingBox();
      const mapBox = await page.locator("#map").boundingBox();
      if (winnerBox === null || mapBox === null) throw new Error("no boxes");
      const offset = Math.hypot(
        winnerBox.x + winnerBox.width / 2 - (mapBox.x + mapBox.width / 2),
        winnerBox.y + winnerBox.height / 2 - (mapBox.y + mapBox.height / 2),
      );
      // 8 px, DERIVED: the settled offset measures 0.2 px, so this is 40x the
      // real value and still catches anything that moves the target off centre.
      //
      // IT USED TO BE 80, justified by a comment saying a marker's anchor is
      // its tip rather than its centre. That is false for THIS marker —
      // `map-view.ts` sets `iconAnchor: [QUEST_MARKER_PX / 2, ...]` and says
      // why — and the slack it bought hid a real defect for as long as it
      // existed: Leaflet's cached container size was ~122 px too tall, so
      // every `setView` landed its target 61 px below the visible centre. The
      // old bound passed at 61.2 locally and failed at 86.5 on CI, which is
      // the only reason anyone looked.
      //
      // So a wider bound here would not have been a tolerance — it would have
      // been the defect's hiding place. If this fails, suspect the map's size
      // cache (`map-view.ts` observes the container for exactly this) before
      // suspecting the number.
      expect(offset).toBeLessThan(8);
      await expect(page.locator("#map .geo-candidate")).not.toHaveCount(0);
    }
  });

  /**
   * WHY THIS TEST EXISTS (G1, DEC-G1). The reported complaint: pressing the
   * button a second time re-ran the identical search. "Identical" is exact
   * rather than approximate — the event is a pure function of tile and
   * quarter-hour — so within one 15-minute slot the second press could not
   * produce anything new, and it read as a broken button.
   *
   * INVERTED 2026-08-19 (F4f, DEC-U13). The two-press behaviour was itself the
   * fix for that complaint, and the owner then reported the two-step as the
   * problem: the choice should be visible on the FIRST press. The picker now
   * opens alongside the search rather than instead of it, so a second press no
   * longer means something different from the first — which removes the
   * original complaint by a different route.
   *
   * The unit tests cover the dialog's own behaviour. What only an e2e can show
   * is that one press does both.
   */
  test("opens a time picker on the FIRST press, and can clear the event", async ({
    page,
  }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const button = page.locator("#geo-event");
    const picker = page.locator("#geo-event-picker");
    await expect(picker).toBeHidden();

    await button.click();

    // THE PICKER IS ALREADY OPEN (F4f, DEC-U13) — that is the whole change.
    // It used to take a second press, which made the second press mean
    // something different from the first; the owner asked for the choice to be
    // visible immediately, so it opens alongside the search.
    await expect(picker).toBeVisible();

    // AND THE SEARCH RAN ANYWAY, which is the half that would otherwise go
    // unasserted: a picker that opened INSTEAD of searching would satisfy the
    // line above and break the common one-tap case.
    await expect(page.locator("#toast-root .toast")).toHaveText(
      /Quest at|No quest nearby/,
      { timeout: 30_000 },
    );
    // Pre-filled from the event on the map, so the common edit is "later", not
    // "type a whole date".
    await expect(page.locator("#geo-event-date")).not.toHaveValue("");
    await expect(page.locator("#geo-event-time")).not.toHaveValue("");

    // FAILS RATHER THAN SKIPS (owner decision 2026-08-17). This used to be
    // `test.skip(drawn === 0, "fixture yielded no event to clear")`, which read
    // like a data problem and is actually a CLOCK one: the geo-event is a pure
    // function of tile and quarter-hour, so whether this test executes at all
    // depended on which quarter-hour the suite happened to run in. Three runs of
    // the same commit reported 56, 56 and 54-passed-2-skipped — and every one of
    // them looked green. A test that cannot run is a defect, not a pass.
    const drawn = await page.locator("#map .geo-winner").count();
    expect(
      drawn,
      "no geo-event was drawn for the fixture tile in the CURRENT quarter-hour, " +
        "so this test cannot exercise clearing one. The event is a pure function " +
        "of tile and quarter-hour; the fix is to pin the clock or choose a " +
        "tile/instant known to yield one, not to skip. See " +
        "2026-08-17-0019-geo-event-e2e-wall-clock-skip-followup.md",
    ).toBeGreaterThan(0);

    await page.locator("#geo-event-clear").click();
    await expect(picker).toBeHidden();
    await expect(page.locator("#map .geo-winner")).toHaveCount(0);
    // THE READOUT is what is derived from that state now, so it is what goes
    // back with the markers (F4a). The button's label is a constant and would
    // read "Show Quests" whether or not the clear worked — asserting it here
    // would be an assertion that cannot fail.
    await expect(page.locator("#quest-readout")).toBeHidden();
  });

  /**
   * WHY THIS TEST EXISTS (G2, DEC-G2). The reported defect, end to end: after
   * switching category the previous category's event markers were still on the
   * map, over the new category's cells. Nothing removed them, because they went
   * from the worker straight into a Leaflet layer without passing through the
   * store — so no action and no control could reach them.
   *
   * It is an e2e rather than a unit test because the unit tests can only prove
   * the state is cleared; that the LAYER goes with it is a claim about the
   * subscriber in `main.ts`, which has no other coverage.
   */
  test("takes the markers down when the category changes", async ({ page }) => {
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const button = page.locator("#geo-event");
    await button.click();
    // The outcome is announced in the toast now, not on the button (F4a).
    await expect(page.locator("#toast-root .toast")).toHaveText(
      /Quest at|No quest nearby/,
      { timeout: 30_000 },
    );

    // Only meaningful if something was actually drawn — a fixture with no
    // qualifying ground has nothing to clear, and asserting on it would make
    // this pass for the wrong reason.
    //
    // FAILS RATHER THAN SKIPS, for the reason given at the sibling assertion
    // above: "nothing was drawn" is a wall-clock condition, and skipping on it
    // let this test silently stop covering anything in some quarter-hours while
    // the run still reported success.
    const drawn = await page.locator("#map .geo-winner").count();
    expect(
      drawn,
      "no geo-event was drawn for the fixture tile in the CURRENT quarter-hour, " +
        "so this test cannot exercise the markers coming down. See " +
        "2026-08-17-0019-geo-event-e2e-wall-clock-skip-followup.md",
    ).toBeGreaterThan(0);

    const other = await page.evaluate(() => {
      const select = document.getElementById("category");
      const values = [...(select?.querySelectorAll("option") ?? [])].map(
        (option) => option.value,
      );
      return values.find((value) => value !== select?.value) ?? "";
    });
    test.skip(other === "", "rule table declares only one category");
    await page.locator("#category").selectOption(other);

    await expect(page.locator("#map .geo-winner")).toHaveCount(0);
    await expect(page.locator("#map .geo-candidate")).toHaveCount(0);
    // THE READOUT is derived from that state now, so it is what must go back
    // with them (F4a) — a readout still naming a distance to a quest that is no
    // longer drawn is the same disagreement in a different pane. The button's
    // label is a constant and would read "Show Quests" either way, so asserting
    // it here would be an assertion that cannot fail.
    await expect(page.locator("#quest-readout")).toBeHidden();
  });
});

test.describe("the cell layer toggle", () => {
  test("hides 'below threshold' while the cell layer is off (DEC-U9)", async ({
    page,
  }) => {
    // WHY THIS TEST EXISTS, and it is not tidiness: the bug it catches shipped.
    //
    // DEC-U9 hides this checkbox while `cells` is off, because it has nothing
    // to be below the threshold OF. The first implementation painted it only
    // from the layers SUBSCRIBER — and `subscribe` fires on CHANGE, never on
    // registration. `cells` is off in DEFAULT_LAYERS, so the one state the
    // decision exists to cover was the one state never painted, and the
    // checkbox was visible on every fresh load.
    //
    // THE FIRST ASSERTION IS THE WHOLE POINT. A test that only toggled the
    // layer and back would have passed against the broken build, because every
    // path it exercised went through the subscriber.
    await stubNetwork(page);
    await page.goto(AT_FIXTURE);
    await waitForRefresh(page);

    const showBelow = page.locator("#show-below-label");
    await expect(showBelow).toBeHidden();

    await page.locator("#layer-cells").check();
    await expect(showBelow).toBeVisible();

    await page.locator("#layer-cells").uncheck();
    await expect(showBelow).toBeHidden();
  });

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
