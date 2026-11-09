/**
 * Why these tests matter: the picker is the add's first step, and a
 * picker that never settles leaves the add hanging; one that settles a
 * closed picker with a file adds what nobody chose. It must offer only the
 * files a tour takes for the kind, settle with the chosen file or with
 * null on a cancel, and never leave an earlier pick open.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { acceptFor, createFilePicker } from "./file-picker.js";

afterEach(() => {
  document.body.replaceChildren();
});

function inputOf(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="add-file-input"]',
  );
  if (input === null) throw new Error("no input");
  return input;
}

function choose(input: HTMLInputElement, file: File | null): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: file === null ? [] : [file],
  });
  input.dispatchEvent(new Event("change"));
}

describe("acceptFor", () => {
  it("lists every extension the tour takes for the kind, and no other", () => {
    expect(acceptFor("model")).toBe(".glb");
    expect(acceptFor("video")).toBe(".mp4,.webm");
    const image = acceptFor("image").split(",");
    expect(image).toEqual(
      expect.arrayContaining([".jpg", ".jpeg", ".png", ".webp"]),
    );
    expect(image).not.toContain(".mp3");
    expect(acceptFor("audio").split(",")).toEqual(
      expect.arrayContaining([".mp3", ".ogg", ".wav", ".opus"]),
    );
  });
});

describe("createFilePicker", () => {
  it("opens a hidden input for the kind and settles with the file chosen", async () => {
    const picker = createFilePicker(document.body);
    const input = inputOf();
    const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
    const picked = picker.pick("audio");
    expect(input.hidden).toBe(true);
    expect(input.accept).toBe(acceptFor("audio"));
    expect(click).toHaveBeenCalledTimes(1);
    const file = new File(["RIFF"], "bells.wav");
    choose(input, file);
    expect(await picked).toBe(file);
  });

  it("settles with null on a cancel, or a change with no file", async () => {
    const picker = createFilePicker(document.body);
    const input = inputOf();
    vi.spyOn(input, "click").mockImplementation(() => undefined);
    const cancelled = picker.pick("model");
    input.dispatchEvent(new Event("cancel"));
    expect(await cancelled).toBeNull();
    const empty = picker.pick("model");
    choose(input, null);
    expect(await empty).toBeNull();
  });

  // Why: a second add while the first picker hangs (a picker the browser
  // closed without a cancel event) must not leave the first add waiting.
  it("settles an earlier pick with null when picked again", async () => {
    const picker = createFilePicker(document.body);
    const input = inputOf();
    vi.spyOn(input, "click").mockImplementation(() => undefined);
    const first = picker.pick("image");
    const second = picker.pick("video");
    expect(await first).toBeNull();
    expect(input.accept).toBe(acceptFor("video"));
    const file = new File(["mp4"], "flood.mp4");
    choose(input, file);
    expect(await second).toBe(file);
  });

  // Why: the shelf's "Add files..." takes several files of any kind a
  // tour takes at once; a single pick after it must not stay multiple.
  it("picks several files of every kind, and a later pick is single again", async () => {
    const picker = createFilePicker(document.body);
    const input = inputOf();
    vi.spyOn(input, "click").mockImplementation(() => undefined);
    const many = picker.pickMany();
    expect(input.multiple).toBe(true);
    expect(input.accept.split(",")).toEqual(
      expect.arrayContaining([".glb", ".mp4", ".jpg", ".mp3"]),
    );
    const a = new File(["a"], "a.jpg");
    const b = new File(["b"], "b.glb");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [a, b],
    });
    input.dispatchEvent(new Event("change"));
    expect(await many).toEqual([a, b]);
    const cancelled = picker.pickMany();
    input.dispatchEvent(new Event("cancel"));
    expect(await cancelled).toEqual([]);
    void picker.pick("audio");
    expect(input.multiple).toBe(false);
  });
});
