// @vitest-environment jsdom
/**
 * Why these tests matter: the check page is what a person (and the e2e)
 * builds a synthetic walk with; its state attribute is the only thing the
 * e2e waits on, so a build that fails must say so and free the button
 * rather than leave the page "building" for ever.
 */
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE } from "gps-plus-slam-app-framework/ar/depth-sampler";

import { readSplatInputs } from "../../splat-trainer/recording-reader.js";
import { startSplatSceneCheck } from "./splat-scene-check.js";

const PAGE = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "splat-scene-check.html",
  ),
  "utf8",
);

/** A JPEG's start and end markers: the reader never decodes a photo. */
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

beforeEach(() => {
  // The page's own markup, without its module script.
  document.body.innerHTML = (/<body>([\s\S]*)<script type="module">/.exec(
    PAGE,
  ) ?? ["", ""])[1]!;
  // jsdom's Blob cannot be streamed, which the zip writer and reader do;
  // a browser's can, and so can node's.
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  URL.createObjectURL = vi.fn(() => "blob:walk");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const state = (): HTMLElement => document.getElementById("state")!;
const build = (): HTMLButtonElement =>
  document.getElementById("build") as HTMLButtonElement;

describe("the synthetic splat scene's check page", () => {
  it("builds a walk, reads it back and offers the zip", async () => {
    (document.getElementById("frames") as HTMLInputElement).value = "5";
    (document.getElementById("walk") as HTMLSelectElement).value = "loop";
    const seen: string[] = [];
    const run = startSplatSceneCheck(document, {
      render: (poses, _w, _h, _p, onFrame) => {
        seen.push(state().dataset.state ?? "");
        expect(build().disabled).toBe(true);
        poses.forEach((_, i) => onFrame?.(i));
        return Promise.resolve(poses.map(() => PHOTO));
      },
    });
    await run();
    expect(seen).toEqual(["building"]);
    expect(state().dataset.state).toBe("read");
    expect(state().textContent).toContain("Read: 5 frames of 320 x 240");
    expect(build().disabled).toBe(false);
    const save = document.getElementById("save") as HTMLAnchorElement;
    expect(save.hidden).toBe(false);
    expect(save.download).toBe("synthetic-loop-walk.zip");
    expect(
      (document.getElementById("first-photo") as HTMLImageElement).hidden,
    ).toBe(false);
  });

  it("says why a build failed and frees the button", async () => {
    const run = startSplatSceneCheck(document, {
      render: () => Promise.reject(new Error("no WebGL here")),
    });
    await run();
    expect(state().dataset.state).toBe("error");
    expect(state().textContent).toBe("Building failed: no WebGL here");
    expect(build().disabled).toBe(false);
    expect((document.getElementById("save") as HTMLAnchorElement).hidden).toBe(
      true,
    );
  });

  it("refuses a walk of one photo in words", async () => {
    (document.getElementById("frames") as HTMLInputElement).value = "1";
    const render = vi.fn();
    const run = startSplatSceneCheck(document, { render });
    await run();
    expect(render).not.toHaveBeenCalled();
    expect(state().dataset.state).toBe("error");
    expect(state().textContent).toMatch(/at least 2 frames/);
  });

  // Why: the walk is meant to look like a recording of the recorder, which
  // samples depth on its reconstruction grid; a coarser grid would make the
  // trainer's seeds sparser than any real recording's.
  it("samples depth on the recorder's reconstruction grid", async () => {
    (document.getElementById("frames") as HTMLInputElement).value = "3";
    const run = startSplatSceneCheck(document, {
      render: (poses) => Promise.resolve(poses.map(() => PHOTO)),
    });
    await run();
    const file = vi
      .mocked(URL.createObjectURL)
      .mock.calls.map(([b]) => b)
      .find((b): b is File => b instanceof NodeFile);
    expect(file).toBeDefined();
    const read = await readSplatInputs(file!);
    if (read.kind !== "read") throw new Error(read.reason);
    expect(read.inputs.depthSamples[0]!.points.length).toBe(
      DEFAULT_RECONSTRUCTION_DEPTH_GRID_SIZE ** 2,
    );
  });

  // Why: the frame field's max is only a hint to the browser; a typed or
  // scripted 5000 must not render thousands of photos and run the tab out
  // of memory.
  it("caps the walk at the field's maximum of frames", async () => {
    (document.getElementById("frames") as HTMLInputElement).value = "5000";
    let rendered = 0;
    const run = startSplatSceneCheck(document, {
      render: (poses) => {
        rendered = poses.length;
        return Promise.resolve(poses.map(() => PHOTO));
      },
    });
    await run();
    expect(rendered).toBe(400);
    expect(state().textContent).toContain("Read: 400 frames");
  }, 30_000);
});
