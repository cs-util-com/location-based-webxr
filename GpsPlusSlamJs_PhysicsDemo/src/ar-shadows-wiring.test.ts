/**
 * Tests for the demo's AR shadows wiring (W4 AR shadows plan
 * 2026-09-26-0549, M3).
 *
 * Why this test matters: the framework proves the receiver, the rig and the
 * pixels (its unit tests and the look-dev pixel page); what only the demo
 * can get wrong is the WIRING. Four things, each a real failure mode:
 * - the frame: the light must ride `arWorldGroup` with the room and the
 *   balls, or an alignment/heading update swings every shadow (plan §11);
 * - the occluder: `setMeshMode` recreates it, so the receiver must follow
 *   the CURRENT one, not the first;
 * - the casters: the map must re-render while balls fly and stop after;
 * - the teardown: the framework's light goes back where it was found.
 * Real three objects and the real framework modules; the renderer is a stub
 * carrying only the shadow-map state the rule reads.
 */

import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { SCENE_NODE } from "gps-plus-slam-app-framework/ar/scene-node-names";
import { OcclusionMesh } from "gps-plus-slam-app-framework/visualization/occlusion-mesh";
import {
  FLOOR_BELOW_CAMERA_M,
  bindShadowSwitch,
  shadowsLabel,
  shadowsEnabledFromSearch,
  startDemoShadows,
  type DemoShadowsDeps,
} from "./ar-shadows-wiring";

const RECEIVER = "occupancy-occluder-shadow-receiver";

/** The framework's AR scene as `createSceneHierarchy` builds it. */
function makeScene() {
  const scene = new THREE.Scene();
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.name = SCENE_NODE.SUN_LIGHT;
  light.position.set(0, 10, 5);
  scene.add(light);
  const arWorldGroup = new THREE.Group();
  scene.add(arWorldGroup);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(1, 1.6, -2);
  scene.add(camera);
  const renderer = {
    shadowMap: {
      enabled: false,
      type: THREE.BasicShadowMap as THREE.ShadowMapType,
    },
  };
  return { scene, light, arWorldGroup, camera, renderer };
}

/** An occluder with one triangle, so the receiver has geometry to use. */
function makeOccluder(parent: THREE.Object3D): OcclusionMesh {
  const occluder = new OcclusionMesh(parent);
  occluder.applyMeshData(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    new Uint32Array([0, 1, 2]),
  );
  return occluder;
}

