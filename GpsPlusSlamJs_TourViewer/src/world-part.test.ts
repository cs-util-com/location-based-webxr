/**
 * Why this test matters: a world part is the one shape every kind's object
 * in the square takes, so the door the first kinds are built against is
 * fixed here before any of them exists. These tests pin what the page
 * relies on: words painted into a texture look the same in every part
 * (`paintText`), one set holds every mounted part, a tap reaches only a
 * part of a station whose content shows, a part may show nothing at all
 * (an audio zone), the world's axes are the ones the renderer applies,
 * and a part loads its files by asset id.
 */

import fc from "fast-check";
import {
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import { facingRotation } from "./character-views";
import { rotationFromHeading } from "./content-placement";
import { pickObject } from "./object-pick";
import {
  mountedWorldParts,
  mountWorldPart,
  paintText,
  tapShownWorldPart,
  unmountWorldPart,
  worldEnv,
  type WorldPart,
} from "./world-part";

const canvas = (): HTMLCanvasElement =>
  ({ width: 512, height: 256 }) as unknown as HTMLCanvasElement;

/** A stage with one shown and one hidden station's content group. */
function stage() {
  const scene = new Group();
  const shown = new Group();
  shown.name = "station-content:gate";
  const hidden = new Group();
  hidden.name = "station-content:well";
  hidden.visible = false;
  scene.add(shown, hidden);
  return { scene, shown, hidden };
}

/** A part under `parent` that counts its taps. */
function tappable(parent: Object3D): WorldPart & { taps: number } {
  const object = new Group();
  parent.add(object);
  const part = {
    object,
    tapTarget: object,
    taps: 0,
    tap() {
      part.taps += 1;
    },
    dispose() {},
  };
  return part;
}

// Why: the reading stand, the reading sign and the character's look each
// set their texture up by hand; one helper keeps words in the world in the
// right colour space, with a sharpness a slanted page can ask for.
describe("paintText", () => {
  it("is an sRGB texture of the canvas, as sharp as asked", () => {
    const page = canvas();
    const plain = paintText(page);
    expect(plain.image).toBe(page);
    expect(plain.colorSpace).toBe(SRGBColorSpace);
    expect(plain.anisotropy).toBe(1);
    for (const anisotropy of [1, 4, 16]) {
      const sharp = paintText(page, { anisotropy });
      expect(sharp.anisotropy).toBe(anisotropy);
      sharp.dispose();
    }
    plain.dispose();
  });
});

// Why: three hand-written registries (stands, signs, model views) were how
// the page found its parts; one set means a new kind's part is found the
// same way, with no fourth registry.
describe("the mounted set", () => {
  it("holds what was mounted and not yet unmounted, oldest first", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(5), fc.boolean()), { maxLength: 30 }),
        (steps) => {
          const parts = Array.from({ length: 6 }, () => ({
            object: new Object3D(),
            dispose() {},
          }));
          const model: WorldPart[] = [];
          const unmounted: boolean[] = [];
          const expected: boolean[] = [];
          for (const [i, mount] of steps) {
            const part = parts[i];
            if (part === undefined) continue;
            if (mount) {
              mountWorldPart(part);
              if (!model.includes(part)) model.push(part);
            } else {
              const was = model.includes(part);
              expected.push(was);
              unmounted.push(unmountWorldPart(part));
              if (was) model.splice(model.indexOf(part), 1);
            }
          }
          expect(unmounted).toEqual(expected);
          expect(mountedWorldParts().filter((p) => parts.includes(p))).toEqual(
            model,
          );
          for (const part of parts) unmountWorldPart(part);
        },
      ),
    );
  });
});

