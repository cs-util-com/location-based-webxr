// @vitest-environment jsdom
/**
 * Why these tests matter: a framed print and a cut-out are what a visitor
 * meets of a picture in the station, and the editor builds the same part.
 * The look must be the prototype's at its width and scale as one object
 * (so the plate stays under the print at every size), the cut-out's tag
 * must follow its creator's switch, a tap must open the right sheet (the
 * picture for a print, the words only for a cut-out) in play and never in
 * the editor, and a part must free what it made, also when it goes before
 * its image is read.
 */
import fc from "fast-check";
import type { TourPictureBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  Box3,
  Group,
  type Mesh,
  type MeshBasicMaterial,
  Texture,
  Vector3,
  type Object3D,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePicturePainters } from "../../test-support/fake-picture-painters.js";
import { screenIn, type WorldEnv, type WorldMode } from "../../world-part.js";
import { CUTOUT_BACK_OPACITY, cutoutFacingFade } from "./cutout.js";
import {
  FRAMED_ARRIVAL_S,
  FRAMED_RISE_M,
  FRAMED_SHADOW_LIFT_M,
  FRAMED_SHADOW_OPACITY,
  framedDevelop,
  framedRise,
  PICTURE_REFERENCE_WIDTH_M,
} from "./framed.js";
import { pictureWorld } from "./world.js";

function picture(
  view: TourPictureBlock["view"],
  fields: Partial<TourPictureBlock> = {},
): TourPictureBlock {
  return {
    id: "p1",
    kind: "picture",
    view,
    image: "img",
    widthM: 1.6,
    title: "The old gate",
    caption: "The gate in 1890, before the road was widened.",
    credit: "Town archive",
    year: "1890",
    pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ...fields,
  };
}

function envOf(mode: WorldMode, screenHost?: HTMLElement): WorldEnv {
  return {
    mode,
    loadAsset: () => Promise.resolve(new Blob(["png"])),
    canvasTexture: () => {
      throw new Error("the parts paint through their painters");
    },
    loadModel: () => Promise.reject(new Error("no model here")),
    enableClipping: () => undefined,
    sound: () => {
      throw new Error("no sound here");
    },
    ...(screenHost === undefined ? {} : { screen: screenIn(screenHost) }),
  };
}

/** A decoded image `w` x `h` px whose disposal is seen. */
function texture(w = 100, h = 200): Texture & { disposed: boolean } {
  const t = new Texture() as Texture & { disposed: boolean };
  t.image = { width: w, height: h };
  t.disposed = false;
  t.addEventListener("dispose", () => {
    t.disposed = true;
  });
  return t;
}

