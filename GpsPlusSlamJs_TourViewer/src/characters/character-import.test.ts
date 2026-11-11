// @vitest-environment jsdom
/**
 * "Import character..." as one flow for the maker and the editor: refused
 * in words, a name asked for where none came with the file, cancelled.
 *
 * Why these tests matter: the maker and the tour editor both import with
 * this flow; a refusal said nowhere, or a question that never resolves,
 * would leave a press with no outcome in either place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImportRefusal } from "./character-exchange.js";
import {
  createImportFlow,
  IMPORT_MAX_BYTES,
  readCharacterFile,
  type ReadCharacter,
} from "./character-import.js";
import { ImportRefusal as Refusal } from "./character-exchange.js";

Element.prototype.scrollIntoView = function () {};
URL.createObjectURL = () => "blob:x";
URL.revokeObjectURL = () => {};

const png = () => new Blob([new Uint8Array(8)], { type: "image/png" });
const character = (name: string): ReadCharacter => ({
  name,
  steady: true,
  describedAs: "",
  note: "",
  framesBlob: png(),
  imageBlob: png(),
});

function setup(read: (file: Blob) => Promise<ReadCharacter>) {
  document.body.innerHTML =
    '<div id="e" hidden></div><div id="a" hidden></div>';
  const errBox = document.getElementById("e") as HTMLElement;
  const askBox = document.getElementById("a") as HTMLElement;
  const toast = vi.fn();
  const chooseAgain = vi.fn();
  const phases: string[] = [];
  const flow = createImportFlow({
    errBox,
    askBox,
    chooseAgain,
    toast,
    read,
    during: (phase, work) => {
      phases.push(`${phase} start`);
      return work().finally(() => phases.push(`${phase} end`));
    },
  });
  return { errBox, askBox, toast, chooseAgain, flow, phases };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("createImportFlow", () => {
  it("a refusal draws its card and its toast, and resolves to nothing", async () => {
    const s = setup(() =>
      Promise.reject(new ImportRefusal("This is not a character", "No poses.")),
    );
    expect(await s.flow(png())).toBeNull();
    expect(s.errBox.hidden).toBe(false);
    expect(s.errBox.textContent).toContain("This is not a character");
    expect(s.errBox.textContent).toContain("No poses.");
    expect(s.toast).toHaveBeenCalledWith(
      "Not imported: this is not a character",
      true,
    );
    s.errBox.querySelector<HTMLButtonElement>("[data-again]")?.click();
    expect(s.chooseAgain).toHaveBeenCalledOnce();
    s.errBox.querySelector<HTMLButtonElement>("[data-dismiss]")?.click();
    expect(s.errBox.hidden).toBe(true);
  });

  it("an unexpected error is still refused in words", async () => {
    const s = setup(() => Promise.reject(new Error("boom")));
    expect(await s.flow(png())).toBeNull();
    expect(s.errBox.textContent).toContain("This file did not work");
  });

  it("escapes what it draws", async () => {
    const s = setup(() =>
      Promise.reject(new ImportRefusal("<b>x</b>", "<i>y</i>")),
    );
    await s.flow(png());
    expect(s.errBox.querySelector("b, i")).toBeNull();
  });

  it("a named file is accepted at once", async () => {
    const s = setup(() => Promise.resolve(character("Rita")));
    expect((await s.flow(png()))?.name).toBe("Rita");
    expect(s.askBox.hidden).toBe(true);
  });

  it("a file without a name asks for one, refuses an empty name, keeps the given one", async () => {
    const s = setup(() => Promise.resolve(character("")));
    const out = s.flow(png());
    await tick();
    expect(s.askBox.hidden).toBe(false);
    const input = s.askBox.querySelector<HTMLInputElement>("[data-name]");
    const keep = s.askBox.querySelector<HTMLButtonElement>("[data-keep]");
    keep?.click();
    expect(s.askBox.querySelector<HTMLElement>("[data-msg]")?.hidden).toBe(
      false,
    );
    if (input) input.value = "  Max  ";
    keep?.click();
    expect((await out)?.name).toBe("Max");
    expect(s.askBox.hidden).toBe(true);
  });

  it("Cancel imports nothing and says so", async () => {
    const s = setup(() => Promise.resolve(character("")));
    const out = s.flow(png());
    await tick();
    s.askBox.querySelector<HTMLButtonElement>("[data-cancel]")?.click();
    expect(await out).toBeNull();
    expect(s.toast).toHaveBeenCalledWith("Not imported");
  });

  it("a second file cancels the open question", async () => {
    const s = setup(() => Promise.resolve(character("")));
    const first = s.flow(png());
    await tick();
    void s.flow(png());
    expect(await first).toBeNull();
  });
});

describe("the name question's own state", () => {
  // Why: the button said "Reading the file..." for as long as the name
  // question stood open, so the page claimed to be reading while it was
  // waiting for the author. The question is a phase of its own.
  it("reading and asking are separate phases, in that order", async () => {
    const s = setup(() => Promise.resolve(character("")));
    const out = s.flow(png());
    await tick();
    expect(s.phases).toEqual(["reading start", "reading end", "asking start"]);
    s.askBox.querySelector<HTMLInputElement>("[data-name]")!.value = "Rita";
    s.askBox.querySelector<HTMLButtonElement>("[data-keep]")?.click();
    expect((await out)?.name).toBe("Rita");
    expect(s.phases.at(-1)).toBe("asking end");
  });

  // Why: a named file asks nothing, so no asking phase may show.
  it("a named file has only the reading phase", async () => {
    const s = setup(() => Promise.resolve(character("Max")));
    await s.flow(png());
    expect(s.phases).toEqual(["reading start", "reading end"]);
  });

  // Why: the list or the maker's library may close while the question
  // stands; the question must settle then, or the Import button stays
  // disabled for good.
  it("cancel settles an open question with nothing, quietly", async () => {
    const s = setup(() => Promise.resolve(character("")));
    const out = s.flow(png());
    await tick();
    s.flow.cancel();
    expect(await out).toBeNull();
    expect(s.askBox.hidden).toBe(true);
    expect(s.toast).not.toHaveBeenCalled();
    expect(s.phases.at(-1)).toBe("asking end");
    // nothing open: a cancel changes nothing
    s.flow.cancel();
  });
});

describe("readCharacterFile", () => {
  // Why: an exchange file is a 2048 x 1024 PNG (at most about 8.4 MB even
  // with no compression at all). A larger file is refused by its size,
  // before it is read into memory whole.
  it("refuses a file larger than an exchange file can be, without reading it", async () => {
    const arrayBuffer = vi.fn();
    const big = {
      size: IMPORT_MAX_BYTES + 1,
      type: "image/png",
      arrayBuffer,
    } as unknown as Blob;
    await expect(readCharacterFile(big)).rejects.toBeInstanceOf(Refusal);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  // Why: the cap must leave room for any real exchange file.
  it("the cap is above the largest exchange file", () => {
    const rawRgba = 2048 * 1024 * 4 + 1024; // one filter byte per row
    expect(IMPORT_MAX_BYTES).toBeGreaterThan(rawRgba * 1.01 + 64 * 1024);
  });
});
