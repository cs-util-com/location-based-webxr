// @vitest-environment jsdom
/**
 * Why these tests matter: the pictures seen from a viewpoint must hang
 * where the camera saw the place, whatever the picture's own pose (the
 * creator moves the item, the overlay must not move), show by where the
 * visitor stands and looks, give way between the viewer and the picture,
 * hand a lined-up visitor the then-and-now slider and take it back, and
 * free what they made.
 */
import fc from "fast-check";
import type {
  TourPictureBlock,
  TourPictureViewpoint,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  type BufferGeometry,
  Group,
  PerspectiveCamera,
  Quaternion,
  Texture,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  screenIn,
  type WorldEnv,
  type WorldMode,
  type WorldPart,
} from "../../world-part.js";
import { drawnAspect } from "./picture-decode.js";
import { THEN_NOW_TIMING } from "./then-now-fade.js";
import { EDITOR_PICTURE_ALPHA, viewpointWorld } from "./viewpoint-world.js";

/** Looking east (+Z in north-up-east) from 1.6 m over the station's anchor. */
const EAST = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const VIEWPOINT: TourPictureViewpoint = {
  position: [0, 1.6, 0],
  rotation: [EAST.x, EAST.y, EAST.z, EAST.w],
  hfovDeg: 60,
  distanceM: 12,
};

function picture(
  view: TourPictureBlock["view"],
  fields: Partial<TourPictureBlock> = {},
): TourPictureBlock {
  return {
    id: "p1",
    kind: "picture",
    view,
    image: "img",
    widthM: 1,
    title: "The square",
    caption: "The square on market day. The stalls are gone.",
    year: "1902",
    viewpoint: VIEWPOINT,
    pose: { position: [3, 0, 4], rotation: [0, 0, 0, 1] },
    ...fields,
  };
}

function envOf(mode: WorldMode, screenHost?: HTMLElement): WorldEnv {
  return {
    mode,
    loadAsset: () => Promise.resolve(new Blob(["png"])),
    canvasTexture: () => {
      throw new Error("no painting here");
    },
    loadModel: () => Promise.reject(new Error("no model here")),
    enableClipping: () => undefined,
    sound: () => {
      throw new Error("no sound here");
    },
    ...(screenHost === undefined ? {} : { screen: screenIn(screenHost) }),
  };
}

function texture(): Texture & { disposed: boolean } {
  const t = new Texture() as Texture & { disposed: boolean };
  t.image = { width: 200, height: 100 };
  t.disposed = false;
  t.addEventListener("dispose", () => {
    t.disposed = true;
  });
  return t;
}

/** The part placed as the renderer places it, under a station group. */
async function placed(
  block: TourPictureBlock,
  env: WorldEnv,
  tex = texture(),
): Promise<{ part: WorldPart; station: Group; tex: typeof tex }> {
  const part = viewpointWorld(block, env, {
    decode: () => Promise.resolve(tex),
  });
  if (part === null) throw new Error("no part");
  const station = new Group();
  station.position.set(10, 0, -5);
  station.add(part.object);
  part.object.position.set(...block.pose.position);
  part.object.quaternion.set(...block.pose.rotation);
  await part.ready;
  return { part, station, tex };
}

/** A camera at `at` (station frame) looking along `yawDeg` from east. */
function cameraAt(
  station: Group,
  at: readonly [number, number, number],
  yawDeg = 0,
): PerspectiveCamera {
  const camera = new PerspectiveCamera();
  const r = (yawDeg * Math.PI) / 180;
  const local = new Vector3(...at);
  const target = local.clone().add(new Vector3(Math.sin(r), 0, Math.cos(r)));
  station.updateMatrixWorld(true);
  camera.position.copy(station.localToWorld(local.clone()));
  camera.lookAt(station.localToWorld(target));
  camera.updateMatrixWorld(true);
  return camera;
}

function tick(
  part: WorldPart,
  station: Group,
  seconds: number,
  at: readonly [number, number, number],
  yawDeg = 0,
): void {
  part.update?.({ seconds, viewer: at, camera: cameraAt(station, at, yawDeg) });
}

