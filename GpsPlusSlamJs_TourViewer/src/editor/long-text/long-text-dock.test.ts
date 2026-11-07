// @vitest-environment jsdom
/**
 * Why these tests matter: a phone hides the long text's preview by its
 * styles, and the preview cost it all the same: a page laid out and its
 * pictures read on every change of the text, for nothing on the screen. So
 * no preview exists on a phone, and one turned wide gets it back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InspectorLongText } from "../editor-shell/inspector-model.js";
import { createLongTextDock, type LongTextDock } from "./long-text-dock.js";

const TEXT = {
  blockId: "text-1",
  over: "The old gate",
  title: "A long text",
  body: "# Hello",
  view: "phone",
  pictures: [],
} as unknown as InspectorLongText;

const preview = () => document.querySelector(".lw-pv");

function widthIs(px: number): void {
  vi.stubGlobal("innerWidth", px);
}

function dock(): LongTextDock {
  const box = document.createElement("div");
  const inspectorRoot = document.createElement("div");
  document.body.append(box, inspectorRoot);
  return createLongTextDock({
    document,
    box,
    inspectorRoot,
    treeRoot: null,
    kept: { get: () => new Set(), set: () => undefined },
    writeBody: () => ({ kind: "edited" }) as never,
    writeView: () => ({ kind: "edited" }) as never,
    readNarration: (() => null) as never,
    editNarration: (() => undefined) as never,
    loadPicture: () => Promise.reject(new Error("none")),
    say: () => undefined,
    changed: () => undefined,
  });
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the long text's preview by the window's width", () => {
  it("is there on a desktop", () => {
    widthIs(1200);
    expect(dock().sync(TEXT)).not.toBeNull();
    expect(preview()).not.toBeNull();
  });

  it("is not built on a phone, and the writer still shows", () => {
    widthIs(390);
    expect(dock().sync(TEXT)).not.toBeNull();
    expect(preview()).toBeNull();
  });

  it("comes when the phone turns wide, and goes when it turns back", () => {
    widthIs(390);
    const d = dock();
    d.sync(TEXT);
    widthIs(900);
    d.sync(TEXT);
    expect(preview()).not.toBeNull();
    widthIs(390);
    d.sync(TEXT);
    expect(preview()).toBeNull();
  });

  it("does not open for a Preview button pressed on a phone", () => {
    widthIs(390);
    const d = dock();
    d.sync(TEXT);
    expect(d.act("lt-preview")).toBe(true);
    expect(preview()).toBeNull();
  });
});
