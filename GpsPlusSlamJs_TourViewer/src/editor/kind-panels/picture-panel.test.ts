/**
 * Why these tests matter: the picture's panel is where a creator picks a
 * framed print or a cut-out and switches the cut-out's tag. The chips must
 * show the view in use and write a pick as the block's view; the tag
 * switch must show only for a cut-out and flip what is stored; and a
 * cut-out whose picture has no see-through parts must say so (once its
 * check is in), while one with them, or one that cannot be checked, says
 * nothing.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import type { PanelItem } from "./kind-panel.js";
import {
  createPicturePanel,
  NO_ALPHA_WARNING,
  OTHER_VIEW_NOTE,
  PICTURE_VIEW_CHOICES,
  pictureFieldMark,
} from "./picture-panel.js";

type Picture = NonNullable<PanelItem["picture"]>;

function item(
  shown: Omit<Picture, "viewpoint"> & Partial<Pick<Picture, "viewpoint">>,
): PanelItem {
  const picture: Picture = { viewpoint: null, ...shown };
  return {
    kind: "item",
    itemKind: "picture",
    title: "Gate",
    sub: "Photo in Gate",
    stationId: "s",
    text: null,
    extent: null,
    fields: [],
    model: null,
    longText: null,
    offset: { northM: 0, upM: 0, eastM: 0 },
    headingDeg: 0,
    turns: true,
    groundOffM: null,
    folder: null,
    video: null,
    picture,
  };
}

function panelWith(answer: boolean | null) {
  const deps = {
    setView: vi.fn((): "written" => "written"),
    setTag: vi.fn((): "written" => "written"),
    setViewpoint: vi.fn((): "written" => "written"),
    lookFrom: vi.fn(),
    seeThrough: vi.fn(() => Promise.resolve(answer)),
    changed: vi.fn(),
  };
  return { panel: createPicturePanel(deps), deps };
}

const drawn = (nodes: readonly HTMLElement[]) => {
  const host = document.createElement("div");
  host.append(...nodes);
  return host;
};

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createPicturePanel", () => {
  it("draws nothing for an item that is no picture", () => {
    const { panel } = panelWith(true);
    const notPicture = {
      ...item({ view: "plane", showTag: true, imagePath: null }),
    };
    delete (notPicture as { picture?: unknown }).picture;
    expect(panel.sync(notPicture)).toBeNull();
    expect(panel.sync(null)).toBeNull();
  });

  it("shows the view in use and writes a pick as the view", () => {
    const { panel, deps } = panelWith(true);
    const framed = item({ view: "framed", showTag: true, imagePath: "a.png" });
    const host = drawn(panel.sync(framed)!.parts());
    const pressed = host.querySelector('[aria-pressed="true"]');
    expect(pressed?.getAttribute("data-act")).toBe("picture-view:framed");
    expect(host.textContent).toContain("plate below");
    // No tag switch outside the cut-out.
    expect(host.querySelector('[data-act="picture-tag"]')).toBeNull();
    expect(panel.act("picture-view:cutout", framed, "p1")).toBe(true);
    expect(deps.setView).toHaveBeenCalledWith("p1", "cutout");
    expect(panel.act("view:placed", framed, "p1")).toBe(false);
  });

  it("names a view the chips do not offer", () => {
    // A card stands nowhere; no chip offers it.
    const { panel } = panelWith(true);
    const host = drawn(
      panel
        .sync(item({ view: "card", showTag: true, imagePath: null }))!
        .parts(),
    );
    expect(host.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(host.textContent).toContain(OTHER_VIEW_NOTE);
  });

  // Why: every view seen from a viewpoint is reachable from the editor:
  // its chip writes the view, and while it is shown the panel types the
  // viewpoint's place, facing, pitch, lens and depth, each a field the
  // shell commits, and offers a fresh one in front of the picture.
  it("offers every viewpoint view and types its viewpoint", () => {
    const { panel, deps } = panelWith(true);
    const plane = item({ view: "plane", showTag: true, imagePath: "a.png" });
    const chips = [
      ...drawn(panel.sync(plane)!.parts()).querySelectorAll("[data-act]"),
    ].map((b) => b.getAttribute("data-act"));
    for (const view of ["thenNow", "sharpen", "viewer", "finder", "window"]) {
      expect(chips).toContain(`picture-view:${view}`);
    }
    // A plane types no viewpoint.
    expect(chips).not.toContain("picture-viewpoint-new");
    const vp = {
      northM: 1.5,
      upM: 1.6,
      eastM: -2,
      facingDeg: 270,
      pitchDeg: 4,
      lensDeg: 56,
      distanceM: 6,
    };
    const thenNow = item({
      view: "thenNow",
      showTag: true,
      imagePath: "a.png",
      viewpoint: vp,
    });
    const host = drawn(panel.sync(thenNow)!.parts());
    const fields = [...host.querySelectorAll<HTMLInputElement>("[data-field]")];
    expect(fields.map((f) => [f.dataset["field"], f.value])).toEqual([
      ["vp-north", "1.50"],
      ["vp-up", "1.60"],
      ["vp-east", "-2.00"],
      ["vp-facing", "270.0"],
      ["vp-pitch", "4.0"],
      ["vp-lens", "56.0"],
      ["vp-distance", "6.00"],
    ]);
    // Each field has its label, so it is found by its name.
    for (const f of fields) {
      expect(host.querySelector(`label[for="${f.id}"]`)).not.toBeNull();
    }
    expect(panel.act("picture-viewpoint-new", thenNow, "p1")).toBe(true);
    expect(deps.setViewpoint).toHaveBeenCalledWith("p1", null);
    // The draw's key follows the viewpoint, so a typed value redraws.
    const moved = item({
      view: "thenNow",
      showTag: true,
      imagePath: "a.png",
      viewpoint: { ...vp, northM: 3 },
    });
    expect(panel.sync(moved)!.key).not.toBe(panel.sync(thenNow)!.key);
  });

  // Why: a creator checks a viewpoint by looking through it: the button
  // stands the 3D view's camera there, and only a viewpoint that exists
  // can be looked from.
  it("looks from the viewpoint when there is one", () => {
    const { panel, deps } = panelWith(true);
    const vp = {
      northM: 1,
      upM: 1.6,
      eastM: 0,
      facingDeg: 90,
      pitchDeg: 0,
      lensDeg: 56,
      distanceM: 6,
    };
    const seen = item({
      view: "sharpen",
      showTag: true,
      imagePath: null,
      viewpoint: vp,
    });
    const host = drawn(panel.sync(seen)!.parts());
    expect(
      host.querySelector('[data-act="picture-look-from"]')?.textContent,
    ).toBe("Look from the viewpoint");
    expect(panel.act("picture-look-from", seen, "p1")).toBe(true);
    expect(deps.lookFrom).toHaveBeenCalledWith("p1");
    const bare = item({ view: "sharpen", showTag: true, imagePath: null });
    expect(
      drawn(panel.sync(bare)!.parts()).querySelector(
        '[data-act="picture-look-from"]',
      ),
    ).toBeNull();
  });

  // Why: a creator filling in a picture's words must see which of them
  // the chosen view shows the visitor, and where: a caption typed for a
  // view that never shows it is work lost. Every view the chips offer has
  // a mark for each dock field.
  it("marks each dock field with where the view shows it, or that it does not", () => {
    expect(pictureFieldMark("framed", "caption")).toBe(
      "Used by Framed: the plate (its first lines) and the sheet.",
    );
    expect(pictureFieldMark("plane", "caption")).toBe("Not used by Plane.");
    expect(pictureFieldMark("cutout", "alt")).toBe("Not used by Cut-out.");
    expect(pictureFieldMark("thenNow", "year")).toContain("the slider");
    expect(pictureFieldMark("card", "caption")).toBeNull();
    expect(pictureFieldMark("framed", "widthM")).toBeNull();
    for (const { view } of PICTURE_VIEW_CHOICES) {
      for (const field of ["title", "caption", "alt", "credit", "year"]) {
        expect(pictureFieldMark(view, field)).not.toBeNull();
      }
    }
    const { panel } = panelWith(true);
    const host = drawn(
      panel
        .sync(item({ view: "finder", showTag: true, imagePath: null }))!
        .parts(),
    );
    expect(host.querySelector(".pviewpoint .use")?.textContent).toContain(
      "Used by Finder",
    );
  });

  it("offers a viewpoint to a viewpoint view without one, and none without the edit", () => {
    const { panel } = panelWith(true);
    const bare = item({ view: "window", showTag: true, imagePath: null });
    const host = drawn(panel.sync(bare)!.parts());
    expect(host.querySelectorAll("[data-field]")).toHaveLength(0);
    expect(
      host.querySelector('[data-act="picture-viewpoint-new"]')?.textContent,
    ).toBe("Stand in front of it");
    const noEdit = createPicturePanel({
      setView: () => "written",
      seeThrough: () => Promise.resolve(true),
      changed: () => undefined,
    });
    const without = drawn(noEdit.sync(bare)!.parts());
    expect(
      without.querySelector('[data-act="picture-viewpoint-new"]'),
    ).toBeNull();
    expect(noEdit.act("picture-viewpoint-new", bare, "p1")).toBe(false);
  });

  it("switches a cut-out's tag", () => {
    const { panel, deps } = panelWith(true);
    const shown = item({ view: "cutout", showTag: true, imagePath: "a.png" });
    const host = drawn(panel.sync(shown)!.parts());
    const tag = host.querySelector('[data-act="picture-tag"]');
    expect(tag?.getAttribute("aria-pressed")).toBe("true");
    panel.act("picture-tag", shown, "p1");
    expect(deps.setTag).toHaveBeenLastCalledWith("p1", false);
    const hidden = item({ view: "cutout", showTag: false, imagePath: "a.png" });
    panel.act("picture-tag", hidden, "p1");
    expect(deps.setTag).toHaveBeenLastCalledWith("p1", true);
  });

  it("warns for a cut-out without see-through parts once checked, asking once", async () => {
    const { panel, deps } = panelWith(false);
    const cut = item({ view: "cutout", showTag: true, imagePath: "a.jpg" });
    const before = panel.sync(cut)!;
    expect(drawn(before.parts()).textContent).not.toContain(NO_ALPHA_WARNING);
    await settle();
    expect(deps.changed).toHaveBeenCalledTimes(1);
    const after = panel.sync(cut)!;
    // The draw's key changes with the answer, so the dock draws again.
    expect(after.key).not.toBe(before.key);
    const warn = drawn(after.parts()).querySelector('[role="status"]');
    expect(warn?.textContent).toBe(NO_ALPHA_WARNING);
    panel.sync(cut);
    expect(deps.seeThrough).toHaveBeenCalledTimes(1);
  });

  it("says nothing for a real cut-out or one it cannot check", async () => {
    for (const answer of [true, null]) {
      const { panel } = panelWith(answer);
      const cut = item({ view: "cutout", showTag: true, imagePath: "a.png" });
      panel.sync(cut);
      await settle();
      expect(drawn(panel.sync(cut)!.parts()).textContent).not.toContain(
        NO_ALPHA_WARNING,
      );
    }
  });

  it("checks the picture when the cut-out is picked, before the view is back", () => {
    const { panel, deps } = panelWith(false);
    const framed = item({ view: "framed", showTag: true, imagePath: "a.png" });
    panel.sync(framed);
    expect(deps.seeThrough).not.toHaveBeenCalled();
    panel.act("picture-view:cutout", framed, "p1");
    expect(deps.seeThrough).toHaveBeenCalledWith("a.png");
  });
});
