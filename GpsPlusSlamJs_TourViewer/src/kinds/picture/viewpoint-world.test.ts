// @vitest-environment jsdom
/**
 * Why these tests matter: the pictures seen from a viewpoint must hang
 * where the camera saw the place, whatever the picture's own pose (the
 * creator moves the item, the overlay must not move), show by where the
 * visitor stands and looks, give way between the viewer and the picture,
 * hand a lined-up visitor the then-and-now slider and take it back, lead
 * the visitor to the spot in the world (the decal, the light column and
 * the card on its post, standing at the viewpoint whatever the pose) and
 * get out of the way there, and free what they made.
 */
import fc from "fast-check";
import type {
  TourPictureBlock,
  TourPictureViewpoint,
} from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  Box3,
  type BufferGeometry,
  Group,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Texture,
  Vector3,
  type Material,
  type MeshBasicMaterial,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePicturePainters } from "../../test-support/fake-picture-painters.js";

import {
  screenIn,
  type WorldEnv,
  type WorldMode,
  type WorldPart,
} from "../../world-part.js";
import { drawnAspect } from "./picture-decode.js";
import { SPOT_CARD_LINES, spotCardPlace } from "./spot-guide.js";
import { THEN_NOW_TIMING } from "./then-now-fade.js";
import { thenNowFeatherMap } from "./then-now-feather.js";
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