function deps(
  s: ReturnType<typeof makeScene>,
  occluder: { current: OcclusionMesh | null },
  balls: { count: number },
): DemoShadowsDeps {
  return {
    renderer: s.renderer as unknown as THREE.WebGLRenderer,
    scene: s.scene,
    arWorldGroup: s.arWorldGroup,
    getOccluder: () => occluder.current,
    ballCount: () => balls.count,
    getCamera: () => s.camera,
  };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

describe("startDemoShadows", () => {
  it("turns the shadow map on and gives the occluder its receiver", () => {
    const s = makeScene();
    const occluder = { current: makeOccluder(s.arWorldGroup) };
    const shadows = startDemoShadows(deps(s, occluder, { count: 0 }));
    disposers.push(() => shadows.dispose());
    shadows.update();
    expect(s.renderer.shadowMap.enabled).toBe(true);
    expect(s.renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(shadows.isActive()).toBe(true);
    expect(s.arWorldGroup.getObjectByName(RECEIVER)).toBeDefined();
  });

  // The status line's shadow diagnostics (first-visit report on r753):
  // whether the light casts, its map size and allocation, and the rig's
  // map renders; the inert handle answers too.
  it("reports the light's shadow state for the status line", () => {
    const s = makeScene();
    const occluder = { current: makeOccluder(s.arWorldGroup) };
    const shadows = startDemoShadows(deps(s, occluder, { count: 0 }));
    disposers.push(() => shadows.dispose());
    shadows.update();
    expect(shadows.diagnostics()).toEqual({
      cast: true,
      mapSize: s.light.shadow.mapSize.x,
      mapAllocated: false, // three allocates it on the first render
      mapRenders: 1,
    });
    const bare = makeScene();
    bare.scene.remove(bare.light);
    const inert = startDemoShadows(deps(bare, { current: null }, { count: 0 }));
    expect(inert.diagnostics()).toEqual({
      cast: false,
      mapSize: 0,
      mapAllocated: false,
      mapRenders: 0,
    });
  });

  // The status line's "in shadow range" (M1 review): a ball thrown farther
  // than the shadow's reach casts nothing, whatever "shadows on" says. The
  // reach is a circle of the square's half width around the viewer's spot.
  it("says whether a ball lies within the shadow's reach of the viewer", () => {
    const s = makeScene();
    const shadows = startDemoShadows(deps(s, { current: null }, { count: 1 }));
    disposers.push(() => shadows.dispose());
    shadows.update();
    // The viewer stands at (1, 1.6, -2); the reach is 5 m.
    expect(shadows.inRange(new THREE.Vector3(3, 0, 1))).toBe(true);
    expect(shadows.inRange(new THREE.Vector3(1, 0, 4))).toBe(false);
  });

  // The owner's switch (round-2 plan M1): off and on again by the shadow's
  // intensity only, never castShadow or the shadow map, so no material
  // recompiles mid-session; the stats line's "shadows on" follows it.
  it("switches the shadow off and on by intensity, with no recompile", () => {
    const s = makeScene();
    const occluder = { current: makeOccluder(s.arWorldGroup) };
    const shadows = startDemoShadows(deps(s, occluder, { count: 0 }));
    disposers.push(() => shadows.dispose());
    shadows.update();
    const intensity = s.light.shadow.intensity;
    expect(intensity).toBeGreaterThan(0);
    shadows.setEnabled(false);
    shadows.update();
    expect(s.light.shadow.intensity).toBe(0);
    expect(s.light.castShadow).toBe(true);
    expect(s.renderer.shadowMap.enabled).toBe(true);
    expect(shadows.isActive()).toBe(false);
    expect(shadows.isEnabled()).toBe(false);
    expect(shadowsLabel(shadows)).toBe(" · shadows off");
    shadows.setEnabled(true);
    expect(shadows.isEnabled()).toBe(true);
    shadows.update();
    expect(s.light.shadow.intensity).toBe(intensity);
    expect(shadows.isActive()).toBe(true);
  });

  // The frame claim (plan §11): the light and its target move under
  // arWorldGroup, keeping the world direction they had; a later rotation of
  // arWorldGroup (a heading correction) turns the light WITH the room.
  it("fixes the light to the room: it turns with arWorldGroup", () => {
    const s = makeScene();
    const before = s.light.position.clone().normalize();
    const shadows = startDemoShadows(deps(s, { current: null }, { count: 0 }));
    disposers.push(() => shadows.dispose());
    expect(s.light.parent).toBe(s.arWorldGroup);
    expect(s.light.target.parent).toBe(s.arWorldGroup);
    shadows.update();
    const worldDir = (): THREE.Vector3 => {
      s.scene.updateMatrixWorld(true);
      const p = s.light.getWorldPosition(new THREE.Vector3());
      const t = s.light.target.getWorldPosition(new THREE.Vector3());
      return p.sub(t).normalize();
    };
    expect(worldDir().distanceTo(before)).toBeLessThan(1e-9);
    s.arWorldGroup.rotation.y = Math.PI / 2;
    const turned = before
      .clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    expect(worldDir().distanceTo(turned)).toBeLessThan(1e-9);
  });

  it("centres the shadow square under the camera, in the room's frame", () => {
    const s = makeScene();
    s.arWorldGroup.position.set(10, 0, 0);
    s.arWorldGroup.rotation.y = 0.7;
    const shadows = startDemoShadows(deps(s, { current: null }, { count: 0 }));
    disposers.push(() => shadows.dispose());
    s.scene.updateMatrixWorld(true);
    shadows.update();
    const expected = s.arWorldGroup.worldToLocal(
      s.camera.getWorldPosition(new THREE.Vector3()),
    );
    expected.y -= FLOOR_BELOW_CAMERA_M;
    // The rig aims the light at the square's centre.
    expect(s.light.target.position.distanceTo(expected)).toBeLessThan(1e-6);
  });

  // setMeshMode disposes the occluder and builds a new one: the receiver
  // must move to whichever occluder is current at the next frame.
  it("follows the occluder the view recreates", () => {
    const s = makeScene();
    const occluder = { current: makeOccluder(s.arWorldGroup) };
    const shadows = startDemoShadows(deps(s, occluder, { count: 0 }));
    disposers.push(() => shadows.dispose());
    shadows.update();
    occluder.current.dispose();
    occluder.current = makeOccluder(s.arWorldGroup);
    shadows.update();
    const receivers = s.arWorldGroup.children.filter(
      (c) => c.name === RECEIVER,
    );
    expect(receivers).toHaveLength(1);
  });

  it("re-renders the map while balls fly, and once more when the last goes", () => {
    const s = makeScene();
    const balls = { count: 2 };
    const shadows = startDemoShadows(deps(s, { current: null }, balls));
    disposers.push(() => shadows.dispose());
    shadows.update();
    expect(s.light.shadow.autoUpdate).toBe(true);
    balls.count = 0;
    shadows.update();
    expect(s.light.shadow.autoUpdate).toBe(false);
    expect(s.light.shadow.needsUpdate).toBe(true);
  });

  it("puts the light back where it found it on dispose", () => {
    const s = makeScene();
    const position = s.light.position.clone();
    const shadows = startDemoShadows(deps(s, { current: null }, { count: 0 }));
    shadows.update();
    shadows.dispose();
    expect(s.light.parent).toBe(s.scene);
    expect(s.light.position.distanceTo(position)).toBeLessThan(1e-12);
    expect(s.light.target.parent).toBeNull();
    expect(s.light.castShadow).toBe(false);
    shadows.dispose(); // idempotent
  });

  // A scene without the framework's light (a future hierarchy change) must
  // not break the demo: no shadows, and a reason the stats line can show.
  it("stays off, without throwing, when the scene has no sun light", () => {
    const s = makeScene();
    s.scene.remove(s.light);
    const shadows = startDemoShadows(deps(s, { current: null }, { count: 3 }));
    shadows.update();
    expect(shadows.isActive()).toBe(false);
    expect(s.renderer.shadowMap.enabled).toBe(false);
    expect(shadowsLabel(shadows)).toBe(" · shadows unavailable");
    shadows.setEnabled(false);
    expect(shadowsLabel(shadows)).toBe(" · shadows off");
    shadows.dispose();
  });
});

describe("shadowsEnabledFromSearch", () => {
  it.each([
    ["", true],
    ["?shadows=1", true],
    ["?foo=bar", true],
    ["?shadows=0", false],
    ["?shadows=off", false],
    ["?shadows=false", false],
    ["?x=1&shadows=0", false],
  ])("%s → %s", (search, expected) => {
    expect(shadowsEnabledFromSearch(search)).toBe(expected);
  });
});

// The owner's switch (round-2 plan M1), one binding for AR and the replay:
// the page's initial state, then the toggle both ways, released on dispose.
describe("bindShadowSwitch", () => {
  it("sets the initial state, follows the toggle, and lets go", () => {
    const calls: boolean[] = [];
    const shadows = { setEnabled: (on: boolean) => calls.push(on) };
    const listeners = new Map<string, () => void>();
    const toggle = {
      checked: true,
      addEventListener: (type: string, fn: () => void) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const release = bindShadowSwitch(shadows, false, toggle as never);
    expect(calls).toEqual([false]);
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    listeners.get("change")!();
    expect(calls).toEqual([false, true]);
    release();
    expect(listeners.has("change")).toBe(false);
    // Without a toggle on the page: the initial state only.
    bindShadowSwitch(shadows, true, undefined)();
    expect(calls).toEqual([false, true, true]);
  });
});

// The stats line is the owner's view on the phone (round-2 plan M1): it
// must tell "switched off" from "switched on but not drawn".
describe("shadowsLabel", () => {
  it("says on, off (the switch) or unavailable (on, but not drawn)", () => {
    const on = {
      update() {},
      isActive: () => true,
      isEnabled: () => true,
      setEnabled() {},
      dispose() {},
    };
    expect(shadowsLabel(on)).toBe(" · shadows on");
    expect(
      shadowsLabel({ ...on, isActive: () => false, isEnabled: () => false }),
    ).toBe(" · shadows off");
    expect(shadowsLabel({ ...on, isActive: () => false })).toBe(
      " · shadows unavailable",
    );
    expect(shadowsLabel(null)).toBe("");
  });
});
