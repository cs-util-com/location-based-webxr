/**
 * @vitest-environment jsdom
 *
 * View-layer tests for the real adapter — real THREE objects, no WebGL context
 * (the same convention component 7 uses for its Leaflet map). What is covered
 * here is the handful of THREE-specific rules that silently break in the field
 * and would never show up in the orchestrator's fake-adapter tests:
 *
 *  - clones share the template's geometry, and releasing one must NOT dispose it
 *    (plan A10 — the bug that blanks every other knight using the same model);
 *  - a raycast hit on a deeply nested mesh still resolves to its waypoint
 *    (the `userData` parent walk — what breaks when an artist re-exports a model);
 *  - only visible meshes become pick targets (plan A12);
 *  - a suspended AudioContext is reported, not ignored (plan A16).
 *
 * Pixels and real GLTF parsing stay out: they are demo- and phone-verified
 * (TASK.md §2.3.8 excludes the render from the coverage target).
 */

import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
  type AudioListener,
} from "three";

import type { TourCoord } from "../../../store/types.js";
import type { ParsedTemplate } from "./gltf-loading.js";
import {
  createThreeSceneAdapter,
  type SceneAnchor,
} from "./three-scene-adapter.js";
import type { XrSelectEvent, XrSessionLike } from "./ray-sources.js";

// jsdom ships no real 2D canvas backend. Every waypoint now gets a transport
// panel (`CanvasTexture`-backed, component 1) the moment it gets a visual, so
// this stub must be installed before any test runs, not just the transcript
// ones. Left un-restored deliberately: the HTML text backend's fallback wiring
// keeps retrying `getContext` asynchronously (plan R1/R2) past any one test's
// own lifetime, so swapping it back mid-suite would make an unrelated later
// test flaky depending on timing.
const fake2dContext = {
  font: "",
  measureText: () => ({ width: 0 }),
  fillRect: () => undefined,
  clearRect: () => undefined,
  fillText: () => undefined,
  save: () => undefined,
  restore: () => undefined,
  beginPath: () => undefined,
  closePath: () => undefined,
  fill: () => undefined,
  arc: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  roundRect: () => undefined,
  translate: () => undefined,
  scale: () => undefined,
};
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
  fake2dContext as unknown as CanvasRenderingContext2D,
);

const COORD: TourCoord = { lat: 0, lon: 0 };

/** A nested "model": Group → Group → Mesh, like a real GLTF export. */
function makeTemplate(): ParsedTemplate {
  const root = new Group();
  const inner = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  inner.add(mesh);
  root.add(inner);
  return { root, ownedTextures: [] };
}

/** Identity anchor: reports anchored immediately, never moves the object. */
function identityAnchor(): SceneAnchor {
  return {
    isFullyAnchored: true,
    setGpsPoint: () => undefined,
    markMovedExternally: () => undefined,
    dispose: () => undefined,
  };
}

const suspendedListener = {
  context: { state: "suspended" },
} as unknown as AudioListener;
const runningListener = {
  context: { state: "running" },
} as unknown as AudioListener;

interface Harness {
  adapter: ReturnType<typeof createThreeSceneAdapter>;
  parent: Group;
  camera: PerspectiveCamera;
  template: ParsedTemplate;
  session: XrSessionLike & { fire(): void };
}

function setup(
  listener: AudioListener = runningListener,
  template = makeTemplate(),
): Harness {
  const parent = new Group();
  const camera = new PerspectiveCamera();
  const listeners = new Set<(event: XrSelectEvent) => void>();
  const session: XrSessionLike & { fire(): void } = {
    addEventListener: (_type, listener_) => listeners.add(listener_),
    removeEventListener: (_type, listener_) => listeners.delete(listener_),
    fire: () => {
      for (const l of listeners) l({ inputSource: {} });
    },
  };

  const adapter = createThreeSceneAdapter({
    parent,
    camera,
    audioListener: listener,
    createAnchor: identityAnchor,
    toWorld: () => new Vector3(1, 0, 2),
    getUserWorldPos: () => new Vector3(),
    orbPoolSize: 4,
    xrSession: session,
    // Identity matrix: ray origin at (0,0,0) pointing down -Z.
    getTargetRayMatrix: () => new Matrix4(),
    parse: () => Promise.resolve(template),
  });

  return { adapter, parent, camera, template, session };
}

