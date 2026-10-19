import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Group, Object3D, Quaternion, Texture, Vector3 } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  deriveVerticalHeading,
  mintQrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import {
  mintPhoto,
  mintPin,
  newObjectId,
  objectPoseNue,
  renderTourObjects,
  renderTourStation,
  rotationFromHeading,
} from "./content-placement";

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
    expect(photo!.image).toBe("content/f.jpg");
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
    const bad = { ...good, id: "b", image: "content/b.jpg" };
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
        object.kind === "pin"
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
    items: TourStation["items"],
  ): TourStation {
    return {
      id,
      geo,
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      steps: [],
      items,
    };
  }

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
          kind: "pin",
          label: "Gate",
          createdAtIso: NOW,
          pose: pinPose,
        },
        {
          id: "g",
          kind: "photo",
          image: "content/g.jpg",
          imageWidth: 4,
          imageHeight: 3,
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
                kind: "photo",
                image: "content/g.jpg",
                imageWidth: 4,
                imageHeight: 3,
                createdAtIso: NOW,
                pose: localPoseOf(settled, stationGeo),
              },
            ]),
            {
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
      kind: "photo" as const,
      image: `content/${id}.jpg`,
      imageWidth: 4,
      imageHeight: 3,
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
    // Why this matters (the M2 review): a station is drawn and freed again
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
      kind: "pin" as const,
      label: id,
      createdAtIso: NOW,
      pose: {
        position: [0, 1.5, 0] as [number, number, number],
        rotation: yaw(0),
      },
    });
    const photo = {
      id: "f",
      kind: "photo" as const,
      image: "content/f.jpg",
      imageWidth: 4,
      imageHeight: 3,
      createdAtIso: NOW,
      pose: {
        position: [0, 1.4, 3] as [number, number, number],
        rotation: yaw(0),
      },
    };
    const scene = new Group();
    await expect(
      renderTourStation(stationAt("s", geo, [pin("p1"), photo, pin("p2")]), {
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
