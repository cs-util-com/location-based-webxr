/**
 * The AR scene's environment, and the one that must never be set.
 *
 * WHY THIS IS ITS OWN MILESTONE AND ITS OWN MODULE. `building-view.ts.md`
 * records what a wrong scene environment costs here: three.js routes any
 * `scene.environment` through its CubeUV path, a raw equirect `DataTexture`
 * makes it emit integer defines into float assignments, and **every
 * `MeshStandardMaterial` fragment shader fails to compile**. three.js does not
 * throw for that — it logs and silently does not draw the material. Buildings,
 * trees, plates and the ground all vanished for ten work items while the status
 * line still reported "21 volumes" and the whole suite stayed green, because
 * the one surviving material was the affordance grid's `MeshBasicMaterial`.
 *
 * So the assertions here are mostly about what is NOT done, which is unusual
 * and is the point: a test that only checked the lights would have passed
 * throughout that entire episode.
 *
 * @see ar-scene-environment.ts.md
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";

import {
  applyArEnvironment,
  AR_CAMERA_FAR_M,
  AR_CAMERA_NEAR_M,
  AR_FOG_NEAR_M,
} from "./ar-scene-environment.js";

/** A stand-in for the framework's scene: its own lights, no fog, a background. */
function frameworkScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  scene.add(new THREE.DirectionalLight(0xffffff, 0.8));
  return scene;
}

/** The framework's AR camera as `ar-scene-hierarchy.ts` builds it: 0.01 / 200. */
function frameworkCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(70, 1, 0.01, 200);
}

