/**
 * The look-dev page's god rays: radial screen-space light shafts from the
 * visible sky around the sun (round-3 look-dev programme, stream G).
 *
 * Why this test matters: the pass is judged by eye, so its geometry has to
 * be right before anyone looks. A sun projected with the wrong sign, a fade
 * that never reaches 0 behind the camera or below the horizon, or weights
 * whose total changes with the sample count would each put light where no
 * sun is, or make the sample-count sweep a brightness sweep. The pass
 * itself runs here against the REAL three the page serves and a recording
 * renderer: a pass that swaps buffers would move the composer's scene off
 * its multisampled target, and a composite that tests or writes depth
 * would corrupt the sky mask of the next frame.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  createGodRays,
  GOD_RAYS,
  godRaysFade,
  horizonFade,
  offscreenFade,
  rayWeights,
  stepDecay,
  sunClipPoint,
  validateGodRaysParams,
} from "./god-rays.js";

const THREE_ROOT = join(
  import.meta.dirname,
  "..",
  "..",
  "GpsPlusSlamJs_AppFramework",
  "node_modules",
  "three",
);
const THREE = await import(
  pathToFileURL(join(THREE_ROOT, "build", "three.module.js")).href
);
const { Pass, FullScreenQuad } = await import(
  pathToFileURL(
    join(THREE_ROOT, "examples", "jsm", "postprocessing", "Pass.js"),
  ).href
);

const DEG = Math.PI / 180;

/** A camera at the origin looking along -z, 55° vertical field, 16:10. */
function cameraLookingNorth() {
  const camera = new THREE.PerspectiveCamera(55, 1.6, 0.5, 30000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

const viewProjection = (camera) =>
  new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .toArray();

/** A unit direction at `elevation` degrees up and `right` degrees east of north. */
const direction = (elevationDeg, rightDeg = 0) => [
  Math.cos(elevationDeg * DEG) * Math.sin(rightDeg * DEG),
  Math.sin(elevationDeg * DEG),
  -Math.cos(elevationDeg * DEG) * Math.cos(rightDeg * DEG),
];

/** A seeded generator (the package has no fast-check). */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe("sunClipPoint", () => {
  it("puts a sun straight ahead at the centre, in front", () => {
    const p = sunClipPoint(viewProjection(cameraLookingNorth()), [0, 0, -1]);
    assert.ok(p.inFront);
    assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9);
  });

  it("agrees with three's own projection of a far point", () => {
    const camera = cameraLookingNorth();
    const vp = viewProjection(camera);
    for (const [e, r] of [
      [10, 0],
      [-5, 12],
      [20, -30],
      [3, 40],
    ]) {
      const d = direction(e, r);
      const p = sunClipPoint(vp, d);
      const far = new THREE.Vector3(...d).multiplyScalar(1e4).project(camera);
      assert.ok(Math.abs(p.x - far.x) < 1e-6, `x at ${e}/${r}`);
      assert.ok(Math.abs(p.y - far.y) < 1e-6, `y at ${e}/${r}`);
      assert.ok(p.inFront);
    }
  });

  it("does not depend on the camera's position (the sun is at infinity)", () => {
    const camera = cameraLookingNorth();
    const a = sunClipPoint(viewProjection(camera), direction(10, 5));
    camera.position.set(500, 2000, -900);
    camera.updateMatrixWorld();
    const b = sunClipPoint(viewProjection(camera), direction(10, 5));
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);
  });

  it("says a sun behind the camera is not in front", () => {
    const vp = viewProjection(cameraLookingNorth());
    assert.equal(sunClipPoint(vp, [0, 0, 1]).inFront, false);
    assert.equal(sunClipPoint(vp, direction(10, 150)).inFront, false);
    // Exactly sideways: w is 0, not in front.
    assert.equal(sunClipPoint(vp, [1, 0, 0]).inFront, false);
  });

  it("normalises the direction and refuses a non-finite or zero one", () => {
    const vp = viewProjection(cameraLookingNorth());
    const a = sunClipPoint(vp, direction(10, 5));
    const b = sunClipPoint(
      vp,
      direction(10, 5).map((c) => c * 7),
    );
    assert.ok(Math.abs(a.x - b.x) < 1e-12);
    assert.throws(() => sunClipPoint(vp, [0, 0, 0]), RangeError);
    assert.throws(() => sunClipPoint(vp, [Number.NaN, 0, 1]), RangeError);
    assert.throws(() => sunClipPoint([1, 2, 3], [0, 0, 1]), RangeError);
  });
});