function named<T extends Object3D = Mesh>(root: Object3D, name: string): T {
  const found = root.getObjectByName(name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found as T;
}

function opacity(root: Object3D, name: string): number {
  return named<Mesh<BufferGeometry, Material>>(root, name).material.opacity;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:picture");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("viewpointWorld", () => {
  it("stands nothing without a viewpoint or for the other views", () => {
    // Without a viewpoint the renderer draws the picture as a plane.
    const bare = picture("thenNow");
    const { viewpoint: _dropped, ...noViewpoint } = bare;
    expect(viewpointWorld(noViewpoint, envOf("play"))).toBeNull();
    for (const view of ["plane", "framed", "cutout", "card"] as const) {
      expect(viewpointWorld(picture(view), envOf("play"))).toBeNull();
    }
  });

  it("builds each view's look with the spot marker", async () => {
    const expected = {
      thenNow: "picture-viewpoint-plane",
      sharpen: "picture-viewpoint-plane",
      viewer: "picture-viewer",
      finder: "picture-finder-ink",
      window: "picture-portal-opening",
    } as const;
    for (const [view, mesh] of Object.entries(expected)) {
      const { part } = await placed(
        picture(view as TourPictureBlock["view"]),
        envOf("edit"),
      );
      expect(part.object.getObjectByName(mesh), view).toBeDefined();
      expect(part.object.getObjectByName("picture-spot"), view).toBeDefined();
      // The editor's field-of-view lines take the image's aspect from
      // the part once it is read (the fake image is 200 x 100).
      expect(drawnAspect(part.object), view).toBe(0.5);
      part.dispose();
    }
  });

  // The viewpoint is in the station's frame: the picture's own pose (and
  // size) must not move the plane, for any pose the creator gives it.
  it("hangs the picture on the viewpoint's axis whatever the pose", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.double({ min: -20, max: 20, noNaN: true }),
          fc.double({ min: -2, max: 2, noNaN: true }),
          fc.double({ min: -20, max: 20, noNaN: true }),
        ),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: 0.2, max: 5, noNaN: true }),
        async (position, turn, scale) => {
          const q = new Quaternion().setFromAxisAngle(
            new Vector3(0, 1, 0),
            turn,
          );
          const { part, station } = await placed(
            picture("sharpen", {
              pose: { position, rotation: [q.x, q.y, q.z, q.w] },
            }),
            envOf("play"),
          );
          part.object.scale.setScalar(scale);
          tick(part, station, 0, [0, 1.6, 0]);
          station.updateMatrixWorld(true);
          const at = named(
            part.object,
            "picture-viewpoint-plane",
          ).getWorldPosition(new Vector3());
          const want = station.localToWorld(new Vector3(0, 1.6, 12));
          expect(at.distanceTo(want)).toBeLessThan(1e-6);
          part.dispose();
        },
      ),
      { numRuns: 25 },
    );
  });

  it("shows sharpen by where the visitor stands and looks", async () => {
    const { part, station } = await placed(picture("sharpen"), envOf("play"));
    tick(part, station, 0, [0, 1.6, 0]);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(1);
    tick(part, station, 1, [0, 1.6, 0], 180);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(0);
    tick(part, station, 2, [0, 1.6, -9]);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(0);
    part.dispose();
  });

  it("shows the editor a half picture to place it by", async () => {
    const { part, station } = await placed(picture("sharpen"), envOf("edit"));
    tick(part, station, 0, [0, 1.6, -30], 180);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(
      EDITOR_PICTURE_ALPHA,
    );
    expect(part.tap).toBeUndefined();
    part.dispose();
  });

  // The verdict: the viewer fades out as the picture fades in.
  it("lets the viewer give way to the picture", async () => {
    const { part, station } = await placed(picture("viewer"), envOf("play"));
    const stand = named<Group>(part.object, "picture-viewer");
    const standOpacity = (): number =>
      (stand.getObjectByProperty("type", "Mesh") as Mesh<never, Material>)
        .material.opacity;
    tick(part, station, 0, [0, 1.6, -8]);
    expect(standOpacity()).toBe(1);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(0);
    tick(part, station, 1, [0, 1.6, 0]);
    expect(standOpacity()).toBe(0);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(1);
    part.dispose();
  });

  it("hands a lined-up visitor the then-and-now slider and takes it back", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { part, station } = await placed(
      picture("thenNow"),
      envOf("play", host),
    );
    tick(part, station, 0, [0, 1.6, -8]);
    expect(host.querySelector("input[type=range]")).toBeNull();
    // Arrives on the spot (no time passed: the fade starts at 0).
    tick(part, station, 0, [0, 1.6, 0]);
    const slider = host.querySelector<HTMLInputElement>("input[type=range]");
    expect(slider).not.toBeNull();
    // The fade-in: half way at half the time, the plane following it.
    tick(part, station, THEN_NOW_TIMING.introS / 2, [0, 1.6, 0]);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBeCloseTo(
      THEN_NOW_TIMING.introTo / 2,
      6,
    );
    expect(slider?.value).toBe(
      String(Math.round((THEN_NOW_TIMING.introTo / 2) * 100)),
    );
    // The visitor takes over.
    if (slider === null) throw new Error("no slider");
    slider.value = "90";
    slider.dispatchEvent(new Event("input"));
    tick(part, station, 9, [0, 1.6, 0]);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBeCloseTo(0.9, 6);
    tick(part, station, 10, [0, 1.6, -8]);
    expect(host.querySelector("input[type=range]")).toBeNull();
    part.dispose();
  });

  it("points the window's shader at the picture's plane in the world", async () => {
    const { part, station } = await placed(picture("window"), envOf("play"));
    tick(part, station, 0, [0, 1.6, 0]);
    const opening = named<Mesh<never, ShaderMaterial>>(
      part.object,
      "picture-portal-opening",
    );
    const center = opening.material.uniforms["uC"]?.value as Vector3;
    expect(
      center.distanceTo(station.localToWorld(new Vector3(0, 1.6, 12))),
    ).toBeLessThan(1e-6);
    // From the spot the window stands ahead, facing back.
    const frame = named<Group>(part.object, "picture-portal");
    expect(frame.position.z).toBeCloseTo(1.5, 6);
    part.dispose();
  });

  it("opens the picture's sheet on a tap in play, closing the slider", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { part, station } = await placed(
      picture("thenNow"),
      envOf("play", host),
    );
    tick(part, station, 0, [0, 1.6, 0]);
    part.tap?.();
    expect(host.querySelector("[role=dialog] img")).not.toBeNull();
    expect(host.querySelector("input[type=range]")).toBeNull();
    part.dispose();
    expect(host.querySelector("[role=dialog]")).toBeNull();
  });

  it("frees its look and the texture, also when gone before it was read", async () => {
    const { part, tex } = await placed(picture("window"), envOf("play"));
    const plane = named(part.object, "picture-portal-frame");
    let freed = false;
    plane.geometry.addEventListener("dispose", () => {
      freed = true;
    });
    part.dispose();
    expect(freed).toBe(true);
    expect(tex.disposed).toBe(true);

    const late = texture();
    const early = viewpointWorld(picture("sharpen"), envOf("play"), {
      decode: () => Promise.resolve(late),
    });
    early?.dispose();
    await early?.ready;
    expect(late.disposed).toBe(true);
  });
});
