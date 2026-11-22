/**
 * `creator-previews.ts` on its own, with the photo decoder injected: the
 * composed suites cannot decode a texture in node (`decodeFrameTexture`
 * needs `createImageBitmap`), so which BYTES a photo preview is decoded
 * from was invisible to them - the sampled mutant "finished photo bytes
 * dropped" survived as a known gap until this split (code book refactor
 * plan M1 review #6, M2).
 */

import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  type Camera,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Texture,
  Vector3,
} from "three";
import type { TourAsset } from "gps-plus-slam-app-framework/ar/tour-assets";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
  type TourPicture,
  type TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourObjects } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { objectPoseNue, renderTourStation } from "./content-placement.js";
import { pickObject } from "./object-pick.js";
import {
  wireCreatorPreviews,
  type CreatorPreviewDrawings,
} from "./creator-previews.js";
import type { AuthoringObject } from "./object-editing.js";
import type { TourSession } from "./tour-session.js";
import {
  createTourViewerSession,
  createTourViewerStore,
  type TourViewerStore,
} from "./tour-viewer-session.js";
import {
  mountedWorldPartSet,
  worldEnv,
  unmountWorldPart,
  type WorldEnv,
  type WorldPart,
} from "./world-part.js";

const ZERO = { lat: 47.5, lon: 8.7 };

// A hosted item is placed through its station's frame, whose geodesy the
// core's licence gates (as `main.ts` activates it at boot).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