// Why: the visitor's tap reaches only the parts shown under a station's
// content group, so a hidden station's part, or one outside any station,
// never takes a tap; without a scene, or with nothing to tap, the pick is
// not even asked.
describe("tapShownWorldPart", () => {
  it("offers only the shown parts that take a tap, and taps the one under it", () => {
    const { scene, shown, hidden } = stage();
    const a = tappable(shown);
    const b = tappable(hidden);
    const c = tappable(scene);
    const d = tappable(shown);
    const still: WorldPart = { object: new Group(), dispose() {} };
    shown.add(still.object);
    const offered: Object3D[][] = [];
    expect(
      tapShownWorldPart(
        scene,
        (targets) => {
          offered.push([...targets.values()]);
          return [...targets.keys()][1] ?? null;
        },
        null,
        [a, b, c, still, d],
      ),
    ).toBe(true);
    expect(offered).toEqual([[a.object, d.object]]);
    expect([a.taps, b.taps, c.taps, d.taps]).toEqual([0, 0, 0, 1]);
  });

  it("taps nothing for a miss, a hidden part, no part or no scene", () => {
    const { scene, shown, hidden } = stage();
    const a = tappable(shown);
    const b = tappable(hidden);
    expect(tapShownWorldPart(scene, () => null, null, [a, b])).toBe(false);
    expect(tapShownWorldPart(scene, () => "elsewhere", null, [a])).toBe(false);
    let asked = 0;
    const pick = () => {
      asked += 1;
      return "part-0";
    };
    expect(tapShownWorldPart(scene, pick, null, [b])).toBe(false);
    expect(tapShownWorldPart(scene, pick, null, [])).toBe(false);
    expect(tapShownWorldPart(null, pick, null, [a])).toBe(false);
    expect(asked).toBe(0);
    expect([a.taps, b.taps]).toEqual([0, 0]);
  });

  // Why: the pick is the page's own (`pickObject`): among the shown parts
  // the nearest exact hit along the ray wins, whatever the kind and
  // whatever their order in the set, so a sign standing in front of a
  // stand takes the tap, and the stand behind it does not.
  it("taps the nearer of two parts on the ray, through the page's real pick", () => {
    const { scene, shown } = stage();
    const at = (z: number) => {
      const object = new Mesh(new PlaneGeometry(1, 1));
      object.position.set(0, 0, z);
      shown.add(object);
      const part = {
        object,
        tapTarget: object,
        taps: 0,
        tap() {
          part.taps += 1;
        },
        dispose() {},
      };
      return part;
    };
    const stand = at(-4);
    const sign = at(-2);
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    scene.add(camera);
    scene.updateMatrixWorld(true);
    const pick = (targets: ReadonlyMap<string, Object3D>) =>
      pickObject(camera, targets);
    expect(tapShownWorldPart(scene, pick, null, [stand, sign])).toBe(true);
    expect(tapShownWorldPart(scene, pick, null, [sign, stand])).toBe(true);
    expect([stand.taps, sign.taps]).toEqual([0, 2]);
  });

  // Why: an audio zone may have nothing to see; an empty object is still a
  // part (it stands, it is mounted, it goes), and it takes no tap.
  it("an empty object is a valid part: mounted and shown, never tapped", () => {
    const { scene, shown } = stage();
    const empty: WorldPart = { object: new Object3D(), dispose() {} };
    shown.add(empty.object);
    mountWorldPart(empty);
    expect(mountedWorldParts()).toContain(empty);
    let asked = false;
    expect(
      tapShownWorldPart(
        scene,
        () => {
          asked = true;
          return "part-0";
        },
        null,
      ),
    ).toBe(false);
    expect(asked).toBe(false);
    expect(unmountWorldPart(empty)).toBe(true);
    expect(mountedWorldParts()).not.toContain(empty);
  });
});

// Why: the contract tells a kind which way is up and which way is front.
// The renderer gives a part its block's pose rotation as it stands, and
// two conventions write that rotation: the QR poster rule
// (`rotationFromHeading`) and the editor's facing (`facingRotation`).
// These pin what each makes of the part's axes, so the words in the
// sidecar cannot drift from them. NUE: x North, y Up, z East.
describe("the world's axes", () => {
  const bearingOf = (v: Vector3): number =>
    ((Math.atan2(v.z, v.x) * 180) / Math.PI + 360) % 360;

  it("up is local +Y, right is local +X at the heading, front is local +Z at heading + 90", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 359.9, noNaN: true }), (h) => {
        const q = new Quaternion(...rotationFromHeading(h));
        const up = new Vector3(0, 1, 0).applyQuaternion(q);
        const right = new Vector3(1, 0, 0).applyQuaternion(q);
        const front = new Vector3(0, 0, 1).applyQuaternion(q);
        expect(up.y).toBeCloseTo(1, 9);
        const near = (a: number, b: number): number =>
          Math.abs(((a - b + 540) % 360) - 180);
        expect(near(bearingOf(right), h)).toBeLessThan(1e-6);
        expect(near(bearingOf(front), h + 90)).toBeLessThan(1e-6);
      }),
    );
  });

  it("the editor's facing turns front, local +Z, to the facing itself", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 359.9, noNaN: true }), (h) => {
        const q = new Quaternion(...facingRotation(h)!);
        const up = new Vector3(0, 1, 0).applyQuaternion(q);
        const front = new Vector3(0, 0, 1).applyQuaternion(q);
        expect(up.y).toBeCloseTo(1, 9);
        const near = (a: number, b: number): number =>
          Math.abs(((a - b + 540) % 360) - 180);
        expect(near(bearingOf(front), h)).toBeLessThan(1e-6);
      }),
    );
  });
});

// Why: a part names its files by asset id, as the tour does; the page's
// loader reads by path, and an id the tour lacks must fail with words.
describe("worldEnv", () => {
  it("loads a file by its asset id, and refuses an unknown id by name", async () => {
    const asked: string[] = [];
    const blob = new Blob(["x"]);
    for (const mode of ["play", "edit"] as const) {
      const env = worldEnv(
        mode,
        [{ id: "song", path: "content/song.mp3", kind: "audio" }],
        (path) => {
          asked.push(path);
          return Promise.resolve(blob);
        },
      );
      expect(env.mode).toBe(mode);
      await expect(env.loadAsset("song")).resolves.toBe(blob);
      await expect(env.loadAsset("gone")).rejects.toThrow(/"gone"/);
      expect(env.paintText(canvas()).colorSpace).toBe(SRGBColorSpace);
    }
    expect(asked).toEqual(["content/song.mp3", "content/song.mp3"]);
  });
});
