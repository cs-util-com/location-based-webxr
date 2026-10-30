// @vitest-environment jsdom
/**
 * Why these tests matter: a long text may carry up to 20 pictures of up to
 * 16.7 megapixels each, and a phone that decodes all of them at once runs
 * out of memory and reloads the page - in AR, the visitor's place is lost.
 * The sheet therefore decodes only the pictures near the view, within a
 * budget of pixels, and lets go of the ones scrolled far away. These pin
 * the planner's rules (near first, within the budget, a band before
 * letting go so a picture at the edge does not flicker) and the
 * controller's handling of each picture: its alt text until it shows, the
 * words for one that cannot, and every object URL given back.
 */
import { describe, expect, it, vi } from "vitest";

import type { PictureFit } from "./image-cap.js";
import {
  LONG_TEXT_DECODE_BUDGET_PX,
  createLongTextPictures,
  planPictures,
  screensAway,
  type PicturePlanEntry,
} from "./long-text-pictures.js";
import type { LongTextPictureSlot } from "./long-text-render.js";

const MP = 1_000_000;

function entry(
  pixels: number | null,
  away: number,
  shown = false,
): PicturePlanEntry {
  return { pixels, screensAway: away, shown };
}

describe("screensAway", () => {
  it("is 0 for a box that overlaps the view, else the gap in view heights", () => {
    const view = { top: 0, bottom: 800 };
    expect(screensAway({ top: 700, bottom: 900 }, view)).toBe(0);
    expect(screensAway({ top: 1600, bottom: 1900 }, view)).toBe(1);
    expect(screensAway({ top: -2000, bottom: -400 }, view)).toBe(0.5);
  });

  it("reads an empty view as far away rather than dividing by zero", () => {
    expect(screensAway({ top: 10, bottom: 20 }, { top: 0, bottom: 0 })).toBe(
      Infinity,
    );
  });
});

describe("planPictures", () => {
  it("shows the pictures within one screen, nearest first, while they fit the budget", () => {
    const plan = planPictures(
      [entry(12 * MP, 0.8), entry(12 * MP, 0), entry(12 * MP, 0.2)],
      24 * MP,
    );
    expect([...plan.show].sort()).toEqual([1, 2]);
    expect(plan.release.size).toBe(0);
  });

  it("keeps a shown picture until it is two screens away, then lets it go", () => {
    const keep = planPictures([entry(12 * MP, 1.5, true)], 24 * MP);
    expect([...keep.show]).toEqual([0]);
    const go = planPictures([entry(12 * MP, 2, true)], 24 * MP);
    expect(go.show.size).toBe(0);
    expect([...go.release]).toEqual([0]);
  });

  it("does not admit a picture beyond one screen, nor one of unknown size", () => {
    const plan = planPictures([entry(1 * MP, 1.01), entry(null, 0)], 24 * MP);
    expect(plan.show.size).toBe(0);
  });

  it("counts the pictures already shown against the budget first", () => {
    const plan = planPictures(
      [entry(16 * MP, 1.8, true), entry(10 * MP, 0)],
      24 * MP,
    );
    expect([...plan.show]).toEqual([0]);
  });

  it("budgets 24 megapixels: two phone photos, not three", () => {
    expect(LONG_TEXT_DECODE_BUDGET_PX).toBe(24 * MP);
  });
});

/** A fake world for the controller: each holder's distance in screens,
 *  the blobs a load gives, and the object URLs made and given back. */
