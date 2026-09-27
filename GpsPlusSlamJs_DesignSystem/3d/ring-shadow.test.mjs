/**
 * The ring shadow's light-loop chunk (round-2 plan 2026-09-26-2055, M2b).
 *
 * Why this test matters: the dense city's far buildings are shadowed by a
 * second, coarse map, which the sun samples outside its sharp central map.
 * That lives in a text replacement of three's `lights_fragment_begin`, so a
 * three upgrade that rewords the shadow line would silently leave the far
 * city unshadowed (the replacement would find nothing). It is tested against
 * the REAL chunk of the three the page serves, not a copy.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { withRingShadow } from "./ring-shadow.js";

const THREE_BUILD = join(
  import.meta.dirname,
  "..",
  "..",
  "GpsPlusSlamJs_AppFramework",
  "node_modules",
  "three",
  "build",
  "three.module.js",
);
const { ShaderChunk } = await import(pathToFileURL(THREE_BUILD).href);
const CHUNK = ShaderChunk.lights_fragment_begin;

describe("withRingShadow", () => {
  it("gives the sun (light 0) both maps, only while two shadows exist", () => {
    const out = withRingShadow(CHUNK);
    assert.match(out, /NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 0/);
    assert.match(out, /directionalShadowMap\[ 0 \]/);
    assert.match(out, /directionalShadowMap\[ 1 \]/);
  });

  it("chooses the near map by its WHOLE frustum, depth included", () => {
    // The first spike tested only x and y, which are lateral to the sun's
    // ray: at a 5° sun, ground 500 m out along the sun's azimuth is 44 m off
    // the ray, inside the near square, and read "lit" from beyond the near
    // map's depth (measured 2026-09-27: golden-hour coverage 0.64 against
    // 0.89).
    const out = withRingShadow(CHUNK);
    assert.match(out, /step\( 0\.0, nearCoord\.z \)/);
    assert.match(out, /step\( nearCoord\.z, 1\.0 \)/);
  });

  it("keeps three's own shadow line for every other case", () => {
    const out = withRingShadow(CHUNK);
    const line =
      "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]";
    assert.ok(CHUNK.includes(line), "three's chunk has the line");
    assert.ok(out.includes(line), "the fallback keeps it");
  });

  it("is idempotent", () => {
    const once = withRingShadow(CHUNK);
    assert.equal(withRingShadow(once), once);
  });

  it("refuses a chunk it does not recognise, rather than doing nothing", () => {
    assert.throws(
      () => withRingShadow("void main() {}"),
      /lights_fragment_begin/,
    );
  });
});