describe("entering AR", () => {
  it("clears the background, or it paints over the passthrough", () => {
    // The camera feed IS the background in AR. Anything in `scene.background`
    // is composited over it, which turns an AR view into an opaque 3D view.
    //
    // The framework's scene sets no background today, and `background` is a
    // Scene property so reparenting the demo's content cannot carry its sky
    // across — an earlier comment here said it could, which was wrong (r508
    // review). This is a cheap assertion that the framework keeps it null, not
    // a guard on a live path.
    const scene = frameworkScene();
    scene.background = new THREE.Color(0x87ceeb);

    applyArEnvironment(scene, frameworkCamera());

    expect(scene.background).toBeNull();
  });

  it("NEVER assigns scene.environment", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. An environment map is how the demo's
    // desktop view lights its `MeshStandardMaterial`s, so reaching for the same
    // thing here is the obvious move — and the last time this project did it,
    // every one of those materials silently stopped drawing.
    //
    // AR needs no environment map: the passthrough is the surround, and the
    // framework's own ambient and directional lights are what the materials
    // read. If a future change does want one it must be PMREM-processed, and
    // this assertion is where that decision gets made deliberately.
    const scene = frameworkScene();

    applyArEnvironment(scene, frameworkCamera());

    expect(scene.environment).toBeNull();
  });

  it("adds fog that ends at the camera's far plane", () => {
    // Without fog the city does not fade, it CLIPS — a hard pop-out at the far
    // plane against a real-world backdrop, which reads as broken rather than as
    // distant. The framework's AR scene sets no fog at all.
    const scene = frameworkScene();

    applyArEnvironment(scene, frameworkCamera());

    const fog = scene.fog as THREE.Fog | null;
    expect(fog).toBeInstanceOf(THREE.Fog);
    expect(fog?.near).toBe(AR_FOG_NEAR_M);
    expect(AR_FOG_NEAR_M).toBeLessThan(AR_CAMERA_FAR_M);
  });

  it("ends the fog exactly at the far plane, or it is a wall or wasted work", () => {
    // THE INVARIANT (plan §2.3: "AR mode needs its own fog matched to its own
    // far plane"). Both directions are defects:
    //
    //  - fog far < camera far — every building in the gap is transformed,
    //    rasterised and shaded to produce solid grey. Invisible, and paid for.
    //  - fog far > camera far — the fade never completes, so the clip is a
    //    visible hard edge again, which is the thing the fog exists to remove.
    //
    // ASSERTED ON THE FOG OBJECT, not between two constants. The first version
    // of this test compared `AR_FOG_FAR_M` to `AR_CAMERA_FAR_M` while the
    // former was DEFINED as the latter — it could not fail. This one fails if
    // anyone builds the fog from a literal, which is the realistic mistake.
    const scene = frameworkScene();
    const camera = frameworkCamera();

    applyArEnvironment(scene, camera);

    expect((scene.fog as THREE.Fog).far).toBe(camera.far);
    expect((scene.fog as THREE.Fog).far).toBe(AR_CAMERA_FAR_M);
  });

  it("widens the depth budget past the framework's 0.01 / 200", () => {
    // §2.3. Depth resolution goes as `d² / (near · 2^N)`, so the framework's
    // 0.01 near quantises to ~6 cm at 100 m and ~55 cm at 300 m — already poor
    // before this demo asks it to draw a city. And 200 m is SHORTER than the
    // content: the demo builds a 2.8 km mesh, so most of it would simply clip.
    const scene = frameworkScene();
    const camera = frameworkCamera();

    applyArEnvironment(scene, camera);

    expect(camera.near).toBe(AR_CAMERA_NEAR_M);
    expect(camera.far).toBe(AR_CAMERA_FAR_M);
    expect(AR_CAMERA_NEAR_M).toBeGreaterThan(0.01);
    expect(AR_CAMERA_FAR_M).toBeGreaterThan(200);
  });

  it("leaves the camera's projection matrix agreeing with its planes", () => {
    // NOT the delivery path, and an earlier version of this test claimed it was
    // (r508 review). Under WebXR the planes reach pixels through
    // `WebXRManager.updateCamera` → `session.updateRenderState`, and three then
    // OVERWRITES this camera's projection matrix from the XR view every frame
    // (`updateUserCamera`), so what `updateProjectionMatrix()` computes is
    // discarded the moment the session presents.
    //
    // It is still asserted, for the window before the first XR frame and for
    // any non-XR read — and because a camera whose `far` says 1000 while its
    // projection still clips at 200 is a trap for whoever debugs this next.
    const scene = frameworkScene();
    const camera = frameworkCamera();
    const before = camera.projectionMatrix.clone();

    applyArEnvironment(scene, camera);

    expect(camera.projectionMatrix.equals(before)).toBe(false);
  });

  it("matches the demo's ACES grading, which the framework's renderer lacks", () => {
    // THE LARGEST LOOK DELTA IN AR (r508 review). The framework sets no tone
    // mapping at all — `NoToneMapping` at exposure 1.0 — while every colour in
    // this demo was authored under ACES at 0.5. `building-view.ts` says tone
    // mapping "re-maps EVERY colour in the scene", so inheriting the
    // framework's default roughly doubles effective exposure and drops the
    // filmic shoulder: the emissive-boosted surfaces clip to white.
    const renderer = {
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 1,
    } as THREE.WebGLRenderer;

    applyArEnvironment(frameworkScene(), frameworkCamera(), renderer);

    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(0.5);
  });

  it("tolerates a missing renderer rather than failing the session", () => {
    // The asymmetry with the camera is deliberate: no camera means the city
    // clips at 200 m, no renderer means it merely looks over-exposed. Failing a
    // session over a look is the wrong trade, so this path must not throw.
    expect(() =>
      applyArEnvironment(frameworkScene(), frameworkCamera(), null),
    ).not.toThrow();
  });

  it("leaves the framework's own lights alone", () => {
    // AR uses the framework's lighting by decision (plan §2.8): its ambient 0.5
    // / directional 0.8 is tuned for content seen against a camera feed, where
    // the demo's 0.25 / 1.1 was tuned against its own sky. Re-lighting here
    // would fight the framework and leave the desktop view to be restored from
    // a second source of truth.
    //
    // INTENSITIES AND COLOURS, not just the child count (r508 review): counting
    // children cannot fail for the reason this test names, and would stay green
    // if a future edit dimmed every light to zero.
    const scene = frameworkScene();
    const before = scene.children.map((child) => ({
      intensity: (child as THREE.Light).intensity,
      colour: (child as THREE.Light).color.getHex(),
    }));

    applyArEnvironment(scene, frameworkCamera());

    expect(
      scene.children.map((child) => ({
        intensity: (child as THREE.Light).intensity,
        colour: (child as THREE.Light).color.getHex(),
      })),
    ).toEqual(before);
    expect(before).toHaveLength(2);
  });
});

