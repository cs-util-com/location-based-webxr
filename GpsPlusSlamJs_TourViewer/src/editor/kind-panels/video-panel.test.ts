/**
 * Why these tests matter: the creator sets how a free video starts and
 * whether it starts with its sound, and that is these chips. They hold
 * that the panel shows the view and the choices of the selected video
 * with the one in use pressed, that a press writes exactly that view or
 * choice (and nothing for the chip already pressed, which would be an
 * empty undo step), and that it leaves other acts and a choice of
 * another view to the shell.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import type { PanelItem } from "./kind-panel.js";
import { createVideoPanel, VIDEO_VIEW_CHOICES } from "./video-panel.js";

function videoItem(
  view: string,
  choices: NonNullable<PanelItem["video"]>["choices"],
  captions = "",
): PanelItem {
  return {
    kind: "item",
    itemKind: "video",
    title: "Welcome",
    sub: "Video in Gate",
    stationId: "s",
    text: null,
    extent: null,
    fields: [],
    model: null,
    longText: null,
    video: { view, choices, captions },
    offset: { northM: 0, upM: 0, eastM: 0 },
    headingDeg: 0,
    turns: true,
    groundOffM: null,
  };
}

const START = {
  name: "start",
  label: "Starts",
  value: "enter",
  values: [
    { value: "enter", label: "On arrival" },
    { value: "near", label: "When near" },
  ],
};
const LOOP = {
  name: "loop",
  label: "Loop",
  value: "off",
  values: [
    { value: "off", label: "Plays once" },
    { value: "on", label: "Loops" },
  ],
};
const ALPHA = {
  name: "alpha",
  label: "Background",
  value: "none",
  values: [
    { value: "none", label: "As filmed" },
    { value: "stacked", label: "Stacked alpha" },
  ],
};

function panel() {
  const deps = {
    writeView: vi.fn((): "written" => "written"),
    writeChoice: vi.fn((): "written" => "written"),
  };
  return { panel: createVideoPanel(deps), deps };
}

function pressed(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[aria-pressed="true"]')].map(
    (b) => b.getAttribute("data-act") ?? "",
  );
}

describe("the video panel", () => {
  it("offers the format's free video views", () => {
    expect(VIDEO_VIEW_CHOICES.map((c) => c.value)).toEqual([
      "screen",
      "cutout",
      "porthole",
    ]);
  });

  it("draws nothing for another kind or no selection", () => {
    const { panel: p } = panel();
    expect(p.sync(null)).toBeNull();
    expect(p.sync({ ...videoItem("screen", []), video: null })).toBeNull();
  });

  it("shows the view and each choice with the one in use pressed", () => {
    const { panel: p } = panel();
    const draw = p.sync(videoItem("cutout", [START, ALPHA]));
    const root = document.createElement("div");
    root.append(...(draw?.parts() ?? []));
    expect(pressed(root)).toEqual([
      "video-view:cutout",
      "video-set:start:enter",
      "video-set:alpha:none",
    ]);
    // A cutout as filmed says what a clean edge needs.
    expect(root.textContent).toContain("stacked-alpha video");
  });

  it("writes a pressed view or choice, and nothing for the one in use", () => {
    const { panel: p, deps } = panel();
    const item = videoItem("screen", [START]);
    expect(p.act("video-view:porthole", item, "v")).toBe(true);
    expect(p.act("video-view:screen", item, "v")).toBe(true);
    expect(p.act("video-set:start:near", item, "v")).toBe(true);
    expect(p.act("video-set:start:enter", item, "v")).toBe(true);
    expect(deps.writeView.mock.calls).toEqual([["v", "porthole"]]);
    expect(deps.writeChoice.mock.calls).toEqual([["v", "start", "near"]]);
  });

  // Why: a loop is on or off, so it is one switch (its state said to a
  // screen reader), and a press writes the other value, never the same.
  it("draws the loop as one switch that writes the other value", () => {
    const { panel: p, deps } = panel();
    const root = document.createElement("div");
    root.append(...(p.sync(videoItem("screen", [LOOP]))?.parts() ?? []));
    const loop = root.querySelector<HTMLElement>('[role="switch"]');
    expect(loop?.textContent).toBe("Loop");
    expect(loop?.getAttribute("aria-checked")).toBe("false");
    expect(loop?.dataset["act"]).toBe("video-set:loop:on");
    expect(root.textContent).not.toContain("Plays once");
    expect(p.act("video-set:loop:on", videoItem("screen", [LOOP]), "v")).toBe(
      true,
    );
    expect(deps.writeChoice.mock.calls).toEqual([["v", "loop", "on"]]);
  });

  // Why: WebVTT is typed or pasted by hand; the creator must see how many
  // cues were read and what was left out before a visitor meets it.
  it("says how many caption cues it read, and why none", () => {
    const { panel: p } = panel();
    const text = (captions: string) => {
      const root = document.createElement("div");
      root.append(
        ...(p.sync(videoItem("screen", [], captions))?.parts() ?? []),
      );
      return root.textContent ?? "";
    };
    expect(text("WEBVTT\n\n00:00.000 --> 00:01.000\nHi")).toContain(
      "Captions: 1 cue · 2 characters",
    );
    expect(text("Hi")).toContain("Captions: Not read");
    expect(text("")).not.toContain("Captions:");
  });

  it("leaves other acts and a choice of another view to the shell", () => {
    const { panel: p, deps } = panel();
    const item = videoItem("screen", [START]);
    expect(p.act("view:placed", item, "v")).toBe(false);
    expect(p.act("video-set:alpha:stacked", item, "v")).toBe(false);
    expect(deps.writeChoice).not.toHaveBeenCalled();
  });
});