function envOf(
  mode: WorldMode,
  screenHost?: HTMLElement,
  reduceMotion?: () => boolean,
): WorldEnv {
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
    ...(reduceMotion === undefined ? {} : { reduceMotion }),
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
  painters = fakePicturePainters(),
): Promise<{
  part: WorldPart;
  station: Group;
  tex: typeof tex;
  painted: typeof painters.painted;
}> {
  const part = viewpointWorld(block, env, {
    decode: () => Promise.resolve(tex),
    painters: painters.painters,
  });
  if (part === null) throw new Error("no part");
  const station = new Group();
  station.position.set(10, 0, -5);
  station.add(part.object);
  part.object.position.set(...block.pose.position);
  part.object.quaternion.set(...block.pose.rotation);
  await part.ready;
  return { part, station, tex, painted: painters.painted };
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

  it("builds each view's look with its way to the spot", async () => {
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
      // The viewer is its own mark: its stand, halo and plate.
      const guided = view !== "viewer";
      for (const name of [
        "picture-spot-decal",
        "picture-spot-beam",
        "picture-spot-card",
        "picture-spot-post",
      ]) {
        expect(part.object.getObjectByName(name) !== undefined, view).toBe(
          guided,
        );
      }
      for (const name of ["picture-viewer-halo", "picture-viewer-plate"]) {
        expect(part.object.getObjectByName(name) !== undefined, view).toBe(
          !guided,
        );
      }
      expect(
        part.object.getObjectByName("picture-portal-plate") !== undefined,
        view,
      ).toBe(view === "window");
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

  // The guide stands where the viewpoint is, in the station's frame: the
  // item's own pose and size and the station's (a folder's) pose and scale
  // must leave the decal under the spot and the card beside it.
  it("stands the guide at the viewpoint whatever the pose and scale", async () => {
    const vec = fc.tuple(
      fc.double({ min: -20, max: 20, noNaN: true }),
      fc.double({ min: -2, max: 2, noNaN: true }),
      fc.double({ min: -20, max: 20, noNaN: true }),
    );
    const turn = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
    const size = fc.double({ min: 0.2, max: 5, noNaN: true });
    const up = new Vector3(0, 1, 0);
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("thenNow", "finder", "sharpen", "window" as const),
        fc.record({ position: vec, turn, size }),
        fc.record({ position: vec, turn, size }),
        turn,
        async (view, item, folder, vpTurn) => {
          const q = new Quaternion().setFromAxisAngle(up, item.turn);
          const look = new Quaternion().setFromAxisAngle(up, vpTurn);
          const viewpoint: TourPictureViewpoint = {
            ...VIEWPOINT,
            position: [2, 1.6, -3],
            rotation: [look.x, look.y, look.z, look.w],
          };
          const { part, station } = await placed(
            picture(view, {
              viewpoint,
              pose: { position: item.position, rotation: [q.x, q.y, q.z, q.w] },
            }),
            envOf("play"),
          );
          station.position.set(...folder.position);
          station.quaternion.setFromAxisAngle(up, folder.turn);
          station.scale.setScalar(folder.size);
          part.object.scale.setScalar(item.size);
          tick(part, station, 0, [0, 1.6, -8]);
          station.updateMatrixWorld(true);
          const world = (o: Object3D): Vector3 =>
            o.getWorldPosition(new Vector3());
          const tol = 1e-6 * Math.max(1, folder.size);
          expect(
            world(named(part.object, "picture-spot-decal")).distanceTo(
              station.localToWorld(new Vector3(2, 0.02, -3)),
            ),
          ).toBeLessThan(tol);
          expect(
            world(named(part.object, "picture-spot-beam")).distanceTo(
              station.localToWorld(new Vector3(2, 1.7, -3)),
            ),
          ).toBeLessThan(tol);
          const place = spotCardPlace(viewpoint);
          expect(
            world(named(part.object, "picture-spot-post")).distanceTo(
              station.localToWorld(new Vector3(place.x, 0.54, place.z)),
            ),
          ).toBeLessThan(tol);
          part.dispose();
        },
      ),
      { numRuns: 25 },
    );
  });

  it("guides the visitor in and gives way on the spot", async () => {
    const { part, station, painted } = await placed(
      picture("thenNow"),
      envOf("play"),
    );
    const card = named<Mesh<BufferGeometry, Material>>(
      part.object,
      "picture-spot-card",
    );
    const beam = named<Mesh<never, ShaderMaterial>>(
      part.object,
      "picture-spot-beam",
    );
    const holder = card.parent;
    if (holder === null) throw new Error("the card hangs on nothing");
    // 7 m before the spot, on the way in.
    tick(part, station, 1, [0, 1.6, -7]);
    expect(card.material.opacity).toBe(1);
    expect(holder.visible).toBe(true);
    expect(beam.material.uniforms["uAlpha"]?.value).toBe(1);
    expect(beam.material.uniforms["uTime"]?.value).toBe(1);
    expect(opacity(part.object, "picture-spot-decal")).toBe(1);
    // The card turns its face to the visitor.
    station.updateMatrixWorld(true);
    const front = new Vector3(0, 0, 1).applyQuaternion(
      holder.getWorldQuaternion(new Quaternion()),
    );
    const toViewer = station
      .localToWorld(new Vector3(0, 1.6, -7))
      .sub(holder.getWorldPosition(new Vector3()))
      .setY(0)
      .normalize();
    expect(front.dot(toViewer)).toBeCloseTo(1, 6);
    // On the spot: the card and the column are gone, the decal dims.
    tick(part, station, 2, [0, 1.6, 0]);
    expect(holder.visible).toBe(false);
    expect(beam.material.uniforms["uAlpha"]?.value).toBe(0);
    expect(opacity(part.object, "picture-spot-decal")).toBeCloseTo(0.4, 6);
    // Its card shows the picture small, the year and what to do.
    expect(painted.cards[0]).toMatchObject({
      year: "1902",
      line1: SPOT_CARD_LINES.thenNow[0],
      line2: SPOT_CARD_LINES.thenNow[1],
    });
    expect(painted.cards[0]?.thumb?.aspect).toBe(0.5);
    expect(painted.decals).toBe(1);
    // A tap on the card or the decal opens the sheet.
    expect(part.tapTarget?.getObjectByName("picture-spot-card")).toBeDefined();
    expect(part.tapTarget?.getObjectByName("picture-spot-decal")).toBeDefined();
    part.dispose();
  });

  // The decoder hands the GPU a picture stored upside down (and marks its
  // texture not to flip again); the card draws the stored image, so it
  // must be told to turn it.
  it("tells the card when its picture is stored upside down", async () => {
    const stored = texture();
    stored.flipY = false;
    const turned = await placed(picture("thenNow"), envOf("play"), stored);
    expect(turned.painted.cards[0]?.thumb?.flipped).toBe(true);
    turned.part.dispose();
    const upright = await placed(picture("thenNow"), envOf("play"));
    expect(upright.painted.cards[0]?.thumb?.flipped).toBe(false);
    upright.part.dispose();
  });

  // A tap on the guide opens the picture; the light column is light, and
  // the card once it has given way is not there. The near-miss pick boxes
  // each tap target, so the column (3.4 m) must not be in it either.
  it("takes a tap on the card and the decal only, while they show", async () => {
    const { part, station } = await placed(picture("thenNow"), envOf("play"));
    const target = part.tapTarget;
    if (target === undefined) throw new Error("no tap target");
    expect(target.getObjectByName("picture-spot-beam")).toBeUndefined();
    for (const name of [
      "picture-spot-card",
      "picture-spot-post",
      "picture-spot-decal",
    ]) {
      expect(target.getObjectByName(name), name).toBeDefined();
    }
    tick(part, station, 1, [0, 1.6, -7]);
    station.updateMatrixWorld(true);
    const guided = target.children.filter((c) =>
      c.name.startsWith("picture-spot"),
    );
    expect(guided.length).toBe(2);
    for (const c of guided) {
      const box = new Box3().setFromObject(c);
      expect(box.max.y - box.min.y, c.name).toBeLessThan(2);
    }
    const card = named(part.object, "picture-spot-card");
    const hits = (): number => {
      station.updateMatrixWorld(true);
      const at = card.getWorldPosition(new Vector3());
      const front = new Vector3(0, 0, 1).applyQuaternion(
        card.getWorldQuaternion(new Quaternion()),
      );
      const ray = new Raycaster(
        at.clone().addScaledVector(front, 0.5),
        front.clone().negate(),
      );
      return ray.intersectObject(card, false).length;
    };
    expect(hits()).toBe(1);
    // On the spot the card has given way: a tap passes where it stood.
    tick(part, station, 2, [0, 1.6, 0]);
    expect(card.parent?.visible).toBe(false);
    expect(hits()).toBe(0);
    part.dispose();
  });

  // A low viewpoint's window can stand close to the ground: its plate
  // must not sink into it.
  it("keeps the window's plate above the ground", async () => {
    const { part, station } = await placed(
      picture("window", { viewpoint: { ...VIEWPOINT, position: [0, 0.4, 0] } }),
      envOf("play"),
    );
    tick(part, station, 0, [0, 0.4, 0]);
    station.updateMatrixWorld(true);
    const plate = named(part.object, "picture-portal-plate");
    const box = new Box3().setFromObject(plate);
    const foot = station.worldToLocal(box.min.clone());
    expect(foot.y).toBeGreaterThanOrEqual(0);
    part.dispose();
  });

  it("keeps the picture a surprise on sharpen's card", async () => {
    const { part, painted } = await placed(picture("sharpen"), envOf("play"));
    expect(painted.cards[0]?.line1).toBe(SPOT_CARD_LINES.sharpen[0]);
    expect(painted.cards[0]?.thumb).toBeUndefined();
    part.dispose();
  });

  it("holds the column still for a visitor who asked for less motion", async () => {
    const { part, station } = await placed(
      picture("finder"),
      envOf("play", undefined, () => true),
    );
    tick(part, station, 3, [0, 1.6, -7]);
    const beam = named<Mesh<never, ShaderMaterial>>(
      part.object,
      "picture-spot-beam",
    );
    expect(beam.material.uniforms["uTime"]?.value).toBe(0);
    part.dispose();
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
    const { part, station, painted } = await placed(
      picture("viewer"),
      envOf("play"),
    );
    // Its plate names the year, as every guide's card does.
    expect(painted.cards[0]).toMatchObject({
      year: "1902",
      line1: "Step up to it",
    });
    const stand = named<Group>(part.object, "picture-viewer");
    const standOpacity = (): number =>
      (stand.getObjectByProperty("type", "Mesh") as Mesh<never, Material>)
        .material.opacity;
    tick(part, station, 0, [0, 1.6, -8]);
    expect(standOpacity()).toBe(1);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(0);
    // Its plate reads with the stand; its halo glows, softer far away.
    expect(opacity(part.object, "picture-viewer-plate")).toBe(1);
    const farHalo = opacity(part.object, "picture-viewer-halo");
    expect(farHalo).toBeGreaterThan(0);
    tick(part, station, 0, [0, 1.6, -3]);
    expect(opacity(part.object, "picture-viewer-halo")).toBeCloseTo(
      2 * farHalo,
      6,
    );
    tick(part, station, 1, [0, 1.6, 0]);
    expect(standOpacity()).toBe(0);
    expect(opacity(part.object, "picture-viewpoint-plane")).toBe(1);
    expect(opacity(part.object, "picture-viewer-plate")).toBe(0);
    expect(opacity(part.object, "picture-viewer-halo")).toBe(0);
    part.dispose();
  });

  it("puts a plate on the viewer's column, facing the spot, fading with it", async () => {
    // Why: the chosen page's viewer says what it is for on its column: the
    // year, and to step up to it; it gives way with the viewer.
    const { part, station, painted } = await placed(
      picture("viewer"),
      envOf("play"),
    );
    // The viewer is its own mark: its plate is its only card.
    expect(painted.cards).toHaveLength(1);
    expect(painted.cards[0]).toMatchObject({
      year: "1902",
      line1: "Step up to it",
      line2: "and see it as it was",
    });
    const plate = named(part.object, "picture-viewer-plate");
    expect(
      named<Group>(part.object, "picture-viewer").getObjectById(plate.id),
    ).toBe(plate);
    station.updateMatrixWorld(true);
    // In the viewpoint's frame (the part's): 0.95 m up, 0.34 m ahead of
    // the spot (east, +Z), turned to face back at it and tipped up to the
    // eye.
    const at = part.object.worldToLocal(plate.getWorldPosition(new Vector3()));
    expect(at.y).toBeCloseTo(0.95, 6);
    expect(at.z).toBeCloseTo(0.34, 6);
    expect(at.x).toBeCloseTo(0, 6);
    const facing = new Vector3(0, 0, 1)
      .transformDirection(plate.matrixWorld)
      .applyQuaternion(station.getWorldQuaternion(new Quaternion()).invert());
    expect(facing.z).toBeLessThan(-0.9);
    expect(facing.y).toBeGreaterThan(0.3);
    const size = new Box3().setFromObject(plate).getSize(new Vector3());
    expect(size.x).toBeCloseTo(0.34, 6);
    tick(part, station, 0, [0, 1.6, -8]);
    expect(opacity(part.object, "picture-viewer-plate")).toBe(1);
    tick(part, station, 1, [0, 1.6, 0]);
    expect(opacity(part.object, "picture-viewer-plate")).toBe(0);
    part.dispose();
  });

  it("hangs a plate under the window's frame", async () => {
    // Why: the chosen page's window names what it shows under its frame:
    // the year, the caption's first phrase, and to look through.
    const { part, station, painted } = await placed(
      picture("window"),
      envOf("play"),
    );
    // The guide's card is the other one.
    expect(
      painted.cards.find((c) => c.line2 === "Look through the frame"),
    ).toMatchObject({ year: "1902", line1: "The square on market day" });
    station.updateMatrixWorld(true);
    const frame = new Box3().setFromObject(
      named(part.object, "picture-portal-frame"),
    );
    const plate = new Box3().setFromObject(
      named(part.object, "picture-portal-plate"),
    );
    const size = plate.getSize(new Vector3());
    // 0.36 m wide, a quarter as tall, 5 cm under the frame, centred.
    expect(Math.max(size.x, size.z)).toBeCloseTo(0.36, 6);
    expect(size.y).toBeCloseTo(0.09, 6);
    expect(frame.min.y - plate.max.y).toBeCloseTo(0.05, 6);
    expect(plate.getCenter(new Vector3()).x).toBeCloseTo(
      frame.getCenter(new Vector3()).x,
      6,
    );
    part.dispose();
  });

  it("paints no plate for the views without one, only the guide's card", async () => {
    for (const view of ["thenNow", "sharpen", "finder"] as const) {
      const { part, painted } = await placed(picture(view), envOf("play"));
      expect(painted.cards, view).toHaveLength(1);
      expect(painted.cards[0]?.line1, view).toBe(SPOT_CARD_LINES[view][0]);
      part.dispose();
    }
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

  it("softens only then and now's picture at its edges", async () => {
    // Why: the chosen page's then-and-now melts into today at its border;
    // sharpen and the viewer show the whole picture edge to edge.
    for (const view of ["thenNow", "sharpen", "viewer"] as const) {
      const { part } = await placed(picture(view), envOf("play"));
      const plane = named(part.object, "picture-viewpoint-plane");
      const material = plane.material as MeshBasicMaterial;
      expect(material.alphaMap, view).toBe(
        view === "thenNow" ? thenNowFeatherMap() : null,
      );
      part.dispose();
      // The shared map outlives every part.
      expect(thenNowFeatherMap().image.data).toBeDefined();
    }
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
