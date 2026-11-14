import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import { describe, expect, it } from "vitest";
import { withFreeBlocks } from "./test-support/station-content.js";
import fc from "fast-check";
import {
  BoxGeometry,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Texture,
  Vector3,
} from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  deriveVerticalHeading,
  mintQrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import type {
  TourAsset,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import {
  mintPhoto,
  mintPin,
  newObjectId,
  objectPoseNue,
  renderTourObjects,
  renderTourStation,
  renderStationBlocks,
  rotationFromHeading,
  uprightTurn,
} from "./content-placement";
import { mountedModelViews } from "./model-views";
import {
  mountedWorldParts,
  unmountWorldPart,
  worldEnv,
  type WorldPart,
} from "./world-part";
import { worldPartOf } from "./play-kinds";

/** Lets the files a world part asked for land: the renderer never waits
 *  for them (a model holds back no other block). */
function filesLanded(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The visitor's world door for models: each file is read by its path,
 *  and `parse` turns the path into the model (or fails). */
function modelDoor(
  assets: readonly TourAsset[],
  parse: (path: string) => Promise<Object3D>,
  enableClipping: () => void = () => undefined,
) {
  const env = worldEnv(
    "play",
    assets,
    (path) => Promise.resolve(new Blob([path])),
    { parseModel: async (blob) => parse(await blob.text()), enableClipping },
  );
  return (block: TourBlock) => worldPartOf(block, env);
}
import { contentSegment } from "./tour-flow";
import { stationContent } from "./test-support/station-content.js";

/**
 * Why these tests matter: a placed object's record is what a visitor sees
 * days later on another phone. A pin minted from the wrong frame or a
 * photo composed with the trailing basis form (right for replayed state,
 * wrong for a raw pose - the geo-join review's 90° bug) lands metres away
 * with no error anywhere. The round trip (mint → NUE pose in the same
 * frame) and the frame direction are pinned by bearing, not by matrix
 * components, like the level's own tests.
 */

// The geodesy is licence-gated; the store's construction activates it (the
// same activation main.ts performs at boot).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const ZERO = { lat: 47.5, lon: 8.7 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const NOW = "2026-09-08T16:00:00.000Z";

function bearingDeg(n: number, e: number): number {
  return ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
}

describe("mintPin / objectPoseNue", () => {
  it("round-trips a reticle position through geo and back to the same NUE metres", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: 300, max: 500, noNaN: true }),
        fc.double({ min: -200, max: 200, noNaN: true }),
        (x, y, z) => {
          const pin = mintPin({
            id: "p",
            label: "Gate",
            worldNuePosition: { x, y, z },
            zero: ZERO,
            nowIso: NOW,
          });
          expect(pin).not.toBeNull();
          const back = objectPoseNue(pin!.geo, ZERO);
          expect(back.positionNue[0]).toBeCloseTo(x, 2);
          expect(back.positionNue[1]).toBeCloseTo(y, 4);
          expect(back.positionNue[2]).toBeCloseTo(z, 2);
          expect(back.rotationNue).toEqual([0, 0, 0, 1]);
        },
      ),
    );
  });

  it("carries a description when one is given, and none for a blank one", () => {
    // Why this test matters: the phone's pin entry passes the typed
    // description through here; a blank one must leave the key out, as
    // the format's reader refuses a blank optional text.
    const base = {
      id: "p",
      label: "Gate",
      worldNuePosition: { x: 0, y: 400, z: 0 },
      zero: ZERO,
      nowIso: NOW,
    };
    expect(mintPin({ ...base, description: "The old gate." })).toMatchObject({
      caption: "Gate",
      description: "The old gate.",
    });
    expect(mintPin({ ...base, description: "" })).not.toHaveProperty(
      "description",
    );
    expect(mintPin(base)).not.toHaveProperty("description");
  });

  it("refuses without a GPS zero", () => {
    expect(
      mintPin({
        id: "p",
        label: "x",
        worldNuePosition: { x: 0, y: 0, z: 0 },
        zero: null,
        nowIso: NOW,
      }),
    ).toBeNull();
  });
});

describe("mintPhoto", () => {
  it("composes a RAW camera pose through the leading basis (alignment · WEBXR_TO_NUE · pose), pinned by bearing", () => {
    // 10 m straight ahead in WebXR (-z). Under the identity alignment the
    // photo lands where the basis change puts that vector - the framework's
    // constant is the oracle, so a trailing-form regression (a 90° yaw)
    // fails here without restating any matrix component.
    const photo = mintPhoto({
      id: "f",
      cameraPose: { position: [0, 0, -10], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY,
      zero: ZERO,
      imageWidth: 1024,
      imageHeight: 768,
      nowIso: NOW,
    });
    expect(photo).not.toBeNull();
    const nue = calcRelativeCoordsInMeters(
      ZERO,
      { lat: photo!.geo.lat, lon: photo!.geo.lon },
      photo!.geo.alt,
      0,
    );
    const expected = new Vector3(0, 0, -10).applyMatrix4(WEBXR_TO_NUE);
    expect(Math.hypot(nue[0], nue[2])).toBeCloseTo(10, 1);
    expect(bearingDeg(nue[0], nue[2])).toBeCloseTo(
      bearingDeg(expected.x, expected.z),
      0,
    );
    expect(photo!.image).toBe("f");
    expect(photo!.imageAsset.path).toBe("content/f.jpg");
    expect(photo!.geo.rotation).toHaveLength(4);
  });

  it("refuses without an alignment or a zero", () => {
    const base = {
      id: "f",
      cameraPose: {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
      imageWidth: 1,
      imageHeight: 1,
      nowIso: NOW,
    };
    expect(
      mintPhoto({ ...base, alignmentMatrix: null, zero: ZERO }),
    ).toBeNull();
    expect(
      mintPhoto({ ...base, alignmentMatrix: IDENTITY, zero: null }),
    ).toBeNull();
  });
});

describe("rotationFromHeading", () => {
  it("round-trips through the framework's heading derivation (property)", () => {
    // Why this matters (M4 review #9): a heading-only pose in a hand-edited
    // tour.json used to render facing East. The framework owns the
    // convention; its derivation is the oracle.
    fc.assert(
      fc.property(fc.double({ min: 0, max: 359.9, noNaN: true }), (h) => {
        const derived = deriveVerticalHeading([...rotationFromHeading(h)]);
        expect(derived).toBeDefined();
        const delta = Math.abs((((derived ?? 0) - h + 540) % 360) - 180);
        expect(delta).toBeLessThan(1e-6);
      }),
    );
    expect(
      objectPoseNue({ lat: 47.5, lon: 8.7, alt: 1, headingDeg: 90 }, ZERO)
        .rotationNue,
    ).toEqual(rotationFromHeading(90));
  });
});

describe("uprightTurn", () => {
  // Why this matters: a reading stand keeps only its pose's turn about up
  // on every page that draws it (the phone's renderer and the 3D editor's
  // drag preview share this one rule); a pitch or roll left in would tilt
  // it off its feet, and a turn lost would face it the wrong way.
  it("keeps a pose's turn about up and drops its pitch and roll (property)", () => {
    const deg = fc.double({ min: -80, max: 80, noNaN: true });
    fc.assert(
      fc.property(
        fc.double({ min: -179, max: 179, noNaN: true }),
        deg,
        deg,
        (yaw, pitch, roll) => {
          const rad = Math.PI / 180;
          const q = new Quaternion().setFromEuler(
            new Euler(pitch * rad, yaw * rad, roll * rad, "YXZ"),
          );
          const up = uprightTurn([q.x, q.y, q.z, q.w]);
          // Its up stays up, and its turn is the pose's.
          expect(new Vector3(0, 1, 0).applyQuaternion(up).y).toBeCloseTo(1, 9);
          const expected = new Quaternion().setFromEuler(
            new Euler(0, yaw * rad, 0, "YXZ"),
          );
          expect(up.angleTo(expected)).toBeLessThan(1e-6);
        },
      ),
    );
  });
});

describe("newObjectId", () => {
  it("is 12 path-safe characters, distinct across draws (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.999999, noNaN: true }), {
          minLength: 12,
          maxLength: 12,
        }),
        (draws) => {
          let i = 0;
          const id = newObjectId(() => draws[i++ % 12] ?? 0);
          expect(id).toMatch(/^[a-z0-9]{12}$/);
        },
      ),
    );
    expect(newObjectId()).not.toBe(newObjectId());
  });
});