describe("template vs clone (plan A9/A10)", () => {
  it("clones share the template's geometry", async () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const template = await h.adapter.buildTemplate("model", "blob:x");
    h.adapter.instantiate(handle, template);
    const handleB = h.adapter.createWaypointRoot("wp-2", COORD);
    h.adapter.instantiate(handleB, template);

    // Look only at each waypoint's cloned visual (`children[0]`, added before
    // its transport panel) — the orb pool and each waypoint's own transport
    // panel have their own, separately-owned geometry on the same parent.
    const geometries = new Set<unknown>();
    for (const name of ["waypoint-wp-1", "waypoint-wp-2"]) {
      h.parent.getObjectByName(name)!.children[0]!.traverse((node) => {
        const mesh = node as Partial<Mesh>;
        if (mesh.geometry !== undefined) geometries.add(mesh.geometry);
      });
    }
    // Two clones, one geometry between them — the whole point of a template.
    expect(geometries.size).toBe(1);
  });

  it("releasing a clone does NOT dispose the shared geometry", async () => {
    const h = setup();
    const meshes: Mesh[] = [];
    h.template.root.traverse((node) => {
      if ((node as Partial<Mesh>).geometry !== undefined)
        meshes.push(node as Mesh);
    });
    const disposeSpy = vi.spyOn(meshes[0]!.geometry, "dispose");

    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const template = await h.adapter.buildTemplate("model", "blob:x");
    const visual = h.adapter.instantiate(handle, template);
    h.adapter.releaseVisual(visual);

    // This is the whole point: another waypoint may still be rendering it.
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it("disposing the TEMPLATE does dispose the geometry", async () => {
    const h = setup();
    const meshes: Mesh[] = [];
    h.template.root.traverse((node) => {
      if ((node as Partial<Mesh>).geometry !== undefined)
        meshes.push(node as Mesh);
    });
    const disposeSpy = vi.spyOn(meshes[0]!.geometry, "dispose");

    const template = await h.adapter.buildTemplate("model", "blob:x");
    h.adapter.disposeTemplate(template);
    expect(disposeSpy).toHaveBeenCalled();
  });

  it("instantiates invisibly — parsed but not shown (§2.5.3)", async () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const template = await h.adapter.buildTemplate("model", "blob:x");
    h.adapter.instantiate(handle, template);
    const clone = h.parent.getObjectByName("waypoint-wp-1")!.children[0]!;
    expect(clone.visible).toBe(false);
  });
});

describe("tap classification", () => {
  it("resolves a hit on a deeply nested mesh to its waypoint", async () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const template = await h.adapter.buildTemplate("model", "blob:x");
    const visual = h.adapter.instantiate(handle, template);
    h.adapter.setVisible(visual, true);
    // Put the knight in front of the camera's ray (origin 0,0,0 → -Z).
    h.parent.getObjectByName("waypoint-wp-1")!.position.set(0, 0, -5);
    h.parent.updateMatrixWorld(true);
    h.adapter.setPickTargets([handle]);

    const hits: string[] = [];
    h.adapter.onTap((hit) => hits.push(`${hit.waypointId}:${hit.role}`));
    h.session.fire();

    expect(hits).toEqual(["wp-1:visual"]);
  });

  it("ignores taps once the visual is hidden", async () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const template = await h.adapter.buildTemplate("model", "blob:x");
    const visual = h.adapter.instantiate(handle, template);
    h.adapter.setVisible(visual, true);
    h.parent.getObjectByName("waypoint-wp-1")!.position.set(0, 0, -5);
    h.parent.updateMatrixWorld(true);

    // A PREFETCHING (invisible) knight must not enter the raycast set — the
    // raycaster does not skip invisible objects on its own.
    h.adapter.setVisible(visual, false);
    h.adapter.setPickTargets([handle]);

    const hits: string[] = [];
    h.adapter.onTap((hit) => hits.push(hit.waypointId));
    h.session.fire();
    expect(hits).toEqual([]);
  });

  it("unsubscribes tap listeners", async () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const template = await h.adapter.buildTemplate("model", "blob:x");
    const visual = h.adapter.instantiate(handle, template);
    h.adapter.setVisible(visual, true);
    h.parent.getObjectByName("waypoint-wp-1")!.position.set(0, 0, -5);
    h.parent.updateMatrixWorld(true);
    h.adapter.setPickTargets([handle]);

    const hits: string[] = [];
    const off = h.adapter.onTap((hit) => hits.push(hit.waypointId));
    off();
    h.session.fire();
    expect(hits).toEqual([]);
  });
});

describe("fallback visual (§7.2)", () => {
  it("owns its own geometry and disposes it on release", () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const visual = h.adapter.buildFallbackVisual(handle);
    const marker = h.parent.getObjectByName("waypoint-wp-1")!
      .children[0] as Mesh;
    const disposeSpy = vi.spyOn(marker.geometry, "dispose");
    h.adapter.releaseVisual(visual);
    expect(disposeSpy).toHaveBeenCalled();
  });
});

describe("audio readiness (plan A16)", () => {
  it("reports a suspended context instead of failing silently", () => {
    expect(setup(suspendedListener).adapter.isAudioReady()).toBe(false);
  });

  it("reports a running context", () => {
    expect(setup(runningListener).adapter.isAudioReady()).toBe(true);
  });
});

