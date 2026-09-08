import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Object3D, Texture, Vector3 } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import {
  mintPhoto,
  mintPin,
  newObjectId,
  objectPoseNue,
  renderTourObjects,
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
    expect(children).toHaveLength(2);
    const label = children.find((c) => c.name === "label:Gate");
    expect(label?.position.x).toBeCloseTo(5, 2);
    expect(label?.position.y).toBeCloseTo(400, 4);
    rendered.dispose();
    expect(children).toHaveLength(0);
    expect(disposed).toEqual(["Gate"]);
  });
});