function photo(id: string): TourPicture {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    imageAsset: {
      id: id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-10-06T00:00:00.000Z",
    geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

/** A hosted object with nothing on this device: its preview's bytes come
 *  from the Finish's keep, or else from the zip. */
function hosted(object: TourObject): AuthoringObject {
  return { object, hosted: true, changed: false, placed: null };
}

function harness(
  objects: readonly AuthoringObject[],
  options: {
    drawings?: CreatorPreviewDrawings;
    assets?: readonly TourAsset[];
    /** The open tour (its stations hold the hosted items); else one
     *  with `assets` and no station. */
    manifest?: TourManifest;
    modelScene?: Object3D;
    camera?: Camera;
    selected?: string;
    viewHeightPx?: number;
  } = {},
) {
  const ctx = createTourViewerSession();
  if (options.manifest !== undefined) {
    ctx.tourDocument.open(options.manifest);
  } else if (options.assets !== undefined) {
    ctx.tourDocument.open({
      ...createEmptyTourManifest(),
      assets: [...options.assets],
    });
  }
  const camera = { value: options.camera ?? null };
  const models: Blob[] = [];
  const modelScene = options.modelScene ?? new Object3D();
  const zipBytes = new Blob(["zip"]);
  const zipReads: string[] = [];
  ctx.session = {
    loadContentEntry: (name: string) => {
      zipReads.push(name);
      return Promise.resolve(zipBytes);
    },
  } as unknown as TourSession;
  const real = createTourViewerStore();
  const arStore = {
    ...real,
    getState: () => ({ ...real.getState(), gpsData: { zero: ZERO } }) as never,
  } as unknown as TourViewerStore;
  const scene = new Group();
  const decoded: Blob[] = [];
  const previews = wireCreatorPreviews({
    ctx,
    arStore,
    seams: {
      getScene: () => scene,
      getArWorldGroup: () => null,
      createLabel: () => ({ object: new Object3D(), dispose: () => undefined }),
      getViewerCamera: () => camera.value,
      loadGlbModel: (blob) => {
        models.push(blob);
        return Promise.resolve(modelScene);
      },
      enableClipping: () => undefined,
    },
    creator: true,
    objects: () => objects,
    selected: () => options.selected ?? null,
    viewHeightPx: () => options.viewHeightPx ?? 0,
    decodePhoto: (blob) => {
      decoded.push(blob);
      return Promise.resolve(new Texture());
    },
    ...(options.drawings === undefined ? {} : { drawings: options.drawings }),
  });
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };
  return {
    ctx,
    scene,
    previews,
    decoded,
    zipBytes,
    zipReads,
    settled,
    camera,
    models,
    modelScene,
  };
}

type WorldFrame = Parameters<NonNullable<WorldPart["update"]>>[0];

/** The world door as the creator's previews ask it, recorded: each block
 *  with the environment it came with, each part it gave. */
function recordingDoor() {
  const asked: { block: TourBlock; env: WorldEnv }[] = [];
  type Recorded = WorldPart & { frames: WorldFrame[]; disposed: boolean };
  const parts = new Map<string, Recorded>();
  const stands: string[] = [];
  const stand = (block: { readonly id: string }) => {
    stands.push(block.id);
    return { object: new Object3D(), dispose: () => undefined };
  };
  const drawings: CreatorPreviewDrawings = {
    worldPart: (block, env) => {
      asked.push({ block, env });
      const part: Recorded = {
        object: new Object3D(),
        frames: [],
        disposed: false,
        update(frame) {
          part.frames.push(frame);
        },
        dispose() {
          part.disposed = true;
          unmountWorldPart(part);
        },
      };
      parts.set(block.id, part);
      return part;
    },
    makeLectern: stand,
    makeReadingSign: stand,
  };
  return { asked, parts, stands, drawings };
}

describe("creator-previews: a photo's bytes", () => {
  // Why this test matters: a Finish takes a photo out of the page's work
  // while the hosted zip does not carry its bytes yet (the creator still
  // has to upload the rebuilt file). Its preview must decode the bytes the
  // Finish kept; reading the zip instead finds nothing and the photo
  // vanishes from the scene until the next open.
  it("decodes the bytes a Finish kept, not the hosted zip's", async () => {
    const h = harness([hosted(photo("g"))]);
    const kept = new Blob(["kept"]);
    h.previews.keepFinishedPhoto("g", kept);
    h.previews.sync();
    await h.settled();
    expect(h.decoded).toEqual([kept]);
    expect(h.zipReads).toEqual([]);
    expect(h.ctx.placedPreviews.has("g")).toBe(true);
  });

  // The positive control: without a kept copy the zip is read, so the test
  // above distinguishes the two sources.
  it("reads a hosted photo from the zip when no Finish kept its bytes", async () => {
    const h = harness([hosted(photo("g"))]);
    h.previews.sync();
    await h.settled();
    expect(h.zipReads).toEqual(["content/g.jpg"]);
    expect(h.decoded).toEqual([h.zipBytes]);
  });

  // Why this test matters: the kept bytes belong to the tour they were
  // finished in; a tour close must not hand them to the next tour's photo
  // of the same id.
  it("forgets the kept bytes when the tour closes", async () => {
    const h = harness([hosted(photo("g"))]);
    h.previews.keepFinishedPhoto("g", new Blob(["kept"]));
    h.previews.reset();
    h.previews.sync();
    await h.settled();
    expect(h.decoded).toEqual([h.zipBytes]);
  });
});

describe("creator-previews: every kind through the world door", () => {
  const geo = {
    lat: 47.5001,
    lon: 8.7001,
    alt: 401,
    rotation: [0, 0, 0, 1],
  } as const;
  const base = { createdAtIso: "2026-10-06T00:00:00.000Z", geo };
  const every: readonly TourObject[] = [
    { ...base, id: "pin", kind: "shortText", view: "pin", caption: "Gate" },
    { ...base, id: "sign", kind: "shortText", view: "sign", caption: "Sign" },
    {
      ...base,
      id: "model",
      kind: "model",
      view: "placed",
      asset: "arch",
      sizeM: 2,
    },
    {
      ...base,
      id: "framed",
      kind: "picture",
      view: "framed",
      image: "framed",
      widthM: 1,
      imageAsset: { id: "framed", path: "content/framed.jpg", kind: "image" },
    },
    {
      ...base,
      id: "video",
      kind: "video",
      view: "screen",
      video: "clip",
      widthM: 1,
    },
    {
      ...base,
      id: "sound",
      kind: "audio",
      view: "spot",
      audio: "voice",
    } as unknown as TourObject,
    {
      ...base,
      id: "figure",
      kind: "character",
      view: "speak",
      name: "Warden",
      image: "framed",
    },
    {
      ...base,
      id: "stand",
      kind: "longText",
      view: "lectern",
      title: "T",
      body: "B",
    },
    {
      ...base,
      id: "board",
      kind: "longText",
      view: "reading",
      title: "T",
      body: "B",
    },
  ];
  const doorIds = [
    "pin",
    "sign",
    "model",
    "framed",
    "video",
    "sound",
    "figure",
  ];

  // Why this test matters: before this, the creator's AR previews drew a
  // model, video, sound, character, framed picture or sign as nothing
  // and no long text at all, so the creator could neither see nor tap
  // most of the tour in AR. Every free kind must have a drawn look under
  // its preview's root, named by its id (what a tap's pick reads).
  it("draws every free kind, each under its preview's root by its id", async () => {
    const door = recordingDoor();
    const h = harness(every.map(hosted), { drawings: door.drawings });
    h.previews.sync();
    await h.settled();
    expect(door.asked.map((a) => a.block.id).sort()).toEqual(
      [...doorIds].sort(),
    );
    expect(door.stands.sort()).toEqual(["board", "stand"]);
    for (const object of every) {
      const root = h.ctx.placedPreviews.get(object.id)?.root;
      expect(root, object.id).toBeDefined();
      expect(
        root!.children.some((c) => c.userData["objectId"] === object.id),
        object.id,
      ).toBe(true);
    }
  });

  // Why this test matters: the creator's previews are the editor's look,
  // still and silent (a video does not play, a sound does not speak), and
  // a model is read by the page's own glb reader from the tour's file; a
  // picture placed on this device is read from its bytes here, not from a
  // zip that does not hold it yet.
  it("hands the door the edit mode, the page's model reader and this device's bytes first", async () => {
    const door = recordingDoor();
    const kept = new Blob(["framed here"]);
    const model = every.find((o) => o.id === "model")!;
    const framed = every.find((o) => o.id === "framed")!;
    const h = harness(
      [
        hosted(model),
        {
          object: framed,
          hosted: false,
          changed: true,
          placed: { object: framed, blob: kept },
        },
      ],
      {
        drawings: door.drawings,
        assets: [{ id: "arch", path: "content/arch.glb", kind: "model" }],
      },
    );
    h.previews.sync();
    await h.settled();
    const modelEnv = door.asked.find((a) => a.block.id === "model")!.env;
    expect(modelEnv.mode).toBe("edit");
    const scene = await modelEnv.loadModel("arch");
    expect(h.zipReads).toEqual(["content/arch.glb"]);
    expect(h.models).toEqual([h.zipBytes]);
    expect(scene).toBe(h.modelScene);
    const framedEnv = door.asked.find((a) => a.block.id === "framed")!.env;
    expect(await framedEnv.loadAsset("framed")).toBe(kept);
    expect(h.zipReads).toEqual(["content/arch.glb"]);
  });

  // Why this test matters: a delete in the AR list must take the item out
  // of the scene; a part left mounted keeps drawing (and ticking) an item
  // the tour no longer holds.
  it("disposes and unmounts a deleted item's parts", async () => {
    const door = recordingDoor();
    const objects = every.slice(0, 3).map(hosted);
    const h = harness(objects, { drawings: door.drawings });
    h.previews.sync();
    await h.settled();
    const part = door.parts.get("model")!;
    expect(mountedWorldPartSet().has(part)).toBe(true);
    objects.splice(2, 1);
    h.previews.sync();
    expect(part.disposed).toBe(true);
    expect(mountedWorldPartSet().has(part)).toBe(false);
    expect(h.ctx.placedPreviews.has("model")).toBe(false);
  });

  // Why this test matters: an edit-mode look keeps its size on the screen
  // and turns to the camera (a sound's icon, a character's figure), and
  // shows more of itself while selected; without a frame each tick it
  // stays as built, a speck far off and a giant up close.
  it("ticks every drawn part with the camera, its lens, the viewer and the selection", async () => {
    const door = recordingDoor();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld();
    const h = harness(every.map(hosted), {
      drawings: door.drawings,
      camera,
      selected: "figure",
      viewHeightPx: 800,
    });
    h.previews.sync();
    await h.settled();
    h.previews.tick(1500);
    for (const id of doorIds) {
      const frames = door.parts.get(id)!.frames;
      expect(frames, id).toHaveLength(1);
      expect(frames[0]!.camera).toBe(camera);
      expect(frames[0]!.selected).toBe("figure");
      expect(frames[0]!.seconds).toBe(1.5);
      expect(frames[0]!.metresPerPxAtOneM).toBeGreaterThan(0);
    }
  });

  // Why this test matters: a part a failed load took out (no parent) and a
  // deleted item's part must not be ticked, and nothing is ticked without
  // a camera (outside a session) or after the visit ended.
  it("skips a detached or deleted part, and ticks nothing without a camera or after the visit", async () => {
    const door = recordingDoor();
    const objects = every.slice(0, 3).map(hosted);
    const camera = new PerspectiveCamera();
    const h = harness(objects, { drawings: door.drawings, camera });
    h.previews.sync();
    await h.settled();
    door.parts.get("pin")!.object.removeFromParent();
    objects.splice(2, 1);
    h.previews.sync();
    h.previews.tick(0);
    expect(door.parts.get("pin")!.frames).toHaveLength(0);
    expect(door.parts.get("model")!.frames).toHaveLength(0);
    expect(door.parts.get("sign")!.frames).toHaveLength(1);
    h.camera.value = null;
    h.previews.tick(0);
    expect(door.parts.get("sign")!.frames).toHaveLength(1);
    // A visit's end forgets the parts (the entry's teardown disposes them).
    h.camera.value = camera;
    h.previews.endVisit();
    h.previews.tick(0);
    expect(door.parts.get("sign")!.frames).toHaveLength(1);
  });
});

describe("creator-previews: a hosted item is drawn in its station's frame", () => {
  /** A station high above the zero and turned, holding a ground arrow
   *  with a point to aim at and a then-and-now picture with its viewpoint
   *  inside a folder drawn twice as large, and a model at its top. */
  const station: TourStation = {
    id: "gate",
    geo: {
      lat: 47.5002,
      lon: 8.7003,
      alt: 400,
      rotation: [0, 0.3826834, 0, 0.9238795],
    },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    children: [
      {
        id: "arch",
        kind: "model",
        view: "placed",
        asset: "arch",
        sizeM: 2,
        pose: { position: [0, 0, 4], rotation: [0, 0, 0, 1] },
      },
      {
        id: "folder",
        kind: "folder",
        pose: { position: [2, 0, 1], rotation: [0, 0, 0, 1] },
        scale: 2,
        children: [
          {
            id: "arrow",
            kind: "shortText",
            view: "ground",
            caption: "This way",
            pointsTo: [6, 0, 5],
            pose: { position: [1, 0, 0], rotation: [0, 0, 0, 1] },
          },
          {
            id: "then",
            kind: "picture",
            view: "thenNow",
            image: "old",
            widthM: 1,
            viewpoint: {
              position: [0, 1.6, -3],
              rotation: [0, 0, 0, 1],
              hfovDeg: 60,
              distanceM: 3,
            },
            pose: { position: [0, 1.6, 0], rotation: [0, 0, 0, 1] },
          },
        ],
      },
    ],
  } as unknown as TourStation;
  const assets: TourAsset[] = [
    { id: "arch", path: "content/arch.glb", kind: "model" },
    { id: "old", path: "content/old.jpg", kind: "image" },
  ];
  const manifest: TourManifest = {
    ...createEmptyTourManifest(),
    assets,
    stations: [station],
  };

  /** The visitor's drawing of the same station, through a door that
   *  records as the creator's does. */
  async function visitorParts() {
    const door = recordingDoor();
    const scene = new Group();
    await renderTourStation(station, {
      scene,
      zero: ZERO,
      assets,
      makeLabel: () => ({ object: new Object3D(), dispose: () => undefined }),
      loadPhotoTexture: () => Promise.resolve(new Texture()),
      worldPart: (block) =>
        door.drawings.worldPart(
          block,
          worldEnv("edit", assets, () => {
            return Promise.reject(new Error("unused"));
          }),
        ),
    });
    scene.updateMatrixWorld(true);
    return door;
  }

  // Why this test matters: a world part reads its parent as its station's
  // frame - a viewpoint, the point an arrow or a pin aims at, the ground
  // under a framed picture or a video. Drawn at its own pose inside the
  // GPS-world frame (where up is the altitude), a viewpoint picture of a
  // station at 400 m hung 400 m underground and an arrow aimed near the
  // session's zero. The creator must hand every part the block and the
  // parent frame the visitor's station renderer hands it, so any part,
  // however it reads its frame, draws the same.
  it("hands each part the visitor's block and frame, so a viewpoint stays at the station's ground and its folder's scale holds", async () => {
    const door = recordingDoor();
    const h = harness(tourObjects(manifest).map(hosted), {
      drawings: door.drawings,
      manifest,
    });
    h.previews.sync();
    await h.settled();
    h.scene.updateMatrixWorld(true);
    const visitor = await visitorParts();
    for (const id of ["arch", "arrow", "then"]) {
      const creator = door.asked.find((a) => a.block.id === id)!.block;
      const seen = visitor.asked.find((a) => a.block.id === id)!.block;
      const { pose, ...fields } = creator;
      const { pose: seenPose, ...seenFields } = seen;
      expect(fields, id).toEqual(seenFields);
      pose.position.forEach((v, i) => {
        expect(v, `${id} position ${i}`).toBeCloseTo(seenPose.position[i]!, 4);
      });
      const mine = door.parts.get(id)!.object;
      const theirs = visitor.parts.get(id)!.object;
      mine.matrixWorld.elements.forEach((v, i) => {
        expect(v, `${id} matrix ${i}`).toBeCloseTo(
          theirs.matrixWorld.elements[i]!,
          3,
        );
      });
      theirs.parent!.matrixWorld.elements.forEach((v, i) => {
        expect(
          mine.parent!.matrixWorld.elements[i]!,
          `${id} frame ${i}`,
        ).toBeCloseTo(v, 3);
      });
    }
    // The viewpoint, in the frame its part stands in, is 1.6 m above the
    // station's ground, not 1.6 m above the session's zero.
    const then = door.parts.get("then")!.object;
    const eye = then.parent!.localToWorld(new Vector3(0, 1.6, -3));
    const ground = objectPoseNue(station.geo, ZERO).positionNue[1];
    expect(eye.y).toBeCloseTo(ground + 1.6, 2);
    // The folder draws its arrow twice as large; the model at the top at 1.
    expect(door.parts.get("arrow")!.object.scale.x).toBeCloseTo(2, 6);
    expect(door.parts.get("arch")!.object.scale.x).toBeCloseTo(1, 6);
  });

  // Why this test matters: a tap selects by casting the camera's ray at
  // each preview's root (`object-pick.ts`); the e2e's pick is scripted, so
  // only here does a real ray meet a real part. A model's preview must
  // hold its mesh where the ray can hit it, and a root the door drew
  // nothing into must not be hit.
  it("is hit by a real ray at its drawn model, and an empty root is not", async () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const modelScene = new Group();
    modelScene.add(mesh);
    const arch = tourObjects(manifest).find((o) => o.id === "arch")!;
    const h = harness([hosted(arch)], { manifest, modelScene });
    h.previews.sync();
    await h.settled();
    await modelLoaded(h);
    h.scene.updateMatrixWorld(true);
    const root = h.ctx.placedPreviews.get("arch")!.root;
    const at = mesh.getWorldPosition(new Vector3());
    const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(at.x - 6, at.y, at.z);
    camera.lookAt(at);
    camera.updateMatrixWorld(true);
    expect(pickObject(camera, new Map([["arch", root]]))).toBe("arch");
    // The control: the same item where the door draws nothing.
    const none = harness([hosted(arch)], {
      manifest,
      drawings: { ...recordingDoor().drawings, worldPart: () => null },
    });
    none.previews.sync();
    await none.settled();
    none.scene.updateMatrixWorld(true);
    const empty = none.ctx.placedPreviews.get("arch")!.root;
    expect(pickObject(camera, new Map([["arch", empty]]))).toBeNull();
  });
});

/** Lets a model part's load land (its `ready`, a few awaits deep). */
async function modelLoaded(h: { settled(): Promise<void> }): Promise<void> {
  for (let i = 0; i < 4; i += 1) await h.settled();
}
