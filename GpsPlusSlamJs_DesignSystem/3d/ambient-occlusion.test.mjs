/**
 * The look-dev page's ambient occlusion pass (round-3 plan 2026-09-27-0532,
 * stream C; round-2 plan 2026-09-26-2055 M2e).
 *
 * Why this test matters: the page leans on two INTERNALS of three's
 * `GTAOPass` (`_overrideVisibility`, the hook that hides objects from its
 * normal/depth pass, and `_renderPass`, which draws the blend). Nothing
 * type-checks an underscore method, so a three upgrade that renames or
 * stops calling one would silently put the sky and the clouds back into
 * the AO's depth (or draw the blend nowhere), with no error. These tests
 * run the REAL `GTAOPass` of the three the page serves, against a
 * recording renderer, so such an upgrade fails here first.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  AO_DENOISE,
  AO_PARAMS,
  createAmbientOcclusion,
  hiddenFromAoNormals,
  withPageExclusions,
} from "./ambient-occlusion.js";

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
const { GTAOPass } = await import(
  pathToFileURL(
    join(THREE_ROOT, "examples", "jsm", "postprocessing", "GTAOPass.js"),
  ).href
);

/** The page's kinds of object, each named for the assertion messages. */
function pageLikeScene() {
  const scene = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const named = (object, name) => {
    object.name = name;
    scene.add(object);
    return object;
  };
  // The sky: a box drawn at depth 1 by its own vertex shader, depthWrite off.
  named(
    new THREE.Mesh(
      box,
      new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false }),
    ),
    "sky",
  );
  // The cloud sheet and slab: transparent, depthWrite off.
  named(
    new THREE.Mesh(
      box,
      new THREE.ShaderMaterial({ transparent: true, depthWrite: false }),
    ),
    "cloud",
  );
  named(new THREE.Mesh(box, new THREE.MeshStandardMaterial()), "building");
  // The water: opaque and depth-writing, so it OCCLUDES in the main pass
  // and must occlude in the AO's too.
  named(new THREE.Mesh(box, new THREE.MeshPhysicalMaterial()), "water");
  named(
    new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial(), 4),
    "dense",
  );
  named(new THREE.Sprite(new THREE.SpriteMaterial()), "sprite");
  named(new THREE.Line(box, new THREE.LineBasicMaterial()), "line");
  named(new THREE.Points(box, new THREE.PointsMaterial()), "points");
  const hiddenAlready = named(
    new THREE.Mesh(box, new THREE.ShaderMaterial({ depthWrite: false })),
    "hidden-already",
  );
  hiddenAlready.visible = false;
  return scene;
}

/** A renderer that records, per draw, the target and what was visible. */
function recordingRenderer() {
  let target = null;
  const draws = [];
  return {
    draws,
    autoClear: true,
    getClearColor: (c) => c.set(0x000000),
    getClearAlpha: () => 1,
    setClearColor() {},
    setClearAlpha() {},
    clear() {},
    setRenderTarget(t) {
      target = t;
    },
    render(scene) {
      const visible = [];
      scene.traverseVisible((o) => {
        if (o.name) visible.push(o.name);
      });
      draws.push({
        target,
        override: scene.isScene ? scene.overrideMaterial : null,
        material: scene.isScene ? null : scene.material,
        visible,
      });
    },
  };
}

const target = () => new THREE.WebGLRenderTarget(4, 4);