describe("renderTourObjects", () => {
  function fakeScene() {
    const children: Object3D[] = [];
    return {
      scene: {
        add: (o: Object3D) => {
          children.push(o);
        },
        remove: (o: Object3D) => {
          const i = children.indexOf(o);
          if (i >= 0) children.splice(i, 1);
        },
      } as unknown as Object3D,
      children,
    };
  }

  it("adds nothing to the scene before the last photo decoded (M5 review #6)", async () => {
    const { scene, children } = fakeScene();
    const pin = mintPin({
      id: "p",
      label: "Gate",
      worldNuePosition: { x: 5, y: 400, z: 0 },
      zero: ZERO,
      nowIso: NOW,
    })!;
    const photo = mintPhoto({
      id: "g",
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY,
      zero: ZERO,
      imageWidth: 4,
      imageHeight: 3,
      nowIso: NOW,
    })!;
    let release: (t: Texture) => void = () => undefined;
    const pending = renderTourObjects([pin, photo], {
      scene,
      zero: ZERO,
      makeLabel: () => ({ object: new Object3D(), dispose: () => undefined }),
      loadPhotoTexture: () =>
        new Promise<Texture>((resolve) => {
          release = resolve;
        }),
    });
    await Promise.resolve();
    expect(children).toHaveLength(0);
    release(new Texture());
    await pending;
    expect(children).toHaveLength(1);
  });

  it("places pins as labels and photos as planes at their NUE poses, skips a photo whose texture failed, and disposes everything", async () => {
    const { scene, children } = fakeScene();
    const disposed: string[] = [];
    const pin = mintPin({
      id: "p",
      label: "Gate",
      worldNuePosition: { x: 5, y: 400, z: 0 },
      zero: ZERO,
      nowIso: NOW,
    })!;
    const good = mintPhoto({
      id: "g",
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY,
      zero: ZERO,
      imageWidth: 4,
      imageHeight: 3,
      nowIso: NOW,
    })!;
    const bad = {
      ...good,
      id: "b",
      image: "b",
      imageAsset: { ...good.imageAsset, id: "b", path: "content/b.jpg" },
    };
    const rendered = await renderTourObjects([pin, good, bad], {
      scene,
      zero: ZERO,
      makeLabel: (text) => {
        const object = new Object3D();
        object.name = `label:${text}`;
        return {
          object,
          dispose: () => {
            disposed.push(text);
          },
        };
      },
      loadPhotoTexture: (name) =>
        Promise.resolve(name === "content/g.jpg" ? new Texture() : null),
    });
    expect(rendered.count).toBe(2);
    expect(rendered.skipped).toEqual(["b"]);
    // ONE group at the root (M5 review #6): nothing is in the scene until
    // every photo decoded, so a session ending mid-run owns no strays.
    expect(children).toHaveLength(1);
    const group = children[0];
    expect(group?.children).toHaveLength(2);
    const label = group?.children.find((c) => c.name === "label:Gate");
    expect(label?.position.x).toBeCloseTo(5, 2);
    expect(label?.position.y).toBeCloseTo(400, 4);
    rendered.dispose();
    expect(children).toHaveLength(0);
    expect(disposed).toEqual(["Gate"]);
  });

  // Why: a placed 3D model (format minor 1) is in the format before any
  // renderer draws it. It must not reach the photo loader (it has no
  // image), and it is not a failure either: "could not load" would claim
  // a download broke, so it is left out quietly, as a lenient read leaves
  // out what it cannot show. The renderer milestone adds an honest line.
  it("leaves a placed 3D model out quietly: no photo loader call, no 'could not load'", async () => {
    const { scene, children } = fakeScene();
    const pin = mintPin({
      id: "p",
      label: "Gate",
      worldNuePosition: { x: 5, y: 400, z: 0 },
      zero: ZERO,
      nowIso: NOW,
    })!;
    const model: TourObject = {
      id: "m",
      kind: "model",
      view: "placed",
      asset: "statue",
      sizeM: 3,
      createdAtIso: NOW,
      geo: pin.geo,
    };
    const asked: string[] = [];
    const rendered = await renderTourObjects([pin, model], {
      scene,
      zero: ZERO,
      makeLabel: () => ({ object: new Object3D(), dispose: () => undefined }),
      loadPhotoTexture: (name) => {
        asked.push(name);
        return Promise.resolve(new Texture());
      },
    });
    expect(asked).toEqual([]);
    expect(rendered.count).toBe(1);
    expect(rendered.skipped).toEqual([]);
    expect(children[0]?.children).toHaveLength(1);
    expect(
      contentSegment({
        kind: "placed",
        count: rendered.count,
        skipped: rendered.skipped.length,
      }),
    ).toBe("1 placed object");
  });

  it("draws a short text by its view: only a pin is a label", async () => {
    // Why this test matters: a tour's objects carry every world view of a
    // short text, and the creator's previews draw them through this
    // renderer. A sign, an edge hint or a ground arrow drawn as a pin's
    // label would show the creator something the visitor never sees; the
    // station renderer's rules apply, and with no world door here those
    // views are left out quietly.
    const { scene, children } = fakeScene();
    const pin = mintPin({
      id: "p",
      label: "Gate",
      worldNuePosition: { x: 5, y: 400, z: 0 },
      zero: ZERO,
      nowIso: NOW,
    })!;
    const others: TourObject[] = (["sign", "edgeHint", "ground"] as const).map(
      (view) => ({ ...pin, id: view, view, caption: view }),
    );
    const labels: string[] = [];
    const rendered = await renderTourObjects([pin, ...others], {
      scene,
      zero: ZERO,
      makeLabel: (text) => {
        labels.push(text);
        return { object: new Object3D(), dispose: () => undefined };
      },
      loadPhotoTexture: () => Promise.resolve(new Texture()),
    });
    expect(labels).toEqual(["Gate"]);
    expect(rendered.count).toBe(1);
    expect(rendered.skipped).toEqual([]);
    expect(children[0]?.children).toHaveLength(1);
  });

  it("draws a picture by its view: a plane, or a viewpoint view without its viewpoint", async () => {
    // Why this test matters: a tour's objects carry every world view of a
    // picture, and the creator's previews draw them through this
    // renderer. A framed print, a cut-out or a picture lined up from its
    // viewpoint drawn as a bare plane would show the creator something the
    // visitor never sees; the station renderer's rules apply (a viewpoint
    // view without a viewpoint is a plane, as the format reads it), and
    // with no world door here the other views are left out quietly.
    const { scene, children } = fakeScene();
    const photo = mintPhoto({
      id: "plane",
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY,
      zero: ZERO,
      imageWidth: 4,
      imageHeight: 3,
      nowIso: NOW,
    })!;
    const viewpoint = {
      position: [0, 1.6, 4],
      rotation: [0, 0, 0, 1],
      hfovDeg: 60,
      distanceM: 4,
    } as const;
    const others: TourObject[] = [
      { ...photo, id: "framed", view: "framed" },
      { ...photo, id: "cutout", view: "cutout" },
      { ...photo, id: "lined-up", view: "thenNow", viewpoint },
      { ...photo, id: "no-viewpoint", view: "window" },
    ];
    const loaded: string[] = [];
    const rendered = await renderTourObjects([photo, ...others], {
      scene,
      zero: ZERO,
      makeLabel: () => ({ object: new Object3D(), dispose: () => undefined }),
      loadPhotoTexture: (name) => {
        loaded.push(name);
        return Promise.resolve(new Texture());
      },
    });
    expect(rendered.count).toBe(2);
    expect(rendered.skipped).toEqual([]);
    expect(loaded).toHaveLength(2);
    expect(children[0]?.children).toHaveLength(2);
  });

  it("places pins and photos at the caller's pose in the caller's frame when it passes one", async () => {
    // Why this test matters (authoring plan 2026-09-28-0953, M2c): the
    // creator's previews of the running visit go under the AR world group
    // at their ODOMETRY pose, so they stay rigid while GPS re-solves. The
    // geo-derived pose is right for the scene root only; handed to a child
    // of the world group it would apply the alignment twice.
    const { scene, children } = fakeScene();
    const pin = mintPin({
      id: "p",
      label: "Gate",
      worldNuePosition: { x: 5, y: 400, z: 0 },
      zero: ZERO,
      nowIso: NOW,
    })!;
    const photo = mintPhoto({
      id: "g",
      cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      alignmentMatrix: IDENTITY,
      zero: ZERO,
      imageWidth: 4,
      imageHeight: 3,
      nowIso: NOW,
    })!;
    const turned: [number, number, number, number] = [
      0,
      Math.SQRT1_2,
      0,
      Math.SQRT1_2,
    ];
    await renderTourObjects([pin, photo], {
      scene,
      zero: ZERO,
      poseOf: (object) =>
        object.kind === "shortText"
          ? { positionNue: [2, 0, -1], rotationNue: [0, 0, 0, 1] }
          : { positionNue: [0.5, 1.4, 3], rotationNue: turned },
      makeLabel: (text) => {
        const object = new Object3D();
        object.name = `label:${text}`;
        return { object, dispose: () => undefined };
      },
      loadPhotoTexture: () => Promise.resolve(new Texture()),
    });
    const group = children[0];
    const label = group?.children.find((c) => c.name === "label:Gate");
    expect(label?.position.toArray()).toEqual([2, 0, -1]);
    const plane = group?.children.find((c) => c !== label);
    expect(plane?.position.toArray()).toEqual([0.5, 1.4, 3]);
    expect(plane?.quaternion.angleTo(new Quaternion(...turned))).toBeLessThan(
      1e-9,
    );
  });
});