describe("offscreenFade", () => {
  it("is 1 on screen, 0 past the margin, and falls in between", () => {
    assert.equal(offscreenFade(0, 0, 0.3), 1);
    assert.equal(offscreenFade(1, -1, 0.3), 1);
    assert.equal(offscreenFade(1.3, 0, 0.3), 0);
    assert.equal(offscreenFade(0, -2, 0.3), 0);
    const mid = offscreenFade(1.15, 0, 0.3);
    assert.ok(mid > 0 && mid < 1);
  });

  it("never rises as the sun moves further off screen (seeded)", () => {
    const random = seeded(11);
    for (let t = 0; t < 500; t++) {
      const x = 4 * random() - 2;
      const y = 4 * random() - 2;
      const k = 1 + random();
      const a = offscreenFade(x, y, 0.3);
      const b = offscreenFade(x * k, y * k, 0.3);
      assert.ok(a >= 0 && a <= 1);
      assert.ok(b <= a + 1e-12, `${x},${y} x${k}`);
    }
  });
});

describe("horizonFade", () => {
  it("is 0 at or below the low end, 1 at or above the high end", () => {
    const [lo, hi] = GOD_RAYS.horizonFadeDeg;
    assert.equal(horizonFade(Math.sin((lo - 0.1) * DEG)), 0);
    assert.equal(horizonFade(Math.sin(lo * DEG)), 0);
    assert.equal(horizonFade(Math.sin(hi * DEG)), 1);
    assert.equal(horizonFade(Math.sin(58 * DEG)), 1);
    const mid = horizonFade(Math.sin(((lo + hi) / 2) * DEG));
    assert.ok(Math.abs(mid - 0.5) < 1e-9);
  });

  it("rises monotonically with the sun (seeded)", () => {
    const random = seeded(5);
    for (let t = 0; t < 300; t++) {
      const a = -10 + 20 * random();
      const b = a + 3 * random();
      assert.ok(
        horizonFade(Math.sin(b * DEG)) >= horizonFade(Math.sin(a * DEG)),
      );
    }
  });
});

describe("godRaysFade", () => {
  const vp = viewProjection(cameraLookingNorth());

  it("is the product of the on-screen and horizon fades for a sun ahead", () => {
    const f = godRaysFade(vp, direction(10, 0));
    assert.equal(f.fade, 1);
    assert.ok(f.x === 0 || Math.abs(f.x) < 1e-9);
    assert.ok(f.y > 0);
  });

  it("is 0 for a sun behind the camera, whatever its NDC point reads", () => {
    assert.equal(godRaysFade(vp, direction(10, 180)).fade, 0);
    assert.equal(godRaysFade(vp, direction(0.5, 100)).fade, 0);
  });

  it("is 0 for a sun below the horizon, even straight ahead", () => {
    // blue hour: -4°, in front of a camera looking slightly down
    const camera = cameraLookingNorth();
    camera.lookAt(0, -0.07, -1);
    camera.updateMatrixWorld();
    const f = godRaysFade(viewProjection(camera), direction(-4, 0));
    assert.equal(
      sunClipPoint(viewProjection(camera), direction(-4)).inFront,
      true,
    );
    assert.equal(f.fade, 0);
  });

  it("is 0 far off screen and 1 on it (seeded suns in front)", () => {
    const random = seeded(3);
    for (let t = 0; t < 300; t++) {
      const d = direction(2 + 60 * random(), -80 + 160 * random());
      const f = godRaysFade(vp, d);
      const p = sunClipPoint(vp, d);
      if (Math.max(Math.abs(p.x), Math.abs(p.y)) <= 1) assert.equal(f.fade, 1);
      if (
        Math.max(Math.abs(p.x), Math.abs(p.y)) >=
        1 + GOD_RAYS.offscreenMargin
      )
        assert.equal(f.fade, 0);
      assert.ok(f.fade >= 0 && f.fade <= 1);
    }
  });
});

describe("rayWeights and stepDecay", () => {
  it("are normalised, geometric and end at endWeight × the first", () => {
    for (const n of [2, 16, 32, 64]) {
      for (const end of [0.1, 0.5, 1]) {
        const w = rayWeights(n, end);
        assert.equal(w.length, n);
        const total = w.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(total - 1) < 1e-12);
        assert.ok(Math.abs(w[n - 1] / w[0] - end) < 1e-9);
        const k = stepDecay(n, end);
        for (let i = 1; i < n; i++) {
          assert.ok(Math.abs(w[i] / w[i - 1] - k) < 1e-9);
        }
      }
    }
    assert.deepEqual(rayWeights(1, 0.3), [1]);
    assert.equal(stepDecay(1, 0.3), 1);
  });

  // The sweep's premise: the sample count changes the rays' grain, not
  // their brightness or where along the ray the light comes from.
  it("keep the ray's shape when the sample count changes (seeded)", () => {
    const random = seeded(9);
    for (let t = 0; t < 100; t++) {
      const end = 0.05 + 0.95 * random();
      const firstHalf = (n) =>
        rayWeights(n, end)
          .slice(0, n / 2)
          .reduce((a, b) => a + b, 0);
      const ref = firstHalf(256);
      for (const n of [16, 32, 64]) {
        assert.ok(Math.abs(firstHalf(n) - ref) < 0.04, `n ${n} end ${end}`);
      }
    }
  });

  it("refuse counts and end weights outside their ranges", () => {
    for (const [n, end] of [
      [0, 0.5],
      [2.5, 0.5],
      [257, 0.5],
      [16, 0],
      [16, 1.5],
      [16, Number.NaN],
    ]) {
      assert.throws(() => rayWeights(n, end), RangeError, `${n} ${end}`);
      assert.throws(() => stepDecay(n, end), RangeError, `${n} ${end}`);
    }
  });
});