describe("hiddenFromAoNormals", () => {
  it("hides what does not write depth, what is transparent, and non-meshes that three draws", () => {
    const scene = pageLikeScene();
    const hidden = [];
    scene.traverse((o) => {
      if (o.name && hiddenFromAoNormals(o)) hidden.push(o.name);
    });
    assert.deepEqual(hidden.sort(), [
      "cloud",
      "hidden-already",
      "line",
      "points",
      "sky",
      "sprite",
    ]);
  });

  it("keeps a multi-material mesh while any of its materials is opaque", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshBasicMaterial({ transparent: true }),
      new THREE.MeshStandardMaterial(),
    ]);
    assert.equal(hiddenFromAoNormals(mesh), false);
    mesh.material[1].depthWrite = false;
    assert.equal(hiddenFromAoNormals(mesh), true);
  });

  it("never hides a group (its children decide for themselves)", () => {
    assert.equal(hiddenFromAoNormals(new THREE.Group()), false);
  });

  // THE RULE'S EDGES (review of fb79e7c0, finding 7), pinned so a change of
  // behaviour is a decision, not an accident; the sidecar explains each.
  it("edge (a): a transparent mesh that DOES write depth is still left out", () => {
    // The main pass has it in its depth; the AO then reads what is behind it.
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ transparent: true, depthWrite: true }),
    );
    assert.equal(hiddenFromAoNormals(mesh), true);
  });

  it("edge (b): hiding a left-out parent hides its opaque children with it", () => {
    // three's `visible` hides a whole subtree, so an opaque child of a sky
    // or cloud mesh would lose its AO. The page has no such child (the
    // framework's sky, sheet and slab meshes are never given children).
    const scene = new THREE.Scene();
    const parent = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    parent.name = "parent";
    const child = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    );
    child.name = "child";
    parent.add(child);
    scene.add(parent);
    assert.equal(hiddenFromAoNormals(child), false, "the child is opaque");
    const pass = new (withPageExclusions(GTAOPass))(
      scene,
      new THREE.PerspectiveCamera(),
    );
    const renderer = recordingRenderer();
    pass.render(renderer, target(), target());
    const normalPass = renderer.draws.find(
      (d) => d.override === pass.normalMaterial,
    );
    assert.deepEqual(normalPass.visible, [], "the child went with its parent");
  });
});

