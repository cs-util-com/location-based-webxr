import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  BUILDINGS,
  PALETTES,
  allShots,
  fixtureUrl,
  parseParams,
  searchFor,
  todayShotUrl,
} from "./building-geometry-model.js";

// Why this test matters: the "today" half of the page is only honest when
// every camera has its picture; a camera added without one would show the
// live render next to nothing.
test("every building and camera has a committed today picture", () => {
  for (const { id, view } of allShots()) {
    const url = todayShotUrl(id, view);
    assert.ok(url, `${id}/${view} has no today picture`);
    assert.ok(existsSync(fileURLToPath(url)), `${url} is missing`);
  }
});

// Why this test matters: a stale or hand-edited link must still open a
// picture rather than an error.
test("an unknown building or camera falls back to the first one", () => {
  const first = BUILDINGS[0];
  assert.equal(parseParams("?building=nowhere").building, first);
  const { building, view } = parseParams("?building=cologne&view=nope");
  assert.equal(building.id, "cologne");
  assert.equal(view, Object.keys(building.views)[0]);
});

test("searchFor is the inverse of parseParams", () => {
  for (const { id, view } of allShots()) {
    const state = parseParams(searchFor(id, view));
    assert.equal(state.building.id, id);
    assert.equal(state.view, view);
  }
});

// Why this test matters: the deploy copies only what a literal URL names, so
// every building must map to one.
test("every building has a fixture URL, and an unknown one throws", () => {
  for (const { id } of BUILDINGS) {
    assert.match(fixtureUrl(id).pathname, /\/osm-lib\/testdata\/.+\.json$/);
  }
  assert.throws(() => fixtureUrl("nowhere"), TypeError);
});

// Why this test matters (M7 review MINOR 3): the colour toggle is the only
// place `palette: "class"` is used, the before-and-after of the seeded
// palette; a link that dropped it, or an unknown value that reached
// `buildCity` (which throws on it), would make the comparison silently
// impossible.
test("the colour toggle round-trips, defaults to the seeded palette", () => {
  assert.equal(parseParams("").palette, "seeded");
  assert.equal(parseParams("?palette=loud").palette, "seeded");
  assert.equal(parseParams("?palette=class").palette, "class");
  for (const palette of PALETTES) {
    const state = parseParams(searchFor("cologne", "plate", palette));
    assert.equal(state.palette, palette);
    assert.equal(state.view, "plate");
  }
  // The default stays out of the link, so the old links are the new ones.
  assert.equal(
    searchFor("cologne", "plate", "seeded"),
    searchFor("cologne", "plate"),
  );
});

// Why this test matters: the roofs toggle is the before-and-after of the
// library's invented roofs on one building at one camera. Invented roofs
// are the library's default, so "on" stays out of the link; only roofs=off
// turns them off, and the toggle must survive every other link on the page.
test("the roofs toggle round-trips, defaults to invented roofs", () => {
  assert.equal(parseParams("").roofs, true);
  assert.equal(parseParams("?roofs=off").roofs, false);
  assert.equal(parseParams("?roofs=no").roofs, true);
  assert.doesNotMatch(searchFor("heidelberg", "spire"), /roofs=/);
  for (const roofs of [true, false]) {
    for (const palette of PALETTES) {
      const state = parseParams(searchFor("ulm", "street", palette, roofs));
      assert.equal(state.roofs, roofs);
      assert.equal(state.palette, palette);
      assert.equal(state.view, "street");
    }
  }
});