describe("validateGodRaysParams", () => {
  it("accepts the shipped values and refuses bad ones", () => {
    assert.doesNotThrow(() => validateGodRaysParams(GOD_RAYS));
    for (const bad of [
      { samples: 0 },
      { endWeight: 0 },
      { reach: 1.5 },
      { reach: 0 },
      { strength: -1 },
      { threshold: Number.NaN },
      { maxExcess: 0 },
      { radius: 0 },
      { scale: 0 },
      { scale: 1.5 },
      { offscreenMargin: -0.1 },
      { airM: -1 },
      { jitter: 2 },
    ]) {
      assert.throws(
        () => validateGodRaysParams({ ...GOD_RAYS, ...bad }),
        RangeError,
        JSON.stringify(bad),
      );
    }
  });
});

/** A renderer that records each draw's target and material. */
function recordingRenderer() {
  let target = null;
  const draws = [];
  const r = {
    draws,
    autoClear: true,
    autoClearDuringDraws: [],
    setRenderTarget(t) {
      target = t;
    },
    getRenderTarget: () => target,
    clear() {},
    render(mesh) {
      r.autoClearDuringDraws.push(r.autoClear);
      draws.push({ target, material: mesh.material });
    },
  };
  return r;
}

/**
 * A stand-in for the page's composer: RenderPass, clamp, OutputPass, with
 * three's flags (a Pass is enabled and swaps unless it says otherwise; the
 * RenderPass does not swap).
 */
function composerLike() {
  const renderTarget1 = new THREE.WebGLRenderTarget(8, 8);
  const renderTarget2 = renderTarget1.clone();
  const passes = [
    { name: "render", isRenderPass: true, enabled: true, needsSwap: false },
    { name: "clamp", enabled: true, needsSwap: true },
    { name: "output", isOutputPass: true, enabled: true, needsSwap: true },
  ];
  return {
    passes,
    renderTarget1,
    renderTarget2,
    insertPass(pass, index) {
      passes.splice(index, 0, pass);
    },
  };
}

function godRaysFor(sun) {
  const camera = cameraLookingNorth();
  return createGodRays({
    THREE,
    Pass,
    FullScreenQuad,
    camera,
    sunDirection: () => sun,
  });
}