describe("withPageExclusions(GTAOPass), against three's real pass", () => {
  it("still finds the internals it relies on (a three upgrade fails here)", () => {
    for (const name of [
      "_overrideVisibility",
      "_restoreVisibility",
      "_renderPass",
    ]) {
      assert.equal(
        typeof GTAOPass.prototype[name],
        "function",
        `GTAOPass.prototype.${name}`,
      );
    }
  });

  it("draws the normal/depth pass without the sky, the clouds, sprites, lines or points, then restores them", () => {
    const PagePass = withPageExclusions(GTAOPass);
    const scene = pageLikeScene();
    const camera = new THREE.PerspectiveCamera();
    const pass = new PagePass(scene, camera, 4, 4);
    const renderer = recordingRenderer();
    pass.render(renderer, target(), target());
    const normalPass = renderer.draws.find(
      (d) => d.override === pass.normalMaterial,
    );
    assert.ok(normalPass, "the pass drew its normal/depth pass");
    assert.deepEqual(normalPass.visible.sort(), ["building", "dense", "water"]);
    const after = [];
    scene.traverseVisible((o) => {
      if (o.name) after.push(o.name);
    });
    assert.deepEqual(after.sort(), [
      "building",
      "cloud",
      "dense",
      "line",
      "points",
      "sky",
      "sprite",
      "water",
    ]);
  });

  it("falls back to three's own rule with the exclusions off (the smoke test's mutation)", () => {
    // Documents what the page's rule adds: three alone draws the sky, the
    // clouds and the sprite into the normal/depth pass.
    const PagePass = withPageExclusions(GTAOPass);
    const pass = new PagePass(pageLikeScene(), new THREE.PerspectiveCamera());
    pass.pageExclusions = false;
    const renderer = recordingRenderer();
    pass.render(renderer, target(), target());
    const normalPass = renderer.draws.find(
      (d) => d.override === pass.normalMaterial,
    );
    assert.deepEqual(normalPass.visible.sort(), [
      "building",
      "cloud",
      "dense",
      "sky",
      "sprite",
      "water",
    ]);
  });

  it("blends the AO in place onto the scene target, and never swaps", () => {
    // In place, because the composer's scene target is the multisampled one
    // only while an EVEN number of passes swap (lookdev.js applyTier). A
    // swapping AO pass made it a third and the scene would alternate between
    // the multisampled and the plain target, frame by frame.
    const PagePass = withPageExclusions(GTAOPass);
    const pass = new PagePass(pageLikeScene(), new THREE.PerspectiveCamera());
    assert.equal(pass.needsSwap, false);
    const renderer = recordingRenderer();
    const read = target();
    const write = target();
    pass.render(renderer, write, read);
    assert.equal(
      renderer.draws.some((d) => d.target === write),
      false,
      "nothing is drawn into the write buffer",
    );
    const last = renderer.draws.at(-1);
    assert.equal(last.target, read);
    assert.equal(last.material, pass.blendMaterial);
    assert.equal(
      pass.blendMaterial.uniforms.tDiffuse.value,
      pass.pdRenderTarget.texture,
      "the blend multiplies the DENOISED AO",
    );
  });

  it("fades the AO out with view depth, in the blend, from the pass's own depth", () => {
    // The hazed distance (the ridges at 2.5 km, the dense city beyond
    // 780 m) is where the AO was measured darkening flat facades and the
    // ground-ridge line by up to ~30 levels; metre-scale AO cannot be seen
    // there, so the blend fades it out (the record's sweep).
    const PagePass = withPageExclusions(GTAOPass);
    const pass = new PagePass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(55, 1, 0.5, 30000),
      4,
      4,
      undefined,
      { ...AO_PARAMS, fadeStartM: 111, fadeEndM: 222 },
    );
    const u = pass.blendMaterial.uniforms;
    assert.equal(u.fadeStart.value, 111);
    assert.equal(u.fadeEnd.value, 222);
    assert.equal(u.tDepth.value, pass.depthTexture);
    assert.match(pass.blendMaterial.fragmentShader, /smoothstep\(\s*fadeStart/);
    pass.updateGtaoMaterial({ fadeEndM: 333 });
    assert.equal(u.fadeEnd.value, 333);
    pass.render(recordingRenderer(), target(), target());
    assert.equal(
      u.cameraFar.value,
      30000,
      "the blend reads the camera's range",
    );
  });

  it("refuses to be the last pass (its blend multiplies the scene target, not the screen)", () => {
    // Drawn to the screen, the multiply would land on a canvas that never
    // received the scene: a silent wrong picture (review finding 9).
    const pass = new (withPageExclusions(GTAOPass))(
      pageLikeScene(),
      new THREE.PerspectiveCamera(),
    );
    pass.renderToScreen = true;
    assert.throws(
      () => pass.render(recordingRenderer(), target(), target()),
      /last pass/,
    );
  });

  it("takes the blend intensity as a parameter (0 draws no AO)", () => {
    const pass = new (withPageExclusions(GTAOPass))(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      4,
      4,
      undefined,
      { ...AO_PARAMS, intensity: 0 },
    );
    assert.equal(pass.blendIntensity, 0);
    pass.updateGtaoMaterial({ intensity: 0.5 });
    pass.render(recordingRenderer(), target(), target());
    assert.equal(pass.blendMaterial.uniforms.intensity.value, 0.5);
    assert.equal(AO_PARAMS.intensity, 1, "the page ships three's full blend");
  });

  it("disposes the materials three's own dispose leaves behind", () => {
    // three r185's GTAOPass.dispose frees neither its AO material nor its
    // blend material (review finding 8); the page rebuilds the pass on
    // every tier switch.
    const pass = new (withPageExclusions(GTAOPass))(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
    );
    const disposed = new Set();
    for (const name of ["gtaoMaterial", "blendMaterial", "normalMaterial"]) {
      pass[name].addEventListener("dispose", () => disposed.add(name));
    }
    pass.dispose();
    assert.deepEqual([...disposed].sort(), [
      "blendMaterial",
      "gtaoMaterial",
      "normalMaterial",
    ]);
  });

  it("sizes its targets by its resolution scale", () => {
    const PagePass = withPageExclusions(GTAOPass);
    const pass = new PagePass(new THREE.Scene(), new THREE.PerspectiveCamera());
    pass.resolutionScale = 0.5;
    pass.setSize(1280, 801);
    assert.deepEqual(
      [pass.gtaoRenderTarget.width, pass.gtaoRenderTarget.height],
      [640, 401],
    );
    assert.equal(pass.normalRenderTarget.width, 640);
  });

  it("takes the page's metre-scale parameters", () => {
    const PagePass = withPageExclusions(GTAOPass);
    const pass = new PagePass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      4,
      4,
      undefined,
      AO_PARAMS,
      AO_DENOISE,
    );
    const u = pass.gtaoMaterial.uniforms;
    assert.equal(u.radius.value, AO_PARAMS.radius);
    assert.equal(u.thickness.value, AO_PARAMS.thickness);
    assert.equal(pass.gtaoMaterial.defines.SAMPLES, AO_PARAMS.samples);
    assert.equal(pass.pdMaterial.uniforms.radius.value, AO_DENOISE.radius);
  });
});

