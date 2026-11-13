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
import { PICTURE_REFERENCE_WIDTH_M } from "./framed.js";
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