function harness(options: {
  count: number;
  fits: PictureFit[];
  away: number[];
  failLoad?: number[];
}) {
  const slots: LongTextPictureSlot[] = Array.from(
    { length: options.count },
    (_, i) => {
      const holder = document.createElement("p");
      const box = document.createElement("span");
      box.textContent = `alt ${String(i)}`;
      holder.append(box);
      return { asset: `a${String(i)}`, alt: `alt ${String(i)}`, holder };
    },
  );
  const made: string[] = [];
  const revoked: string[] = [];
  const loads: string[] = [];
  let resolveLoads: (() => void)[] = [];
  const away = [...options.away];
  const pictures = createLongTextPictures({
    pictures: slots,
    document,
    load: (asset) => {
      loads.push(asset);
      const i = Number(asset.slice(1));
      return new Promise<Blob>((resolve, reject) => {
        resolveLoads.push(() => {
          if (options.failLoad?.includes(i)) reject(new Error("gone"));
          else resolve(new Blob([asset]));
        });
      });
    },
    fit: (blob) =>
      blob
        .text()
        .then((asset) => options.fits[Number(asset.slice(1))] as PictureFit),
    screensAway: (holder) => away[slots.findIndex((s) => s.holder === holder)]!,
    createUrl: () => {
      const url = `blob:${String(made.length)}`;
      made.push(url);
      return url;
    },
    revokeUrl: (url) => {
      revoked.push(url);
    },
  });
  async function settle(): Promise<void> {
    for (let round = 0; round < 6; round += 1) {
      const pending = resolveLoads;
      resolveLoads = [];
      for (const r of pending) r();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { slots, pictures, made, revoked, loads, away, settle };
}

const ok = (pixels: number): PictureFit => ({ ok: true, pixels });

describe("createLongTextPictures", () => {
  it("shows the near pictures and leaves the far ones as their alt text", async () => {
    const h = harness({
      count: 2,
      fits: [ok(12 * MP), ok(12 * MP)],
      away: [0, 5],
    });
    h.pictures.update();
    await h.settle();
    const img = h.slots[0]!.holder.querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:0");
    expect(img?.getAttribute("alt")).toBe("alt 0");
    expect(h.slots[0]!.holder.querySelector("span")).toBeNull();
    expect(h.slots[1]!.holder.textContent).toBe("alt 1");
    expect(h.loads).toEqual(["a0"]);
  });

  it("lets a picture go two screens away, giving its URL back and its alt text again", async () => {
    const h = harness({ count: 1, fits: [ok(12 * MP)], away: [0] });
    h.pictures.update();
    await h.settle();
    h.away[0] = 3;
    h.pictures.update();
    await h.settle();
    expect(h.revoked).toEqual(["blob:0"]);
    expect(h.slots[0]!.holder.querySelector("img")).toBeNull();
    expect(h.slots[0]!.holder.textContent).toBe("alt 0");
  });

  it("names a picture over the cap, and one that cannot be read, in its box", async () => {
    const h = harness({
      count: 3,
      fits: [
        { ok: false, why: "big", tooLarge: true },
        { ok: false, why: "odd", tooLarge: false },
        ok(1 * MP),
      ],
      away: [0, 0, 0],
      failLoad: [2],
    });
    h.pictures.update();
    await h.settle();
    expect(h.slots[0]!.holder.textContent).toBe(
      "alt 0 (too large to show here)",
    );
    expect(h.slots[1]!.holder.textContent).toBe("alt 1 (cannot be shown here)");
    expect(h.slots[2]!.holder.textContent).toBe("alt 2 (cannot be shown here)");
    expect(h.made).toEqual([]);
  });

  it("holds a measured picture back while the budget is full, and shows it once there is room", async () => {
    const h = harness({
      count: 3,
      fits: [ok(12 * MP), ok(12 * MP), ok(12 * MP)],
      away: [0, 0.1, 0.2],
    });
    h.pictures.update();
    await h.settle();
    h.pictures.update();
    await h.settle();
    expect(h.slots[2]!.holder.querySelector("img")).toBeNull();
    expect(h.slots[2]!.holder.textContent).toBe("alt 2");
    h.away[0] = 2.5;
    h.pictures.update();
    await h.settle();
    h.pictures.update();
    await h.settle();
    expect(h.slots[0]!.holder.querySelector("img")).toBeNull();
    expect(h.slots[2]!.holder.querySelector("img")).not.toBeNull();
  });

  it("gives every URL back on dispose, and a load that lands after it changes nothing", async () => {
    const h = harness({ count: 2, fits: [ok(MP), ok(MP)], away: [0, 0] });
    h.pictures.update();
    await h.settle();
    h.pictures.dispose();
    expect([...h.revoked].sort()).toEqual([...h.made].sort());
    h.pictures.update();
    await h.settle();
    expect(h.made).toHaveLength(2);
  });

  it("survives a fit that throws by naming the picture", async () => {
    const h = harness({ count: 1, fits: [ok(MP)], away: [0] });
    const broken = createLongTextPictures({
      pictures: h.slots,
      document,
      load: () => Promise.resolve(new Blob(["x"])),
      fit: () => Promise.reject(new Error("bad")),
      screensAway: () => 0,
      createUrl: vi.fn(),
      revokeUrl: vi.fn(),
    });
    broken.update();
    await h.settle();
    expect(h.slots[0]!.holder.textContent).toBe("alt 0 (cannot be shown here)");
  });
});