function named(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(name);
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:picture");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("pictureWorld", () => {
  it("stands nothing for the views drawn elsewhere or not at all", () => {
    // The plane is the renderer's own; the card stands nothing; a
    // viewpoint view without a viewpoint is drawn as a plane.
    for (const view of [
      "plane",
      "card",
      "thenNow",
      "sharpen",
      "finder",
      "window",
      "viewer",
    ] as const) {
      expect(pictureWorld(picture(view), envOf("play"))).toBeNull();
    }
  });

  it("builds a framed print: frame, mat, print and a plate under it", async () => {
    const fake = fakePicturePainters();
    const part = pictureWorld(picture("framed"), envOf("edit"), {
      decode: () => Promise.resolve(texture()),
      painters: fake.painters,
    });
    await part?.ready;
    const root = part!.object;
    for (const name of [
      "picture-frame",
      "picture-back",
      "picture-mat",
      "picture-print",
      "picture-plate",
    ]) {
      expect(named(root, name), name).toBeDefined();
    }
    expect(fake.painted.plates).toEqual([
      {
        year: "1890",
        caption: "The gate in 1890, before the road was widened.",
        credit: "Town archive",
      },
    ]);
    // The print is the image's shape: 1.6 m wide, twice as tall.
    const print = new Box3().setFromObject(named(root, "picture-print")!);
    const size = print.getSize(new Vector3());
    expect(size.x).toBeCloseTo(1.6, 6);
    expect(size.y).toBeCloseTo(3.2, 6);
    // The plate hangs wholly under the frame.
    const frame = new Box3().setFromObject(named(root, "picture-frame")!);
    const plate = new Box3().setFromObject(named(root, "picture-plate")!);
    expect(plate.max.y).toBeLessThan(frame.min.y);
  });

  it("scales the whole look as one object to the block's width", async () => {
    // Why: a print twice as wide is the same print twice as large, plate
    // and frame alike; the placement contract scales from what is drawn.
    const boxes = await Promise.all(
      [0.8, 1.6, 3.2].map(async (widthM) => {
        const part = pictureWorld(
          picture("framed", { widthM }),
          envOf("edit"),
          {
            decode: () => Promise.resolve(texture()),
            painters: fakePicturePainters().painters,
          },
        );
        await part?.ready;
        return new Box3().setFromObject(part!.object).getSize(new Vector3());
      }),
    );
    const [small, ref, large] = boxes as [Vector3, Vector3, Vector3];
    expect(small.x * 2).toBeCloseTo(ref.x, 6);
    expect(large.y / 2).toBeCloseTo(ref.y, 6);
    expect(ref.x).toBeGreaterThan(PICTURE_REFERENCE_WIDTH_M);
  });

  it("stands a cut-out on its foot, with its tag unless it is switched off", async () => {
    const build = async (fields: Partial<TourPictureBlock>) => {
      const fake = fakePicturePainters();
      const part = pictureWorld(picture("cutout", fields), envOf("edit"), {
        decode: () => Promise.resolve(texture()),
        painters: fake.painters,
      });
      await part?.ready;
      return { root: part!.object, fake };
    };
    const tagged = await build({});
    expect(named(tagged.root, "picture-cutout-tag")).toBeDefined();
    expect(tagged.fake.painted.tags).toEqual([
      {
        year: "1890",
        title: "The old gate",
        caption: "The gate in 1890, before the road was widened.",
      },
    ]);
    const front = new Box3().setFromObject(
      named(tagged.root, "picture-cutout-front")!,
    );
    expect(front.min.y).toBeCloseTo(0, 6);
    expect(front.max.y).toBeCloseTo(3.2, 6);

    const bare = await build({ showTag: false });
    expect(named(bare.root, "picture-cutout-tag")).toBeUndefined();
    expect(bare.fake.painted.tags).toEqual([]);
    expect(named(bare.root, "picture-cutout-shadow")).toBeDefined();
  });

  it("fades a cut-out seen edge-on and darkens its back", async () => {
    const part = pictureWorld(picture("cutout"), envOf("edit"), {
      decode: () => Promise.resolve(texture()),
      painters: fakePicturePainters().painters,
    });
    await part?.ready;
    const front = named(part!.object, "picture-cutout-front") as Mesh;
    const back = named(part!.object, "picture-cutout-back") as Mesh;
    const opacity = (m: Mesh) => (m.material as MeshBasicMaterial).opacity;
    part!.update?.({ seconds: 0, viewer: [0, 1.6, 5] });
    expect(opacity(front)).toBeCloseTo(1, 6);
    expect(opacity(back)).toBeCloseTo(CUTOUT_BACK_OPACITY, 6);
    part!.update?.({ seconds: 0, viewer: [5, 1.6, 0] });
    expect(opacity(front)).toBe(0);
    // Turned by the renderer to face +X, it shows to a viewer there.
    part!.object.rotation.y = Math.PI / 2;
    part!.object.updateMatrix();
    part!.update?.({ seconds: 0, viewer: [5, 1.6, 0] });
    expect(opacity(front)).toBeCloseTo(1, 6);
  });

  it("opens a framed print's sheet with the picture on a tap in play", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const part = pictureWorld(picture("framed"), envOf("play", host), {
      decode: () => Promise.resolve(texture()),
      painters: fakePicturePainters().painters,
    });
    await part?.ready;
    part!.tap?.();
    const sheet = host.querySelector<HTMLElement>(".picture-sheet");
    expect(sheet?.getAttribute("role")).toBe("dialog");
    expect(sheet?.getAttribute("aria-label")).toBe("The old gate");
    expect(sheet?.querySelector("img")?.getAttribute("src")).toBe(
      "blob:picture",
    );
    expect(sheet?.textContent).toContain("Town archive");
    // A second tap while it shows opens no second sheet.
    part!.tap?.();
    expect(host.querySelectorAll(".picture-sheet")).toHaveLength(1);
    host.querySelector<HTMLButtonElement>(".picture-sheet-close")!.click();
    expect(host.querySelector(".picture-sheet")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picture");
    // Closed, a tap opens it again.
    part!.tap?.();
    expect(host.querySelector(".picture-sheet")).not.toBeNull();
    part!.dispose();
    expect(host.querySelector(".picture-sheet")).toBeNull();
  });

  it("opens a cut-out's sheet with its words only", async () => {
    const host = document.createElement("div");
    const part = pictureWorld(picture("cutout"), envOf("play", host), {
      decode: () => Promise.resolve(texture()),
      painters: fakePicturePainters().painters,
    });
    await part?.ready;
    part!.tap?.();
    const sheet = host.querySelector<HTMLElement>(".picture-sheet");
    expect(sheet?.dataset["textOnly"]).toBe("true");
    expect(sheet?.querySelector("img")).toBeNull();
    expect(sheet?.textContent).toContain("before the road was widened");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("takes no tap in the editor", () => {
    const host = document.createElement("div");
    const part = pictureWorld(picture("framed"), envOf("edit", host), {
      decode: () => Promise.resolve(texture()),
      painters: fakePicturePainters().painters,
    });
    expect(part?.tap).toBeUndefined();
  });

  it("rejects its ready when the image cannot be shown", async () => {
    const part = pictureWorld(picture("framed"), envOf("play"), {
      decode: () => Promise.resolve(null),
      painters: fakePicturePainters().painters,
    });
    await expect(part!.ready).rejects.toThrow(/cannot be shown/);
  });

  it("frees its look on dispose, and an image read after it went", async () => {
    const shown = texture();
    const part = pictureWorld(picture("framed"), envOf("edit"), {
      decode: () => Promise.resolve(shown),
      painters: fakePicturePainters().painters,
    });
    await part?.ready;
    part!.dispose();
    expect(shown.disposed).toBe(true);
    expect(part!.object.children.every((c) => c instanceof Group)).toBe(true);
    expect(named(part!.object, "picture-print")).toBeUndefined();

    let release: (t: Texture) => void = () => undefined;
    const late = texture();
    const early = pictureWorld(picture("cutout"), envOf("edit"), {
      decode: () =>
        new Promise<Texture>((resolve) => {
          release = resolve;
        }),
      painters: fakePicturePainters().painters,
    });
    early!.dispose();
    await Promise.resolve();
    await Promise.resolve();
    release(late);
    await early!.ready;
    expect(late.disposed).toBe(true);
    expect(named(early!.object, "picture-cutout-front")).toBeUndefined();
  });
});

describe("cutoutFacingFade", () => {
  const level = fc
    .double({ min: 0, max: 2 * Math.PI, noNaN: true })
    .map((a) => new Vector3(Math.sin(a), 0, Math.cos(a)));

  it("is in [0, 1], the same from the front and from behind", () => {
    fc.assert(
      fc.property(level, level, (facing, toViewer) => {
        const f = cutoutFacingFade(facing, toViewer);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
        expect(cutoutFacingFade(facing, toViewer.clone().negate())).toBeCloseTo(
          f,
          12,
        );
      }),
    );
  });

  it("is 0 within about 6 degrees of edge-on and 1 from 24 degrees off its plane", () => {
    const facing = new Vector3(0, 0, 1);
    const seen = (offPlaneDeg: number) => {
      const a = (offPlaneDeg * Math.PI) / 180;
      return cutoutFacingFade(facing, new Vector3(Math.cos(a), 0, Math.sin(a)));
    };
    expect(seen(0)).toBe(0);
    expect(seen(5.7)).toBe(0);
    expect(seen(23.6)).toBeCloseTo(1, 2);
    expect(seen(90)).toBe(1);
    // Monotone between: turning toward it never makes it fainter.
    let last = 0;
    for (let d = 0; d <= 90; d += 0.5) {
      expect(seen(d)).toBeGreaterThanOrEqual(last - 1e-12);
      last = seen(d);
    }
  });
});

describe("a framed print's arrival and its shadow", () => {
  /** The print's develop as its shader is handed it: the material's own
   *  hook run on a stand-in of three's basic shader. */
  function developOf(root: Object3D) {
    const material = (named(root, "picture-print") as Mesh)
      .material as MeshBasicMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: "",
      fragmentShader:
        "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
    };
    material.onBeforeCompile(shader as never, undefined as never);
    return { shader, value: () => shader.uniforms["uDevelop"]?.value };
  }

  function frameY(root: Object3D): number {
    return new Box3()
      .setFromObject(named(root, "picture-frame")!)
      .getCenter(new Vector3()).y;
  }

  async function framed(mode: WorldMode, fields: Partial<TourPictureBlock>) {
    const fake = fakePicturePainters();
    const part = pictureWorld(picture("framed", fields), envOf(mode), {
      decode: () => Promise.resolve(texture()),
      painters: fake.painters,
    });
    await part?.ready;
    // The renderer stands the part at its pose.
    part!.object.position.y = fields.pose?.position[1] ?? 0;
    part!.object.updateMatrixWorld(true);
    return { part: part!, root: part!.object, fake };
  }

  it("lays a soft shadow on the ground under a hanging print, taking no tap", async () => {
    // Why: the prototype's print stands on the ground through its shadow;
    // a shadow at the print's own height would float, and one in the tap
    // target would open the sheet from the ground.
    for (const widthM of [0.8, 1.6, 3.2]) {
      const { part, root, fake } = await framed("edit", {
        widthM,
        pose: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
      });
      part.update?.({ seconds: 0, viewer: [0, 1.6, 5] });
      root.updateMatrixWorld(true);
      const shadow = named(root, "picture-framed-shadow") as Mesh;
      expect(shadow, `width ${String(widthM)}`).toBeDefined();
      expect(fake.painted.shadows).toBe(1);
      const box = new Box3().setFromObject(shadow);
      const size = box.getSize(new Vector3());
      // On the ground, 12 mm above it, flat.
      expect(box.min.y).toBeCloseTo(FRAMED_SHADOW_LIFT_M, 6);
      expect(size.y).toBeCloseTo(0, 6);
      // 1.2 x the frame's outer width, as deep as the prototype's 0.9 m at
      // the reference width, scaled with the print.
      const frame = new Box3()
        .setFromObject(named(root, "picture-back")!)
        .getSize(new Vector3());
      expect(size.x).toBeCloseTo(frame.x * 1.2, 6);
      expect(size.z).toBeCloseTo((0.9 * widthM) / PICTURE_REFERENCE_WIDTH_M, 6);
      const material = shadow.material as MeshBasicMaterial;
      expect(material.opacity).toBeCloseTo(FRAMED_SHADOW_OPACITY, 6);
      expect(material.depthWrite).toBe(false);
      // Beside the look's own tap target, never in it.
      expect(shadow.parent?.name).toBe("picture-framed");
      const hits: unknown[] = [];
      shadow.raycast(undefined as never, hits as never);
      expect(hits).toEqual([]);
      part.dispose();
    }
  });

  it("follows the ground when the print is moved up or down", async () => {
    const { part, root } = await framed("edit", {
      pose: { position: [0, 0.6, 0], rotation: [0, 0, 0, 1] },
    });
    part.update?.({ seconds: 0, viewer: [0, 1.6, 5] });
    root.position.y = 2.4;
    root.updateMatrixWorld(true);
    part.update?.({ seconds: 0.1, viewer: [0, 1.6, 5] });
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(named(root, "picture-framed-shadow")!);
    expect(box.min.y).toBeCloseTo(FRAMED_SHADOW_LIFT_M, 6);
  });

  it("rises 12 cm and develops once, as the visitor arrives", async () => {
    // Why: the chosen page's print comes up out of the ground and its
    // picture comes out of the paper; it is the station's arrival, so it
    // plays once from the first frame it is shown.
    const { part, root } = await framed("play", {
      pose: { position: [0, 1.5, 0], rotation: [0, 0, 0, 1] },
    });
    const develop = developOf(root);
    expect(develop.shader.fragmentShader).toMatch(
      /#include <common>\s*uniform float uDevelop;/,
    );
    expect(develop.shader.fragmentShader).toMatch(
      /#include <map_fragment>[\s\S]*uDevelop[\s\S]*\}$/,
    );
    const view = { viewer: [0, 1.6, 5] as [number, number, number] };
    part.update?.({ seconds: 20, ...view });
    root.updateMatrixWorld(true);
    const sunk = frameY(root);
    expect(develop.value()).toBe(0);
    let lastY = sunk;
    let lastDevelop = 0;
    for (let t = 0.1; t <= FRAMED_ARRIVAL_S + 1e-9; t += 0.1) {
      part.update?.({ seconds: 20 + t, ...view });
      root.updateMatrixWorld(true);
      // Never sinks back, never undevelops on the way.
      expect(frameY(root)).toBeGreaterThanOrEqual(lastY - 1e-12);
      expect(develop.value()!).toBeGreaterThanOrEqual(lastDevelop - 1e-12);
      lastY = frameY(root);
      lastDevelop = develop.value()!;
    }
    part.update?.({ seconds: 20 + FRAMED_ARRIVAL_S, ...view });
    root.updateMatrixWorld(true);
    expect(frameY(root) - sunk).toBeCloseTo(FRAMED_RISE_M, 6);
    expect(develop.value()).toBe(1);
    // Arrived, it stays so.
    part.update?.({ seconds: 99, ...view });
    root.updateMatrixWorld(true);
    expect(frameY(root) - sunk).toBeCloseTo(FRAMED_RISE_M, 6);
    expect(develop.value()).toBe(1);
  });

  it("stands arrived in the editor", async () => {
    // Why: a creator places the print where it will stand; a rising one
    // would be placed 12 cm off.
    const { part, root } = await framed("edit", {});
    const develop = developOf(root);
    root.updateMatrixWorld(true);
    const before = frameY(root);
    expect(develop.value()).toBe(1);
    part.update?.({ seconds: 3, viewer: [0, 1.6, 5] });
    root.updateMatrixWorld(true);
    expect(frameY(root)).toBeCloseTo(before, 9);
    expect(develop.value()).toBe(1);
  });
});

describe("framedRise and framedDevelop", () => {
  it("start sunk and undeveloped, end risen and developed, monotone between", () => {
    expect(framedRise(0)).toBeCloseTo(-FRAMED_RISE_M, 12);
    expect(framedRise(1)).toBeCloseTo(0, 12);
    expect(framedDevelop(0)).toBe(0);
    expect(framedDevelop(1)).toBe(1);
    // The rise is done before the picture is: it comes up, then develops.
    expect(framedRise(0.7)).toBeCloseTo(0, 12);
    expect(framedDevelop(0.3)).toBe(0);
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(framedRise(hi)).toBeGreaterThanOrEqual(framedRise(lo));
          expect(framedDevelop(hi)).toBeGreaterThanOrEqual(framedDevelop(lo));
          expect(framedDevelop(lo)).toBeGreaterThanOrEqual(0);
          expect(framedDevelop(hi)).toBeLessThanOrEqual(1);
          expect(framedRise(lo)).toBeGreaterThanOrEqual(-FRAMED_RISE_M);
          expect(framedRise(hi)).toBeLessThanOrEqual(0);
        },
      ),
    );
    expect(framedRise(Number.NaN)).toBe(0);
    expect(framedDevelop(Number.NaN)).toBe(1);
  });
});