describe("leaving AR", () => {
  it("restores EVERY property it touched, environment included", () => {
    // The undo has to be symmetric with the apply, and it was not: `environment`
    // was cleared and never put back (r508 review), in the one module whose
    // stated purpose is defending against an inherited environment map. The
    // asymmetry was invisible because the test that named this behaviour
    // asserted only `background` and `fog`.
    //
    // NOT because the framework's scene is shared — `initAR` builds a fresh one
    // per session. This is for a caller that passes a scene it does not own, and
    // because a half-undo is worse than no undo: it looks handled.
    const scene = frameworkScene();
    const background = new THREE.Color(0x123456);
    const environment = new THREE.Texture();
    scene.background = background;
    scene.environment = environment;

    const restore = applyArEnvironment(scene, frameworkCamera());
    restore();

    expect(scene.background).toBe(background);
    expect(scene.environment).toBe(environment);
    expect(scene.fog).toBeNull();
  });

  it("puts the renderer's grading back", () => {
    // Same rule as the scene: what was changed is changed back. The framework
    // documents `getRenderer()` as read-only-by-convention and asks consumers to
    // restore what they touch, so this is the demo holding up its end.
    const renderer = {
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 1,
    } as THREE.WebGLRenderer;

    applyArEnvironment(frameworkScene(), frameworkCamera(), renderer)();

    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
  });

  it("restores a scene that started with nothing set", () => {
    // The realistic case, since the framework's scene has no fog and no
    // background of its own. Restoring `undefined` where `null` belonged is the
    // kind of near-miss that leaves an object subtly different from before.
    const scene = frameworkScene();

    applyArEnvironment(scene, frameworkCamera())();

    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
    expect(scene.environment).toBeNull();
  });

  it("gives the camera its planes back, projection included", () => {
    // The projection half is the part worth pinning: restoring `near`/`far`
    // without rebuilding leaves a camera whose numbers and matrix disagree,
    // which is the same trap the apply path avoids.
    const scene = frameworkScene();
    const camera = frameworkCamera();
    const before = camera.projectionMatrix.clone();

    applyArEnvironment(scene, camera)();

    expect(camera.near).toBe(0.01);
    expect(camera.far).toBe(200);
    expect(camera.projectionMatrix.equals(before)).toBe(true);
  });

  it("is idempotent, so a double teardown cannot double-restore", () => {
    // `release()` runs on both exits and is guarded, but the restore closure is
    // handed out and could be called again by a future edit.
    const scene = frameworkScene();
    const background = new THREE.Color(0x123456);
    scene.background = background;

    const restore = applyArEnvironment(scene, frameworkCamera());
    restore();
    restore();

    expect(scene.background).toBe(background);
  });

  it("restores what was captured, not what is there at restore time", () => {
    // A second `applyArEnvironment` between apply and restore would otherwise
    // make the first closure restore the SECOND call's fog. Each closure owns
    // its own snapshot.
    const scene = frameworkScene();
    const captured = new THREE.Color(0x111111);
    scene.background = captured;

    const first = applyArEnvironment(scene, frameworkCamera());
    scene.background = new THREE.Color(0x222222);
    first();

    // Identity, not hex: it pins that the closure put BACK the object it took,
    // and it does not depend on how TypeScript happens to narrow `background`
    // after the intervening assignment.
    expect(scene.background).toBe(captured);
  });
});