describe("renderTourStation", () => {
  // Why these tests matter (tour editor plan 2026-10-17-1816, W3): a
  // version 3 tour stores each pin and photo RELATIVE to its station, and
  // the viewer plays it as one group per station with the items as its
  // children - so a station's move (D17) moves its items by construction.
  // The local poses come from each object's settled geo pose at the
  // Finish; these tests pin that the station frame reproduces the pose
  // the viewer placed each object at before (`objectPoseNue` of its geo),
  // within a stated tolerance, wherever the session's zero is.

  const labelStub = (text: string) => {
    const object = new Object3D();
    object.name = `label:${text}`;
    return { object, dispose: () => undefined };
  };

  /** A geo pose `n`, `u`, `e` metres from `at`, turned by `q`. */
  function geoAt(
    at: { lat: number; lon: number; alt: number },
    n: number,
    u: number,
    e: number,
    q: [number, number, number, number],
  ) {
    return mintQrGeoPose({
      worldNuePosition: { x: n, y: at.alt + u, z: e },
      worldNueRotation: q,
      zero: { lat: at.lat, lon: at.lon },
    });
  }

  function yaw(deg: number): [number, number, number, number] {
    const half = (deg * Math.PI) / 360;
    return [0, Math.sin(half), 0, Math.cos(half)];
  }

  function stationAt(
    id: string,
    geo: TourStation["geo"],
    items: TourBlock[],
  ): TourStation {
    return {
      id,
      geo,
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      ...stationContent(items),
    };
  }

  /** The image assets of captured photos with these ids, as a tour lists
   *  them (`content/<id>.jpg`). */
  function photoAssets(...ids: string[]): TourAsset[] {
    return ids.map((id) => ({
      id,
      path: `content/${id}.jpg`,
      kind: "image",
      width: 4,
      height: 3,
    }));
  }

  // Why: a picture's widthM is its real width in the world, in the
  // visitor and in the 3D editor (both draw through this renderer). The
  // plane used to be 1 m wide whatever the file said; a 1 m picture must
  // stay exactly as it was.
  it("draws a picture plane its widthM wide, a 1 m one unchanged", async () => {
    const geo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 0, yaw(0));
    const picture = (id: string, widthM: number) => ({
      id,
      kind: "picture" as const,
      view: "plane" as const,
      image: id,
      widthM,
      createdAtIso: NOW,
      pose: {
        position: [0, 1.4, 3] as [number, number, number],
        rotation: yaw(0),
      },
    });
    const texture = () => {
      const t = new Texture();
      t.image = { width: 4, height: 3 };
      return t;
    };
    const rendered = await renderTourStation(
      stationAt("s", geo, [picture("one", 1), picture("three", 3)]),
      {
        assets: photoAssets("one", "three"),
        scene: new Group(),
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(texture()),
      },
    );
    const planes = rendered.root.children[0]!.children;
    const byId = (id: string) =>
      planes.find((p) => p.userData["objectId"] === id)!;
    expect(byId("one").scale.x).toBeCloseTo(1, 10);
    expect(byId("one").scale.y).toBeCloseTo(0.75, 10);
    expect(byId("three").scale.x).toBeCloseTo(3, 10);
    expect(byId("three").scale.y).toBeCloseTo(2.25, 10);
    rendered.dispose();
  });

  // Why: a placed model stands through the world door like every other
  // kind, at the size the tour names (`sizeM`, its largest side) by the
  // one shared scale rule (`modelScale`), its part at its local pose in
  // the station's frame; a model whose file fails is named in `skipped`,
  // and a renderer given no door leaves it out quietly.
  it("draws a placed model at its sizeM by the shared scale rule, at its local pose", async () => {
    const scene = new Group();
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 5, yaw(0));
    const pose = {
      position: [1, 0, 2] as [number, number, number],
      rotation: yaw(30),
    };
    const model = (id: string, asset: string, sizeM: number) => ({
      id,
      kind: "model" as const,
      view: "placed" as const,
      asset,
      sizeM,
      createdAtIso: NOW,
      pose,
    });
    const station = stationAt("s", stationGeo, [
      model("m1", "horse", 3),
      model("m2", "broken", 1),
    ]);
    const assets: TourAsset[] = [
      { id: "horse", path: "content/horse.glb", kind: "model" },
      { id: "broken", path: "content/broken.glb", kind: "model" },
    ];
    const loaded: string[] = [];
    let disposed = 0;
    const geometry = new BoxGeometry(2, 0.5, 1);
    geometry.dispose = () => {
      disposed += 1;
    };
    const rendered = await renderTourStation(station, {
      assets,
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
      worldPart: modelDoor(assets, (entry) => {
        loaded.push(entry);
        return entry === "content/horse.glb"
          ? Promise.resolve(new Mesh(geometry))
          : Promise.reject(new Error("bad glb"));
      }),
    });
    // The station stands before its files arrive; once they have, the
    // broken one is gone and named.
    await filesLanded();
    expect(loaded).toEqual(["content/horse.glb", "content/broken.glb"]);
    expect(rendered.count).toBe(1);
    expect(rendered.skipped).toEqual(["m2"]);
    let found: Object3D | undefined;
    rendered.root.traverse((o) => {
      if (o.userData["objectId"] === "m1") found = o;
    });
    expect(found, "the model is drawn under the station").toBeDefined();
    // Its largest side (2 m) made 3 m: the factor 1.5, the editor's rule,
    // on the model in the part; the part is at the pose.
    expect(found!.children[0]?.scale.x).toBeCloseTo(1.5, 12);
    expect(found!.position.toArray()).toEqual([1, 0, 2]);
    expect(found!.quaternion.toArray()).toEqual(pose.rotation);
    rendered.dispose();
    expect(disposed, "its geometry is freed with the station").toBe(1);

    // No door: left out quietly.
    const quiet = await renderTourStation(station, {
      assets,
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
    });
    expect(quiet.count).toBe(0);
    expect(quiet.skipped).toEqual([]);
    quiet.dispose();
  });

  // Why: a model file can be large, and the other blocks of its station
  // must never wait for it. The pin stands (and the station's group is in
  // the scene) while the model still loads; a load that then fails takes
  // only the model's part away - freed, unmounted, out of the group,
  // named in `skipped` and no longer counted - and a station freed while
  // its model still loads frees the part once, ignoring a late failure.
  it("shows a station's other blocks before its model loads, and drops a model that fails later", async () => {
    const scene = new Group();
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 5, yaw(0));
    const pose = {
      position: [1, 0, 2] as [number, number, number],
      rotation: yaw(0),
    };
    const pin = {
      id: "pin",
      kind: "shortText" as const,
      view: "pin" as const,
      caption: "Here",
      pose,
    };
    const model = {
      id: "m",
      kind: "model" as const,
      view: "placed" as const,
      asset: "horse",
      sizeM: 2,
      createdAtIso: NOW,
      pose,
    };
    const assets: TourAsset[] = [
      { id: "horse", path: "content/horse.glb", kind: "model" },
    ];
    const pending: ((error: Error) => void)[] = [];
    const door = modelDoor(
      assets,
      () =>
        new Promise<Object3D>((_resolve, reject) => {
          pending.push(reject);
        }),
    );
    let partDisposed = 0;
    const counted = (block: TourBlock) => {
      const part = door(block);
      if (part === null) return null;
      const dispose = part.dispose.bind(part);
      part.dispose = () => {
        partDisposed += 1;
        dispose();
      };
      return part;
    };
    const rendered = await renderTourStation(
      stationAt("s", stationGeo, [pin, model]),
      {
        assets,
        scene,
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
        worldPart: counted,
      },
    );
    await filesLanded();
    expect(pending, "the model still loads").toHaveLength(1);
    const ids = () => {
      const found: unknown[] = [];
      rendered.root.traverse((o) => {
        if (o.userData["objectId"] !== undefined) {
          found.push(o.userData["objectId"]);
        }
      });
      return found;
    };
    expect(scene.children).toContain(rendered.root);
    expect(ids()).toEqual(["pin", "m"]);
    expect(rendered.count).toBe(2);
    const part = mountedWorldParts().at(-1);
    expect(part?.object.userData["objectId"]).toBe("m");

    pending[0]!(new Error("bad glb"));
    await filesLanded();
    expect(ids()).toEqual(["pin"]);
    expect(rendered.count).toBe(1);
    expect(rendered.skipped).toEqual(["m"]);
    expect(partDisposed).toBe(1);
    expect(mountedWorldParts()).not.toContain(part);
    rendered.dispose();
    expect(partDisposed, "freed once, not again with the station").toBe(1);

    // Freed while loading: the part goes with the station, and the late
    // failure neither frees it again nor names it.
    const early = await renderTourStation(
      stationAt("s", stationGeo, [pin, model]),
      {
        assets,
        scene,
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
        worldPart: counted,
      },
    );
    await filesLanded();
    early.dispose();
    expect(partDisposed).toBe(2);
    pending[1]!(new Error("bad glb"));
    await filesLanded();
    expect(partDisposed).toBe(2);
    expect(early.skipped).toEqual([]);
  });

  // Why: a part's `ready` can reject while the renderer still decodes
  // the blocks after it (a photo crosses tasks), or a later block can
  // throw before the station stands at all. Either way the rejection must
  // be handled the moment the part is placed: an unhandled rejection is
  // reported as a crash. A part whose free throws on that path is still
  // taken out of the station, quietly.
  it("handles a part's early rejection while later blocks decode, after a throw, and when its free throws", async () => {
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 5, yaw(0));
    const pose = {
      position: [1, 0, 2] as [number, number, number],
      rotation: yaw(0),
    };
    const model = {
      id: "m",
      kind: "model" as const,
      view: "placed" as const,
      asset: "horse",
      sizeM: 2,
      createdAtIso: NOW,
      pose,
    };
    const photo = {
      id: "p",
      kind: "picture" as const,
      view: "plane" as const,
      image: "g",
      widthM: 1,
      createdAtIso: NOW,
      pose,
    };
    const pin = {
      id: "pin",
      kind: "shortText" as const,
      view: "pin" as const,
      caption: "Here",
      pose,
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const failing = (throwOnFree: boolean) => () => {
        const part: WorldPart = {
          object: new Group(),
          ready: Promise.reject(new Error("bad glb")),
          dispose: () => {
            if (throwOnFree) throw new Error("free failed");
          },
        };
        return part;
      };
      // A photo that decodes a task later, after the rejection.
      const slowPhoto = () =>
        new Promise<Texture>((resolve) =>
          setTimeout(() => resolve(new Texture()), 5),
        );
      for (const throwOnFree of [false, true]) {
        const rendered = await renderTourStation(
          stationAt("s", stationGeo, [model, photo]),
          {
            assets: photoAssets("g"),
            scene: new Group(),
            zero: ZERO,
            makeLabel: labelStub,
            loadPhotoTexture: slowPhoto,
            worldPart: failing(throwOnFree),
          },
        );
        await filesLanded();
        expect(rendered.skipped).toEqual(["m"]);
        expect(rendered.count).toBe(1);
        expect(
          mountedWorldParts().map(
            (p): unknown => p.object.userData["objectId"],
          ),
        ).not.toContain("m");
        rendered.dispose();
      }

      // A later block throws: the part is freed with the construction, and
      // its rejection is still handled.
      let throwingLabel = 0;
      await expect(
        renderTourStation(stationAt("s", stationGeo, [model, pin]), {
          assets: [],
          scene: new Group(),
          zero: ZERO,
          makeLabel: () => {
            throwingLabel += 1;
            throw new Error("no canvas");
          },
          loadPhotoTexture: slowPhoto,
          worldPart: failing(false),
        }),
      ).rejects.toThrow("no canvas");
      expect(throwingLabel).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  // Why (station blocks, the reading stand): a long text in the
  // `lectern` view stands at its local pose and keeps it (it does not
  // turn to the visitor), drawn by the page's builder (a canvas, so the
  // caller's); with no builder (the 3D editor, the creator's previews)
  // it is left out quietly, never reported as a failed download.
  it("draws a reading stand at its local pose through the page's builder, and leaves it out without one", async () => {
    const scene = new Group();
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 5, yaw(0));
    const pose = {
      position: [1, 0, 2] as [number, number, number],
      rotation: yaw(30),
    };
    const station = stationAt("s", stationGeo, [
      {
        id: "stand",
        kind: "longText" as const,
        view: "lectern" as const,
        title: "The guild house",
        body: "It *burned* in 1612.",
        pose,
      },
    ]);
    const made: { id: string; title: string; body: string }[] = [];
    let disposed = 0;
    const rendered = await renderTourStation(station, {
      assets: [],
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
      makeLectern: (block) => {
        made.push(block);
        return {
          object: new Group(),
          dispose: () => {
            disposed += 1;
          },
        };
      },
    });
    expect(made).toEqual([
      { id: "stand", title: "The guild house", body: "It *burned* in 1612." },
    ]);
    expect(rendered.count).toBe(1);
    let found: Object3D | undefined;
    rendered.root.traverse((o) => {
      if (o.userData["objectId"] === "stand") found = o;
    });
    expect(found, "the stand is drawn under the station").toBeDefined();
    expect(found!.position.toArray()).toEqual([1, 0, 2]);
    // Its turn about up, re-derived from the pose (to the last bit or so).
    expect(
      found!.quaternion.angleTo(new Quaternion(...pose.rotation)),
    ).toBeLessThan(1e-6);
    rendered.dispose();
    expect(disposed).toBe(1);

    // A pose that also pitches and rolls: the stand keeps its turn about
    // up only (the prototype's), standing upright on its feet.
    const tilted = await renderTourStation(
      stationAt("s", stationGeo, [
        {
          id: "stand",
          kind: "longText" as const,
          view: "lectern" as const,
          title: "The guild house",
          body: "It burned.",
          pose: {
            position: [1, 0, 2] as [number, number, number],
            rotation: new Quaternion()
              .setFromEuler(new Euler(0.4, (30 * Math.PI) / 180, -0.3, "YXZ"))
              .toArray(),
          },
        },
      ]),
      {
        assets: [],
        scene,
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
        makeLectern: () => ({ object: new Group(), dispose: () => undefined }),
      },
    );
    let upright: Object3D | undefined;
    tilted.root.traverse((o) => {
      if (o.userData["objectId"] === "stand") upright = o;
    });
    const want = new Quaternion(...yaw(30));
    expect(upright!.quaternion.angleTo(want)).toBeLessThan(1e-6);
    tilted.dispose();

    const quiet = await renderTourStation(station, {
      assets: [],
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
    });
    expect([quiet.count, quiet.skipped]).toEqual([0, []]);
    quiet.dispose();
  });

  // Why (station blocks, the reading sign): a long text in the `reading`
  // view stands at its local pose as a short sign drawn by the page's
  // builder, not as a reading stand; with no builder it is left out
  // quietly, as a stand is.
  it("draws a reading sign at its local pose through the page's builder, and leaves it out without one", async () => {
    const scene = new Group();
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 5, yaw(0));
    const station = stationAt("s", stationGeo, [
      {
        id: "sign",
        kind: "longText" as const,
        view: "reading" as const,
        title: "The guild house",
        body: "It burned in 1612.",
        pose: {
          position: [3, 0, -1] as [number, number, number],
          rotation: yaw(0),
        },
      },
    ]);
    const signs: string[] = [];
    let stands = 0;
    let disposed = 0;
    const rendered = await renderTourStation(station, {
      assets: [],
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
      makeLectern: () => {
        stands += 1;
        return { object: new Group(), dispose: () => undefined };
      },
      makeReadingSign: (block) => {
        signs.push(`${block.id}:${block.title}:${block.body}`);
        return {
          object: new Group(),
          dispose: () => {
            disposed += 1;
          },
        };
      },
    });
    expect(signs).toEqual(["sign:The guild house:It burned in 1612."]);
    expect(stands).toBe(0);
    expect(rendered.count).toBe(1);
    let found: Object3D | undefined;
    rendered.root.traverse((o) => {
      if (o.userData["objectId"] === "sign") found = o;
    });
    expect(found?.position.toArray()).toEqual([3, 0, -1]);
    rendered.dispose();
    expect(disposed).toBe(1);

    const quiet = await renderTourStation(station, {
      assets: [],
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
    });
    expect([quiet.count, quiet.skipped]).toEqual([0, []]);
    quiet.dispose();
  });

  // Why (station blocks, the visitor's view preference): the visitor's
  // page draws a block in the view `viewOf` names (a reading sign as a
  // stand, design §4) at the same pose; a visitor's captions stand as the
  // reading sign (the strip is the page's); a view no world drawing has
  // is nothing, and without `viewOf` the creator's view is drawn.
  it("draws a block in the view viewOf names, at the same pose", async () => {
    const scene = new Group();
    const station = stationAt(
      "s",
      geoAt({ ...ZERO, alt: 400 }, 0, 0, 0, yaw(0)),
      [
        {
          id: "sign",
          kind: "longText" as const,
          view: "reading" as const,
          title: "The guild house",
          body: "It burned in 1612.",
          pose: {
            position: [3, 0, -1] as [number, number, number],
            rotation: yaw(0),
          },
        },
      ],
    );
    const drawn: string[] = [];
    const make = (as: string) => (block: { readonly id: string }) => {
      drawn.push(`${as}:${block.id}`);
      return { object: new Group(), dispose: () => undefined };
    };
    const deps = {
      assets: [],
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
      makeLectern: make("lectern"),
      makeReadingSign: make("reading"),
    };
    const swapped = await renderTourStation(station, {
      ...deps,
      viewOf: (block) => (block.view === "reading" ? "lectern" : block.view),
    });
    let found: Object3D | undefined;
    swapped.root.traverse((o) => {
      if (o.userData["objectId"] === "sign") found = o;
    });
    expect(found?.position.toArray()).toEqual([3, 0, -1]);
    swapped.dispose();
    const none = await renderTourStation(station, {
      ...deps,
      viewOf: () => "silent",
    });
    expect(none.count).toBe(0);
    none.dispose();
    (
      await renderTourStation(station, { ...deps, viewOf: () => "captions" })
    ).dispose();
    (await renderTourStation(station, deps)).dispose();
    expect(drawn).toEqual(["lectern:sign", "reading:sign", "reading:sign"]);
  });

  // Why: a block no other drawing has is asked of the page's world door
  // (the kinds' rows, `worldPartOf`), whatever its kind: a kind gets a
  // look in the world by its row alone, with no arm here. Without the door
  // nothing stands, because a stand-in would be a marker nobody chose. An
  // empty object is a part too (a sound zone shows nothing): placed at its
  // pose, mounted while it stands, freed and unmounted with the station.
  it("asks the page's world door for every block no drawing has, and places what it gives", async () => {
    const scene = new Group();
    const pose = {
      position: [1, 2, 3] as [number, number, number],
      rotation: yaw(0),
    };
    const base = {
      geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 0, rotation: yaw(0) },
      children: [],
    };
    const station = withFreeBlocks(base, [
      {
        id: "film",
        kind: "video",
        view: "card",
        video: "v",
        transcript: "t",
        pose,
      },
      {
        id: "song",
        kind: "audio",
        view: "card",
        audio: "a",
        transcript: "t",
        pose,
      },
      {
        id: "ann",
        kind: "character",
        view: "speak",
        name: "Ann",
        image: "i",
        caption: "Hi",
        pose,
      },
    ]);
    const deps = {
      assets: [],
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
    };
    const bare = await renderTourStation({ ...base, ...station }, deps);
    expect(bare.count).toBe(0);
    expect(bare.skipped).toEqual([]);
    bare.dispose();
    const built: string[] = [];
    let freed = 0;
    const parts: WorldPart[] = [];
    const drawn = await renderTourStation(
      { ...base, ...station },
      {
        ...deps,
        worldPart: (block) => {
          built.push(block.id);
          if (block.kind === "audio") return null;
          const part: WorldPart = {
            object: new Object3D(),
            dispose: () => (freed += 1),
          };
          parts.push(part);
          return part;
        },
      },
    );
    expect(built).toEqual(["film", "song", "ann"]);
    expect(drawn.count).toBe(2);
    expect(mountedWorldParts()).toEqual(expect.arrayContaining(parts));
    let found: Object3D | undefined;
    drawn.root.traverse((o) => {
      if (o.userData["objectId"] === "film") found = o;
    });
    expect(found?.position.toArray()).toEqual([1, 2, 3]);
    expect(found?.quaternion.toArray()).toEqual(yaw(0));
    drawn.dispose();
    expect(freed).toBe(2);
    for (const part of parts) expect(mountedWorldParts()).not.toContain(part);
  });

  // Why: a part stands as its block's pose says, pitch and roll included:
  // only the stand and the sign are set upright, by their own arm, so a
  // kind that wants a tilt (a plaque on a slope) gets it.
  it("gives a world part its block's pose rotation as it stands, tilt included", async () => {
    const base = {
      geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 0, rotation: yaw(0) },
      children: [],
    };
    const tilt = new Quaternion()
      .setFromEuler(new Euler(0.3, 0.5, -0.2, "YXZ"))
      .toArray();
    const blocks = withFreeBlocks(base, [
      {
        id: "film",
        kind: "video",
        view: "card",
        video: "v",
        transcript: "t",
        pose: { position: [0, 0, 0], rotation: tilt },
      },
    ]);
    const object = new Object3D();
    const drawn = await renderTourStation(
      { ...base, ...blocks },
      {
        assets: [],
        scene: new Group(),
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
        worldPart: () => ({ object, dispose: () => undefined }),
      },
    );
    expect(object.quaternion.angleTo(new Quaternion(...tilt))).toBeLessThan(
      1e-6,
    );
    drawn.dispose();
  });

  // Why: the stand and the sign free themselves only while still mounted
  // (`if (!unmountWorldPart(part)) return;`, so a second dispose is a
  // no-op). A part built the same way must still be freed with its
  // station: unmounting it first would leave its geometry, materials and
  // textures behind on every station change.
  it("frees a world part that unmounts itself in its own dispose", async () => {
    const base = {
      geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 0, rotation: yaw(0) },
      children: [],
    };
    const blocks = withFreeBlocks(base, [
      {
        id: "film",
        kind: "video",
        view: "card",
        video: "v",
        transcript: "t",
        pose: { position: [0, 0, 0], rotation: yaw(0) },
      },
    ]);
    let freed = 0;
    const made: WorldPart[] = [];
    const drawn = await renderTourStation(
      { ...base, ...blocks },
      {
        assets: [],
        scene: new Group(),
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
        worldPart: () => {
          const part: WorldPart = {
            object: new Object3D(),
            dispose: () => {
              if (!unmountWorldPart(part)) return;
              freed += 1;
            },
          };
          made.push(part);
          return part;
        },
      },
    );
    drawn.dispose();
    expect(freed).toBe(1);
    expect(made).toHaveLength(1);
    expect(mountedWorldParts()).not.toContain(made[0]);
  });

  // Why: one part whose dispose throws must not strand the station's
  // other parts, mounted and unfreed, on every station change; the throw
  // still reaches the caller once all are freed.
  it("frees and unmounts every world part when one part's dispose throws", async () => {
    const base = {
      geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 0, rotation: yaw(0) },
      children: [],
    };
    const film = (id: string): TourBlock => ({
      id,
      kind: "video",
      view: "card",
      video: "v",
      transcript: "t",
      pose: { position: [0, 0, 0], rotation: yaw(0) },
    });
    const blocks = withFreeBlocks(base, [film("f1"), film("f2"), film("f3")]);
    const freed: string[] = [];
    const drawn = await renderTourStation(
      { ...base, ...blocks },
      {
        assets: [],
        scene: new Group(),
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
        worldPart: (block) => ({
          object: new Object3D(),
          dispose: () => {
            freed.push(block.id);
            if (block.id !== "f3") throw new Error(`broken ${block.id}`);
          },
        }),
      },
    );
    expect(() => {
      drawn.dispose();
    }).toThrow("broken f1");
    expect(freed).toEqual(["f1", "f2", "f3"]);
    expect(mountedWorldParts()).toEqual([]);
  });

  // Why (PR #874 review, notes 3 and 5): the views, models and stands were
  // freed unguarded before the parts, so a throwing stand (the pages'
  // reading sign) stranded every part, mounted in the module-global set.
  it("frees and unmounts the world parts when a stand's dispose throws", async () => {
    const base = {
      geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 0, rotation: yaw(0) },
      children: [],
    };
    const blocks = withFreeBlocks(base, [
      {
        id: "sign",
        kind: "longText",
        view: "reading",
        title: "T",
        body: "B",
        pose: { position: [0, 0, 0], rotation: yaw(0) },
      },
      {
        id: "film",
        kind: "video",
        view: "card",
        video: "v",
        transcript: "t",
        pose: { position: [0, 0, 0], rotation: yaw(0) },
      },
    ]);
    const freed: string[] = [];
    const drawn = await renderTourStation(
      { ...base, ...blocks },
      {
        assets: [],
        scene: new Group(),
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
        makeReadingSign: () => ({
          object: new Object3D(),
          dispose: () => {
            throw new Error("broken sign");
          },
        }),
        worldPart: (block) => ({
          object: new Object3D(),
          dispose: () => freed.push(block.id),
        }),
      },
    );
    expect(drawn.count).toBe(2);
    expect(() => {
      drawn.dispose();
    }).toThrow("broken sign");
    expect(freed).toEqual(["film"]);
    expect(mountedWorldParts()).toEqual([]);
  });

  // Why (PR #874 review, notes 3 and 5): in the build-failure path a
  // throwing part dispose replaced the construction error, so the caller
  // was told of the wrong failure; the parts are freed all the same.
  it("keeps the construction error when a part's dispose throws while it frees what was made", async () => {
    const base = {
      geo: { lat: ZERO.lat, lon: ZERO.lon, alt: 0, rotation: yaw(0) },
      children: [],
    };
    const blocks = withFreeBlocks(base, [
      {
        id: "film",
        kind: "video",
        view: "card",
        video: "v",
        transcript: "t",
        pose: { position: [0, 0, 0], rotation: yaw(0) },
      },
      {
        id: "tag",
        kind: "shortText",
        view: "pin",
        caption: "a tag",
        pose: { position: [1, 0, 0], rotation: yaw(0) },
      },
    ]);
    await expect(
      renderTourStation(
        { ...base, ...blocks },
        {
          assets: [],
          scene: new Group(),
          zero: ZERO,
          makeLabel: () => {
            throw new Error("no canvas");
          },
          loadPhotoTexture: () => Promise.resolve(new Texture()),
          worldPart: () => ({
            object: new Object3D(),
            dispose: () => {
              throw new Error("broken part");
            },
          }),
        },
      ),
    ).rejects.toThrow("no canvas");
    expect(mountedWorldParts()).toEqual([]);
  });

  // Why: every world view of a model - placed, ghost, hotspots, cutaway,
  // toy - keeps the size the tour names by the one shared scale rule, and
  // carries its view's handle for the visitor's page; freeing the station
  // gives each model back its own material before freeing it.
  it("draws a model in every world view by the shared scale, with its view's handle", async () => {
    const scene = new Group();
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 5, yaw(0));
    const views = ["placed", "ghost", "hotspots", "cutaway", "toy"] as const;
    const station = stationAt(
      "s",
      stationGeo,
      views.map((view) => ({
        id: view,
        kind: "model" as const,
        view,
        asset: "horse",
        sizeM: 3,
        createdAtIso: NOW,
        pose: {
          position: [0, 0, 0] as [number, number, number],
          rotation: yaw(0),
        },
      })),
    );
    const own = new MeshBasicMaterial();
    let freed = 0;
    own.dispose = () => {
      freed += 1;
    };
    let clipping = 0;
    const assets: TourAsset[] = [
      { id: "horse", path: "content/horse.glb", kind: "model" },
    ];
    const rendered = await renderTourStation(station, {
      assets,
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
      worldPart: modelDoor(
        assets,
        () => Promise.resolve(new Mesh(new BoxGeometry(2, 0.5, 1), own)),
        () => (clipping += 1),
      ),
    });
    await filesLanded();
    expect(rendered.count).toBe(views.length);
    const drawn = new Map<string, Object3D>();
    rendered.root.traverse((o) => {
      const id = o.userData["objectId"];
      // The model is the one child of its part.
      if (typeof id === "string") drawn.set(id, o.children[0]!);
    });
    for (const view of views) {
      const model = drawn.get(view)!;
      expect(model.scale.x, view).toBeCloseTo(1.5, 12);
      expect(
        mountedModelViews().find((h) => h.model === model)?.view,
        view,
      ).toBe(view);
    }
    expect(
      clipping,
      "a cutaway switches the renderer's clipping on",
    ).toBeGreaterThan(0);
    expect((drawn.get("ghost") as Mesh).material).not.toBe(own);
    rendered.dispose();
    expect(
      (drawn.get("ghost") as Mesh).material,
      "its own material is back",
    ).toBe(own);
    expect(freed, "each model's own material is freed once").toBe(views.length);
  });

  // Why (B2b step 2): a story block its story reached stands with the
  // station's own, drawn alone in the station's frame - the free blocks
  // are another part, so only the given blocks may be drawn here.
  it("draws exactly the given blocks of a station, in its frame", async () => {
    const scene = new Group();
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 5, 0, 5, yaw(0));
    const pose = {
      position: [1, 1.5, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    };
    const sign = {
      id: "sign",
      kind: "shortText" as const,
      view: "pin" as const,
      caption: "Old sign",
      pose,
    };
    const free = { ...sign, id: "free", caption: "Free" };
    const rendered = await renderStationBlocks(
      stationAt("s", stationGeo, [free, sign]),
      [sign],
      {
        assets: [],
        scene,
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: () => Promise.resolve(new Texture()),
      },
    );
    const ids: string[] = [];
    rendered.root.traverse((o) => {
      const id = o.userData["objectId"];
      if (typeof id === "string") ids.push(id);
    });
    expect(ids).toEqual(["sign"]);
    expect(rendered.root.parent).toBe(scene);
    rendered.dispose();
  });

  it("places each station as a group at its pose, with its pins and photos as children at their local poses", async () => {
    const scene = new Group();
    const stationGeo = geoAt({ ...ZERO, alt: 400 }, 30, 0, -20, yaw(90));
    const pinPose = {
      position: [2, 1.5, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    };
    const photoPose = {
      position: [0, 1.4, 3] as [number, number, number],
      rotation: yaw(45),
    };
    const deps = {
      assets: photoAssets("g"),
      scene,
      zero: ZERO,
      makeLabel: labelStub,
      loadPhotoTexture: () => Promise.resolve(new Texture()),
    };
    // A station without items places nothing.
    const empty = await renderTourStation(
      stationAt("empty", stationGeo, []),
      deps,
    );
    expect(empty.count).toBe(0);
    empty.dispose();
    const rendered = await renderTourStation(
      stationAt("gate", stationGeo, [
        {
          id: "p",
          kind: "shortText",
          view: "pin",
          caption: "Gate",
          createdAtIso: NOW,
          pose: pinPose,
        },
        {
          id: "g",
          kind: "picture",
          view: "plane",
          image: "g",
          widthM: 1,
          createdAtIso: NOW,
          pose: photoPose,
        },
      ]),
      deps,
    );
    expect(rendered.count).toBe(2);
    expect(scene.children).toEqual([rendered.root]);
    const frame = rendered.root;
    const at = objectPoseNue(stationGeo, ZERO);
    expect(frame.position.toArray()).toEqual([...at.positionNue]);
    expect(frame.quaternion.angleTo(new Quaternion(...yaw(90)))).toBeLessThan(
      1e-6,
    );
    const label = frame.getObjectByName("label:Gate")!;
    expect(label.position.toArray()).toEqual(pinPose.position);
    // Each placed object names its item (`userData.objectId`): the 3D
    // editor picks an item by it and moves its drawing while a drag runs.
    expect(label.userData["objectId"]).toBe("p");
    const named: string[] = [];
    frame.traverse((o) => {
      const id: unknown = o.userData["objectId"];
      if (typeof id === "string") named.push(id);
    });
    expect(named.sort()).toEqual(["g", "p"]);
    rendered.dispose();
    expect(scene.children).toHaveLength(0);
  });

  /**
   * The largest gap, over generated objects within 40 m of a station
   * whose zero is `zeroDistanceM` away, between where the station frame
   * puts an object and where its settled geo pose puts it directly.
   */
  async function worstGap(zeroDistanceM: number, runs: number) {
    let positionM = 0;
    let angleRad = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        async (bearing, stationYaw, n, u, e, itemYaw, tiltDeg) => {
          const b = (bearing * Math.PI) / 180;
          const stationGeo = geoAt(
            { ...ZERO, alt: 400 },
            zeroDistanceM * Math.cos(b),
            3,
            zeroDistanceM * Math.sin(b),
            yaw(stationYaw),
          );
          // A tilted photo: a turn about North after the yaw.
          const t = (tiltDeg * Math.PI) / 360;
          const tilt = new Quaternion(Math.sin(t), 0, 0, Math.cos(t));
          const turn = new Quaternion(...yaw(itemYaw)).multiply(tilt);
          const settled = geoAt(stationGeo, n, u, e, [
            turn.x,
            turn.y,
            turn.z,
            turn.w,
          ]);
          const scene = new Group();
          const rendered = await renderTourStation(
            stationAt("s", stationGeo, [
              {
                id: "g",
                kind: "picture",
                view: "plane",
                image: "g",
                widthM: 1,
                createdAtIso: NOW,
                pose: localPoseOf(settled, stationGeo),
              },
            ]),
            {
              assets: photoAssets("g"),
              scene,
              zero: ZERO,
              makeLabel: labelStub,
              loadPhotoTexture: () => Promise.resolve(new Texture()),
            },
          );
          scene.updateMatrixWorld(true);
          const frame = rendered.root;
          const plane = frame.children[0]!.children[0]!;
          const position = new Vector3();
          const rotation = new Quaternion();
          plane.matrixWorld.decompose(position, rotation, new Vector3());
          const direct = objectPoseNue(settled, ZERO);
          positionM = Math.max(
            positionM,
            position.distanceTo(new Vector3(...direct.positionNue)),
          );
          angleRad = Math.max(
            angleRad,
            rotation.angleTo(new Quaternion(...direct.rotationNue)),
          );
          rendered.dispose();
        },
      ),
      { numRuns: runs },
    );
    return { positionM, angleRad };
  }

  it("decodes no further photo once the result is no longer wanted (alive turns false)", async () => {
    // Why this matters (visitor plan M2): a visitor who walks on while a
    // station's photos decode must not pay for the rest of them.
    const photo = (id: string) => ({
      id,
      kind: "picture" as const,
      view: "plane" as const,
      image: id,
      widthM: 1,
      createdAtIso: NOW,
      pose: {
        position: [0, 1.4, 3] as [number, number, number],
        rotation: yaw(0),
      },
    });
    const geo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 0, yaw(0));
    let alive = true;
    const loaded: string[] = [];
    const rendered = await renderTourStation(
      stationAt("s", geo, [photo("a"), photo("b"), photo("c")]),
      {
        assets: photoAssets("a", "b", "c"),
        scene: new Group(),
        zero: ZERO,
        makeLabel: labelStub,
        loadPhotoTexture: (name) => {
          loaded.push(name);
          alive = false;
          return Promise.resolve(new Texture());
        },
        alive: () => alive,
      },
    );
    expect(loaded).toEqual(["content/a.jpg"]);
    expect(rendered.count).toBe(1);
  });

  it("frees what it made before a throw: the decoded photo and the label made so far, and rejects", async () => {
    // Why this matters: a station is drawn and freed again
    // and again as the visitor walks; a label constructor that throws half
    // way used to strand the textures decoded before it.
    const geo = geoAt({ ...ZERO, alt: 400 }, 10, 0, 0, yaw(0));
    const disposed: string[] = [];
    const texture = new Texture();
    texture.dispose = () => {
      disposed.push("texture");
    };
    let labels = 0;
    const pin = (id: string) => ({
      id,
      kind: "shortText" as const,
      view: "pin" as const,
      caption: id,
      createdAtIso: NOW,
      pose: {
        position: [0, 1.5, 0] as [number, number, number],
        rotation: yaw(0),
      },
    });
    const photo = {
      id: "f",
      kind: "picture" as const,
      view: "plane" as const,
      image: "f",
      widthM: 1,
      createdAtIso: NOW,
      pose: {
        position: [0, 1.4, 3] as [number, number, number],
        rotation: yaw(0),
      },
    };
    const scene = new Group();
    await expect(
      renderTourStation(stationAt("s", geo, [pin("p1"), photo, pin("p2")]), {
        assets: photoAssets("f"),
        scene,
        zero: ZERO,
        makeLabel: (text) => {
          labels += 1;
          if (labels === 2) throw new Error("no canvas");
          return {
            object: new Object3D(),
            dispose: () => {
              disposed.push(`label:${text}`);
            },
          };
        },
        loadPhotoTexture: () => Promise.resolve(texture),
      }),
    ).rejects.toThrow("no canvas");
    expect(disposed.sort()).toEqual(["label:p1", "texture"]);
    expect(scene.children).toHaveLength(0);
  });

  it("reproduces each object's settled pose within 1.2 cm per km between the zero and the station (property, swept)", async () => {
    // Measured 2026-10-18, max over 150 runs each, objects within 40 m of
    // their station: 0 m at the station's own zero; 0.7 mm at 100 m;
    // 6.9 mm at 1 km; 3.4 cm at 5 km; 13.8 cm at 20 km - linear in the
    // zero's distance (the station's tangent plane is not the zero's), so
    // the bound is a rate. The turn is reproduced to float precision
    // (under 1e-5 degrees) at every distance.
    for (const d of [0, 100, 1000, 5000]) {
      const gap = await worstGap(d, 150);
      expect(gap.positionM, `zero ${String(d)} m away`).toBeLessThan(
        0.001 + (0.012 * d) / 1000,
      );
      expect(gap.angleRad, `zero ${String(d)} m away`).toBeLessThan(
        (0.001 * Math.PI) / 180,
      );
    }
  });
});
