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
} from "./picture-panel.js";

function item(picture: NonNullable<PanelItem["picture"]>): PanelItem {
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
    picture,
  };
}

function panelWith(answer: boolean | null) {
  const deps = {
    setView: vi.fn((): "written" => "written"),
    setTag: vi.fn((): "written" => "written"),
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
    const { panel } = panelWith(true);
    const host = drawn(
      panel
        .sync(item({ view: "thenNow", showTag: true, imagePath: null }))!
        .parts(),
    );
    expect(host.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(host.textContent).toContain(OTHER_VIEW_NOTE);
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