describe("createGodRays", () => {
  it("inserts one non-swapping pass before the output, and gives the scene target a depth texture", () => {
    const rays = godRaysFor(direction(10));
    const composer = composerLike();
    assert.equal(composer.renderTarget2.depthTexture, null);
    rays.sync(composer, true);
    assert.deepEqual(
      composer.passes.map((p) => p.name ?? "god-rays"),
      ["render", "clamp", "god-rays", "output"],
    );
    assert.equal(rays.pass.needsSwap, false);
    assert.ok(composer.renderTarget2.depthTexture?.isDepthTexture);
    assert.equal(rays.active, true);
    // Off keeps the pass (disabled), on again reuses it.
    const pass = rays.pass;
    rays.sync(composer, false);
    assert.equal(rays.active, false);
    rays.sync(composer, true);
    assert.equal(rays.pass, pass);
    assert.equal(composer.passes.length, 4);
  });

  it("builds nothing while off, and drops the pass with its composer", () => {
    const rays = godRaysFor(direction(10));
    const composer = composerLike();
    rays.sync(composer, false);
    assert.equal(rays.pass, null);
    assert.equal(composer.passes.length, 3);
    assert.equal(composer.renderTarget2.depthTexture, null);
    rays.sync(composer, true);
    rays.sync(null, true);
    assert.equal(rays.pass, null);
    assert.equal(rays.active, false);
  });

  // Review 2026-09-29 A1: the mask reads the depth of renderTarget2, where
  // the RenderPass draws only while the composer's enabled passes swap an
  // EVEN number of times a frame (three keeps its read/write buffers from
  // one frame to the next). A third swapping pass would make every other
  // frame read a cleared depth (every pixel sky, a flicker) with no error
  // and no smoke that sees it, so switching the rays on refuses it.
  it("refuses to run under a composer whose enabled passes swap an odd number of times", () => {
    const rays = godRaysFor(direction(10));
    const composer = composerLike();
    const extra = { name: "extra", enabled: true, needsSwap: true };
    composer.insertPass(extra, 2);
    assert.throws(() => rays.sync(composer, true), /swap/);
    assert.equal(rays.active, false);
    // Off asks nothing of the composer.
    assert.doesNotThrow(() => rays.sync(composer, false));
    // A disabled swapping pass does not swap: the count is even again.
    extra.enabled = false;
    assert.doesNotThrow(() => rays.sync(composer, true));
    assert.equal(rays.active, true);
    // A later odd count is refused at the next sync that keeps them on.
    extra.enabled = true;
    assert.throws(() => rays.sync(composer, true), /swap/);
  });

  it("draws mask, rays and an additive composite into the read buffer, and restores autoClear", () => {
    const rays = godRaysFor(direction(10));
    const composer = composerLike();
    rays.sync(composer, true);
    rays.pass.setSize(160, 100);
    const renderer = recordingRenderer();
    const read = composer.renderTarget1;
    rays.pass.render(renderer, composer.renderTarget2, read, 0, false);
    assert.equal(renderer.draws.length, 3);
    const [mask, blur, composite] = renderer.draws;
    assert.equal(mask.target, rays.pass.maskTarget);
    assert.equal(blur.target, rays.pass.raysTarget);
    assert.equal(composite.target, read);
    assert.ok(renderer.autoClearDuringDraws.slice(2).every((a) => a === false));
    assert.equal(renderer.autoClear, true);
    // The mask reads the scene and the scene target's depth; nothing the
    // pass draws tests or writes depth.
    assert.equal(mask.material.uniforms.tScene.value, read.texture);
    assert.equal(
      mask.material.uniforms.tDepth.value,
      composer.renderTarget2.depthTexture,
    );
    // The composite scales the rays by the air in front of each surface,
    // read from the same depth.
    assert.equal(
      composite.material.uniforms.tDepth.value,
      composer.renderTarget2.depthTexture,
    );
    for (const d of renderer.draws) {
      assert.equal(d.material.depthTest, false);
      assert.equal(d.material.depthWrite, false);
    }
    assert.equal(composite.material.blending, THREE.CustomBlending);
    assert.equal(composite.material.blendSrc, THREE.OneFactor);
    assert.equal(composite.material.blendDst, THREE.OneFactor);
    // The alpha channel is kept.
    assert.equal(composite.material.blendSrcAlpha, THREE.ZeroFactor);
    assert.equal(composite.material.blendDstAlpha, THREE.OneFactor);
    // The low-resolution buffers follow the scale.
    assert.equal(rays.pass.maskTarget.width, Math.round(160 * GOD_RAYS.scale));
    assert.equal(rays.info().fade, 1);
  });

  it("draws nothing when the sun is behind the camera or below the horizon", () => {
    for (const sun of [direction(10, 180), direction(-4, 0)]) {
      const rays = godRaysFor(sun);
      const composer = composerLike();
      rays.sync(composer, true);
      rays.pass.setSize(160, 100);
      const renderer = recordingRenderer();
      rays.pass.render(
        renderer,
        composer.renderTarget2,
        composer.renderTarget1,
        0,
        false,
      );
      assert.equal(renderer.draws.length, 0);
      assert.equal(rays.info().fade, 0);
    }
  });

  it("cannot be the composer's last pass", () => {
    const rays = godRaysFor(direction(10));
    rays.sync(composerLike(), true);
    rays.pass.renderToScreen = true;
    assert.throws(() =>
      rays.pass.render(recordingRenderer(), null, null, 0, false),
    );
  });

  it("configures the live pass and any later one, and refuses bad values", () => {
    const rays = godRaysFor(direction(10));
    const merged = rays.configure({ samples: 16, strength: 2 });
    assert.equal(merged.samples, 16);
    assert.equal(merged.threshold, GOD_RAYS.threshold);
    rays.sync(composerLike(), true);
    assert.equal(rays.pass.blurMaterial.defines.RAY_SAMPLES, 16);
    rays.configure({ samples: 64, endWeight: 0.5 });
    assert.equal(rays.pass.blurMaterial.defines.RAY_SAMPLES, 64);
    assert.ok(
      Math.abs(
        rays.pass.blurMaterial.uniforms.uDecay.value - stepDecay(64, 0.5),
      ) < 1e-12,
    );
    assert.throws(() => rays.configure({ samples: 0 }), RangeError);
    assert.equal(
      rays.configure().samples,
      64,
      "a refused value changes nothing",
    );
  });
});