describe("anchoring and teardown", () => {
  it("parents each waypoint under the arWorldGroup and anchors it", () => {
    const h = setup();
    h.adapter.createWaypointRoot("wp-1", COORD);
    expect(h.parent.getObjectByName("waypoint-wp-1")).toBeDefined();
    expect(h.adapter.isAnchored({ waypointId: "wp-1" })).toBe(true);
  });

  it("removes everything it added on dispose", async () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const template = await h.adapter.buildTemplate("model", "blob:x");
    h.adapter.instantiate(handle, template);
    h.adapter.dispose();
    expect(h.parent.getObjectByName("waypoint-wp-1")).toBeUndefined();
    expect(h.parent.children).toHaveLength(0); // orb pool included
  });

  it("converts breadcrumb coordinates through the injected seam", () => {
    const h = setup();
    const positions = h.adapter.toWorldPositions([COORD, COORD]);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toEqual(new Vector3(1, 0, 2));
  });
});

describe("transcript billboarding (plan A14)", () => {
  it("leaves the transcript panel's own rotation at identity so it inherits the parent's yaw instead of double-rotating", () => {
    const h = setup();
    const handle = h.adapter.createWaypointRoot("wp-1", COORD);
    const group = h.parent.getObjectByName("waypoint-wp-1")!;
    // Far from the world origin — this is what exposes a yaw computed from a
    // LOCAL offset (near the origin) instead of the panel's true world position.
    group.position.set(20, 0, 5);
    // Deliberately NOT (0, _, 0): the local x/z the bug mistakes for a world
    // position is (0, 0.9, 0), so a camera whose world x/z is also (0, 0)
    // would make `computeBillboardYaw` hit its "no horizontal direction"
    // fallback by coincidence and mask the bug either way.
    h.camera.position.set(8, 1.6, -30);
    h.parent.updateMatrixWorld(true);

    h.adapter.showTranscript(handle, "hello");
    h.adapter.update(0);

    let pickMesh: Mesh | undefined;
    group.traverse((node) => {
      const stamped = (node.userData as { arScene?: { role?: string } })
        .arScene;
      if (stamped?.role === "transcript") pickMesh = node as Mesh;
    });
    expect(pickMesh).toBeDefined();
    // The parent (`waypoint-wp-1`) already yawed to face the camera — the
    // text's own group must not apply a second, independently-computed yaw.
    expect(pickMesh!.parent!.rotation.y).toBe(0);
  });
});

describe("waypoint billboarding under a rotated arWorldGroup", () => {
  it("faces the camera in WORLD space when the parent carries an alignment yaw", () => {
    const h = setup();
    h.adapter.createWaypointRoot("wp-1", COORD);
    const group = h.parent.getObjectByName("waypoint-wp-1")!;
    // The alignment matrix on arWorldGroup rotates AR-odometry space onto
    // GPS-world space by an arbitrary heading; identity only on desktop.
    h.parent.rotation.y = 0.9;
    h.parent.position.set(3, 0, -4);
    group.position.set(20, 0, 5);
    h.camera.position.set(8, 1.6, -30);
    h.parent.updateMatrixWorld(true);

    h.adapter.update(0);
    h.parent.updateMatrixWorld(true);

    const worldPos = group.getWorldPosition(new Vector3());
    const front = new Vector3(0, 0, 1)
      .transformDirection(group.matrixWorld)
      .setY(0)
      .normalize();
    const toCamera = h.camera
      .getWorldPosition(new Vector3())
      .sub(worldPos)
      .setY(0)
      .normalize();
    expect(front.distanceTo(toCamera)).toBeLessThan(1e-6);
  });
});

describe("wayfinding guide (plan 2026-09-17)", () => {
  it("renders an indicator once setWayfindingTarget is called, and clears it on null", () => {
    const h = setup();
    // The harness's identityAnchor() never actually moves the marker (it
    // only reports "anchored"), so the target stays at the parent's origin.
    // Move the camera away from it so the placement seam sees a real,
    // non-degenerate distance instead of "target exactly at the camera".
    h.camera.position.set(0, 0, 10);
    h.camera.updateMatrixWorld();
    const findIndicator = () =>
      h.camera.children.find(
        (c) =>
          c.visible &&
          (c.name === "wayfinding-arrow" || c.name === "wayfinding-circle"),
      );

    expect(findIndicator()).toBeUndefined();

    h.adapter.setWayfindingTarget({
      kind: "breadcrumb",
      index: 0,
      coord: COORD,
    });
    h.adapter.update(1 / 60);
    expect(findIndicator()).toBeDefined();

    h.adapter.setWayfindingTarget(null);
    h.adapter.update(1 / 60);
    expect(findIndicator()).toBeUndefined();
  });
});