describe("createAmbientOcclusion", () => {
  /** A composer with a RenderPass and two passes after it. */
  function fakeComposer() {
    return {
      passes: [{ isRenderPass: true }, { name: "clamp" }, { name: "output" }],
      insertPass(pass, index) {
        this.passes.splice(index, 0, pass);
      },
    };
  }
  const make = () =>
    createAmbientOcclusion({
      GTAOPass,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
    });

  it("builds nothing while it is off", () => {
    const ao = make();
    const composer = fakeComposer();
    ao.sync(composer, false);
    assert.equal(ao.pass, null);
    assert.equal(composer.passes.length, 3);
  });

  it("inserts one pass right after the scene's RenderPass when switched on, and keeps it", () => {
    const ao = make();
    const composer = fakeComposer();
    ao.sync(composer, true);
    const pass = ao.pass;
    assert.equal(composer.passes[1], pass);
    assert.equal(pass.enabled, true);
    ao.sync(composer, false);
    assert.equal(pass.enabled, false);
    ao.sync(composer, true);
    assert.equal(ao.pass, pass, "reused, not rebuilt");
    assert.equal(composer.passes.length, 4);
  });

  it("applies a configured parameter to the live pass and to a pass built later", () => {
    // The sweep sets parameters on a page where the pass may not exist yet
    // (phone tier); a value that reached only the live pass would be lost at
    // the next tier switch.
    const ao = make();
    ao.configure({ params: { radius: 7 }, denoise: { radius: 5 } });
    ao.sync(fakeComposer(), true);
    assert.equal(ao.pass.gtaoMaterial.uniforms.radius.value, 7);
    assert.equal(ao.pass.pdMaterial.uniforms.radius.value, 5);
    ao.configure({ params: { thickness: 9 } });
    assert.equal(ao.pass.gtaoMaterial.uniforms.thickness.value, 9);
    assert.equal(ao.pass.gtaoMaterial.uniforms.radius.value, 7);
  });

  it("re-sizes the live pass for a new resolution scale, and refuses a bad one", () => {
    const ao = make();
    ao.configure({ resolutionScale: 0.5 });
    ao.sync(fakeComposer(), true);
    assert.equal(ao.pass.resolutionScale, 0.5, "a scale set before the build");
    ao.pass.setSize(1000, 600);
    assert.equal(ao.pass.gtaoRenderTarget.width, 500);
    ao.configure({ resolutionScale: 1 });
    assert.equal(ao.pass.gtaoRenderTarget.width, 1000, "re-sized at once");
    assert.throws(() => ao.configure({ resolutionScale: 0 }), RangeError);
    assert.throws(() => ao.configure({ resolutionScale: 2 }), RangeError);
  });

  it("refuses on Oculus Browser, where the scene it multiplies is discarded", () => {
    // three invalidates a multisampled colour buffer after resolving it when
    // the user agent is Oculus Browser (WebGLTextures,
    // `supportsInvalidateFramebuffer`), so the in-place blend would multiply
    // undefined content there (review finding 3).
    const quest =
      "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.1 Chrome/126 VR Safari/537.36";
    const ao = createAmbientOcclusion({
      GTAOPass,
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(),
      userAgent: quest,
    });
    const composer = fakeComposer();
    ao.sync(composer, true);
    assert.equal(ao.pass, null);
    assert.equal(ao.active, false);
    assert.equal(composer.passes.length, 3);
    assert.match(ao.unsupported, /Oculus Browser/);
    assert.equal(make().unsupported, null, "any other browser draws it");
  });

  it("forgets its pass with the composer that held it (the phone tier has none)", () => {
    const ao = make();
    ao.sync(fakeComposer(), true);
    ao.sync(null, true);
    assert.equal(ao.pass, null);
    assert.equal(ao.active, false);
    const next = fakeComposer();
    ao.sync(next, true);
    assert.equal(next.passes[1], ao.pass);
    assert.equal(ao.active, true);
  });
});
