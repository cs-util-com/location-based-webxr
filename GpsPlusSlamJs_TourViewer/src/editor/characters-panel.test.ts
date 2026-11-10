// @vitest-environment jsdom
/**
 * The tour editor's Characters list against a library and a tour held in
 * memory: each action (add, add all, not now, remove and undo, make,
 * import, the add menu's make-and-add), each refusal and each busy state,
 * on success and on failure.
 *
 * Why these tests matter: the list is the only way a character made on
 * this device reaches a tour. A press that shows no work, a refusal said
 * nowhere, or a "new" character missed after the maker closed would each
 * leave the author thinking a character is in the tour when it is not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TourCharacter } from "gps-plus-slam-app-framework/ar/tour-characters";

import type * as CharacterImport from "../characters/character-import.js";
import type { CharacterLibrary } from "../characters/character-library.js";
import type { CharacterRecord } from "../characters/character-record.js";
import { ImportRefusal } from "../characters/character-exchange.js";
import {
  createCharactersPanel,
  type CharactersPanelDom,
  type CharactersPanelTour,
  type SeenStore,
} from "./characters-panel.js";

vi.mock("../characters/character-thumb.js", () => ({
  cropThumb: () => Promise.resolve(""),
  whenMade: () => "made today, 10:00",
}));
const readFile = vi.fn();
vi.mock("../characters/character-import.js", async (load) => {
  const real = await load<typeof CharacterImport>();
  return {
    ...real,
    createImportFlow: (deps: Parameters<typeof real.createImportFlow>[0]) =>
      real.createImportFlow({ ...deps, read: readFile }),
  };
});

// jsdom has no modal dialogs: open and close as a browser does.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  if (!this.open) return;
  this.open = false;
  this.dispatchEvent(new Event("close"));
};
Element.prototype.scrollIntoView = function () {};

const MARKUP = `
<dialog id="panel"><button id="close"></button>
<span id="count"></span><ul id="tour"></ul><div id="undo"></div>
<div id="pickup" hidden></div><span id="status"></span><ul id="lib"></ul>
<button id="make">Make a character</button>
<button id="import">Import character...</button><input id="file" type="file" />
<div id="err" hidden></div><div id="ask" hidden></div>
<button id="manage"></button><div id="toasts"></div></dialog>
<dialog id="maker"><button id="back"></button><span id="tourname"></span>
<iframe id="frame"></iframe></dialog>`;

function dom(): CharactersPanelDom {
  document.body.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  return {
    panel: $("panel"),
    close: $("close"),
    tourList: $("tour"),
    tourCount: $("count"),
    pickup: $("pickup"),
    libList: $("lib"),
    libStatus: $("status"),
    make: $("make"),
    importButton: $("import"),
    importFile: $("file"),
    importError: $("err"),
    importAsk: $("ask"),
    manage: $("manage"),
    toasts: $("toasts"),
    undoBox: $("undo"),
    maker: $("maker"),
    makerFrame: $("frame"),
    makerBack: $("back"),
    makerTour: $("tourname"),
  };
}

const png = (): Blob => new Blob([new Uint8Array(8)], { type: "image/png" });

function record(id: string, name: string, at = "2026-11-10T10:00:00.000Z") {
  return {
    format: 1,
    libraryId: id,
    name,
    autoName: false,
    createdAtIso: at,
    steady: true,
    describedAs: "",
    tool: "character maker",
  } satisfies CharacterRecord;
}

/** A library in memory; `failNext` makes the next call of a method throw. */
function memoryLibrary(initial: CharacterRecord[] = []) {
  const entries = [...initial];
  const fail = new Set<string>();
  let n = 0;
  const check = (what: string) => {
    if (fail.delete(what)) throw new Error(`${what} broke`);
  };
  const lib: CharacterLibrary = {
    save: vi.fn(async (req: Parameters<CharacterLibrary["save"]>[0]) => {
      check("save");
      n += 1;
      const rec = record(`new${String(n)}`, req.name, new Date().toISOString());
      entries.unshift(rec);
      return Promise.resolve(rec);
    }),
    list: vi.fn(async () => {
      check("list");
      return Promise.resolve({ entries: [...entries], interrupted: 0 });
    }),
    rename: vi.fn(),
    remove: vi.fn(),
    files: vi.fn(async (id: string) => {
      check("files");
      const rec = entries.find((e) => e.libraryId === id);
      if (!rec) throw new Error("gone");
      // Each character's own four poses, so the tour tells them apart.
      return Promise.resolve({
        record: rec,
        frames: new Blob([`poses of ${id}`], { type: "image/png" }),
        image: png(),
      });
    }),
    tidy: vi.fn(),
  };
  return {
    lib,
    entries,
    failNext: (what: string) => fail.add(what),
  };
}

/** A tour in memory, with a refusal to give on the next declare. It
 *  mints its own ids (`t1`, `t2`, ...) and names a file by its text, as
 *  the real tour names one by its bytes. */
function memoryTour() {
  const chars: TourCharacter[] = [];
  let refuseNext: string | null = null;
  let gate: Promise<void> | null = null;
  let minted = 0;
  const fileId = async (file: Blob) => `file:${await file.text()}`;
  const tour: CharactersPanelTour = {
    characters: () => chars,
    declare: vi.fn(
      async (input: Parameters<CharactersPanelTour["declare"]>[0]) => {
        if (gate) await gate;
        if (refuseNext !== null) {
          const reason = refuseNext;
          refuseNext = null;
          return { kind: "refused" as const, reason };
        }
        minted += 1;
        const character = {
          id: `t${String(minted)}`,
          name: input.name,
          image: await fileId(input.image),
          frames: await fileId(input.frames),
        };
        chars.push(character);
        return { kind: "declared" as const, character };
      },
    ),
    fileId,
    remove: vi.fn((id: string) => {
      const at = chars.findIndex((c) => c.id === id);
      if (at < 0) return { kind: "refused" as const, reason: "not here" };
      chars.splice(at, 1);
      return { kind: "removed" as const };
    }),
    restore: vi.fn((c: TourCharacter) => {
      chars.push(c);
      return { kind: "declared" as const };
    }),
    image: () => Promise.resolve(undefined),
    title: () => "Old Town Walk",
  };
  return {
    tour,
    chars,
    refuseNext: (r: string) => (refuseNext = r),
    hold: () => {
      let release = () => {};
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
  };
}

function memorySeen(ids: string[] | null = null): SeenStore & {
  ids: string[] | null;
} {
  return {
    ids,
    read() {
      return this.ids;
    },
    write(next) {
      this.ids = [...next];
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
async function settled(times = 6) {
  for (let i = 0; i < times; i++) await settle();
}

function setup(
  opts: {
    lib?: CharacterRecord[];
    seen?: string[] | null;
  } = {},
) {
  const d = dom();
  const library = memoryLibrary(opts.lib);
  const t = memoryTour();
  const said: string[] = [];
  const shown: boolean[] = [];
  const seen = memorySeen(opts.seen === undefined ? null : opts.seen);
  const panel = createCharactersPanel({
    dom: d,
    tour: () => t.tour,
    library: () => Promise.resolve(library.lib),
    makerUrl: "./characters.html",
    say: (text) => said.push(text),
    seen,
    now: () => new Date("2026-11-10T12:34:00Z"),
    makerShown: (on) => shown.push(on),
  });
  const toasts = () => d.toasts.textContent ?? "";
  const libRow = (id: string) =>
    d.libList.querySelector<HTMLElement>(`li[data-id="${id}"]`);
  return { d, library, t, said, shown, seen, panel, toasts, libRow };
}

beforeEach(() => {
  readFile.mockReset();
});

describe("opening the list", () => {
  it("lists the device's characters; on the first look ever none is new", async () => {
    const s = setup({ lib: [record("c1", "Rita"), record("c2", "Max")] });
    s.panel.open();
    await settled();
    expect(s.d.panel.open).toBe(true);
    expect(s.libRow("c1")?.textContent).toContain("Rita");
    expect(s.libRow("c1")?.querySelector("[data-add]")).not.toBeNull();
    expect(s.d.pickup.hidden).toBe(true);
    expect(s.d.libStatus.textContent).toMatch(
      /^looked when this list opened, /,
    );
    expect(s.seen.ids).toEqual(["c1", "c2"]);
    expect(s.d.tourList.textContent).toContain("No character in this tour yet");
  });

  it("offers the characters made since the last look in the banner", async () => {
    const s = setup({
      lib: [record("c2", "Max"), record("c1", "Rita")],
      seen: ["c1"],
    });
    s.panel.open();
    await settled();
    expect(s.d.pickup.hidden).toBe(false);
    expect(s.d.pickup.textContent).toContain("New on this device: Max.");
    expect(s.d.pickup.textContent).toContain("Add Max to the tour");
    expect(s.libRow("c2")?.classList.contains("fresh")).toBe(true);
    expect(s.libRow("c2")?.textContent).toContain("New");
  });

  it("says in the list when the library cannot be read", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.library.failNext("list");
    s.panel.open();
    await settled();
    expect(s.toasts()).toContain(
      "The characters on this device could not be read: list broke",
    );
  });
});

describe("Add to tour", () => {
  it("shows Adding... while it works, then the character is in the tour", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.panel.open();
    await settled();
    const release = s.t.hold();
    const add = s.libRow("c1")?.querySelector<HTMLButtonElement>("[data-add]");
    add?.click();
    await settled();
    expect(add?.textContent).toBe("Adding...");
    expect(add?.disabled).toBe(true);
    release();
    await settled();
    expect(s.t.chars.map((c) => c.name)).toEqual(["Rita"]);
    expect(s.toasts()).toContain("Rita is in this tour now");
    expect(s.d.tourList.textContent).toContain("Rita");
    expect(s.libRow("c1")?.textContent).toContain("In this tour");
    expect(s.libRow("c1")?.querySelector("[data-add]")).toBeNull();
  });

  it("a refusal is said, the button back, nothing added", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.panel.open();
    await settled();
    s.t.refuseNext("This tour has at most 32 characters.");
    const add = s.libRow("c1")?.querySelector<HTMLButtonElement>("[data-add]");
    add?.click();
    await settled();
    expect(s.toasts()).toContain(
      "Rita was not added: This tour has at most 32 characters.",
    );
    expect(s.t.chars).toEqual([]);
    expect(add?.disabled).toBe(false);
    expect(add?.textContent).toBe("Add to tour");
  });

  it("a library that fails to hand the pictures over is said", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.panel.open();
    await settled();
    s.library.failNext("files");
    s.libRow("c1")?.querySelector<HTMLButtonElement>("[data-add]")?.click();
    await settled();
    expect(s.toasts()).toContain(
      "Adding did not work: files broke. Try again.",
    );
    expect(s.t.chars).toEqual([]);
  });
});

describe("the banner", () => {
  it("adds all new characters, and goes once they are in", async () => {
    const s = setup({
      lib: [record("c3", "Ada"), record("c2", "Max"), record("c1", "Rita")],
      seen: ["c1"],
    });
    s.panel.open();
    await settled();
    const all = s.d.pickup.querySelector<HTMLButtonElement>("[data-all]");
    expect(all?.textContent).toBe("Add all 2 to the tour");
    expect(s.d.pickup.textContent).toContain("Ada and Max");
    all?.click();
    await settled(10);
    expect(s.t.chars.map((c) => c.name).sort()).toEqual(["Ada", "Max"]);
    expect(s.d.pickup.hidden).toBe(true);
  });

  it("Not now hides it and adds nothing", async () => {
    const s = setup({ lib: [record("c2", "Max")], seen: [] });
    s.panel.open();
    await settled();
    s.d.pickup.querySelector<HTMLButtonElement>("[data-later]")?.click();
    await settled();
    expect(s.d.pickup.hidden).toBe(true);
    expect(s.t.chars).toEqual([]);
  });
});

describe("Remove", () => {
  it("removes the character and offers to undo it", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.t.chars.push({ id: "c1", name: "Rita", image: "a", frames: "b" });
    s.panel.open();
    await settled();
    s.d.tourList.querySelector<HTMLButtonElement>("[data-remove]")?.click();
    await settled();
    expect(s.t.chars).toEqual([]);
    expect(s.d.undoBox.textContent).toContain(
      "Rita is no longer in this tour. It stays on this device.",
    );
    s.d.undoBox.querySelector("button")?.click();
    await settled();
    expect(s.t.chars.map((c) => c.id)).toEqual(["c1"]);
    expect(s.d.tourList.textContent).toContain("Rita");
  });

  it("a refused remove is said and keeps the character", async () => {
    const s = setup();
    s.t.chars.push({ id: "c1", name: "Rita", image: "a", frames: "b" });
    s.t.tour.remove = () => ({
      kind: "refused",
      reason: "Rita still stands in the tour.",
    });
    s.panel.open();
    await settled();
    s.d.tourList.querySelector<HTMLButtonElement>("[data-remove]")?.click();
    await settled();
    expect(s.toasts()).toContain("Rita still stands in the tour.");
    expect(s.t.chars).toHaveLength(1);
  });
});

describe("the maker", () => {
  it("opens on a new character in the frame, and a close looks again", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.panel.open();
    await settled();
    s.d.make.click();
    expect(s.d.maker.open).toBe(true);
    expect(s.d.makerFrame.getAttribute("src")).toBe(
      "./characters.html?in=editor&start=new",
    );
    expect(s.d.makerTour.textContent).toBe("Old Town Walk");
    s.library.entries.unshift(record("c2", "Max"));
    s.d.makerBack.click();
    await settled();
    expect(s.d.makerFrame.getAttribute("src")).toBe("about:blank");
    expect(s.d.libStatus.textContent).toMatch(
      /^looked again when the maker closed, /,
    );
    expect(s.d.pickup.textContent).toContain("New on this device: Max.");
  });

  it("a close with nothing new says so", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.panel.open();
    await settled();
    s.d.manage.click();
    expect(s.d.makerFrame.getAttribute("src")).toBe(
      "./characters.html?in=editor",
    );
    s.d.maker.close();
    await settled();
    expect(s.toasts()).toContain("Nothing new on this device");
  });

  it("coming back to the tab looks again, only while the list shows", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    s.panel.open();
    await settled();
    s.library.entries.unshift(record("c2", "Max"));
    document.dispatchEvent(new Event("visibilitychange"));
    await settled();
    expect(s.d.libStatus.textContent).toMatch(
      /^looked again when you came back, /,
    );
    expect(s.d.pickup.textContent).toContain("Max");
    s.d.panel.close();
    const calls = vi.mocked(s.library.lib.list).mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    await settled();
    expect(vi.mocked(s.library.lib.list).mock.calls.length).toBe(calls);
  });
});

describe("makeForTour (the add menu's Character)", () => {
  it("adds the character saved while the maker was open, and hands it back", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    const made = s.panel.makeForTour();
    await settled();
    expect(s.d.maker.open).toBe(true);
    s.library.entries.unshift(record("c2", "Max", "2026-11-10T12:00:00.000Z"));
    s.d.maker.close();
    const got = await made;
    expect(got?.name).toBe("Max");
    expect(s.t.chars).toEqual([got]);
    expect(s.seen.ids).toContain("c2");
  });

  it("with nothing saved says so and hands nothing back", async () => {
    const s = setup({ lib: [record("c1", "Rita")] });
    const made = s.panel.makeForTour();
    await settled();
    s.d.maker.close();
    expect(await made).toBeNull();
    expect(s.said).toContain(
      "No new character was saved, so nothing was added",
    );
    expect(s.t.chars).toEqual([]);
  });

  it("a refused declaration is said and hands nothing back", async () => {
    const s = setup();
    const made = s.panel.makeForTour();
    await settled();
    s.library.entries.unshift(record("c2", "Max"));
    s.t.refuseNext("This tour has at most 32 characters.");
    s.d.maker.close();
    expect(await made).toBeNull();
    expect(s.said).toContain(
      "Max was not added: This tour has at most 32 characters.",
    );
  });

  it("a library it cannot read is said before the maker opens", async () => {
    const s = setup();
    s.library.failNext("list");
    expect(await s.panel.makeForTour()).toBeNull();
    expect(s.d.maker.open).toBe(false);
    expect(s.said[0]).toMatch(/could not be read: list broke/);
  });
});

describe("Import character...", () => {
  const accepted = (name: string) => ({
    name,
    steady: true,
    describedAs: "",
    note: "",
    framesBlob: png(),
    imageBlob: png(),
  });
  const choose = (s: ReturnType<typeof setup>) => {
    const file = new File([new Uint8Array(8)], "rita.png", {
      type: "image/png",
    });
    Object.defineProperty(s.d.importFile, "files", {
      value: [file],
      configurable: true,
    });
    s.d.importFile.dispatchEvent(new Event("change"));
  };

  it("reads, saves to this device and adds to the tour, the button showing each step", async () => {
    const s = setup({ lib: [] });
    s.panel.open();
    await settled();
    let release = () => {};
    readFile.mockImplementation(
      () => new Promise((r) => (release = () => r(accepted("Rita")))),
    );
    choose(s);
    await settled();
    expect(s.d.importButton.textContent).toBe("Reading the file...");
    expect(s.d.importButton.disabled).toBe(true);
    const hold = s.t.hold();
    release();
    await settled();
    expect(s.d.importButton.textContent).toBe("Importing...");
    hold();
    await settled(10);
    expect(s.library.lib.save).toHaveBeenCalledOnce();
    expect(s.t.chars.map((c) => c.name)).toEqual(["Rita"]);
    expect(s.toasts()).toContain(
      "Imported Rita: it is in this tour, and kept on this device",
    );
    expect(s.d.importButton.textContent).toBe("Import character...");
    expect(s.d.libStatus.textContent).toMatch(
      /^looked again after the import, /,
    );
    // the imported character is not offered as new afterwards
    expect(s.d.pickup.hidden).toBe(true);
  });

  it("a file that is no character is refused in its card, nothing saved", async () => {
    const s = setup();
    s.panel.open();
    await settled();
    readFile.mockRejectedValue(
      new ImportRefusal(
        "This is not a character sheet",
        "It has no four poses.",
      ),
    );
    choose(s);
    await settled();
    expect(s.d.importError.hidden).toBe(false);
    expect(s.d.importError.textContent).toContain(
      "This is not a character sheet",
    );
    expect(s.d.importError.textContent).toContain("Nothing was added.");
    expect(s.toasts()).toContain("Not imported: this is not a character sheet");
    expect(s.library.lib.save).not.toHaveBeenCalled();
    expect(s.d.importButton.disabled).toBe(false);
  });

  it("a saving that fails is said, nothing added", async () => {
    const s = setup();
    s.panel.open();
    await settled();
    readFile.mockResolvedValue(accepted("Rita"));
    s.library.failNext("save");
    choose(s);
    await settled(10);
    expect(s.toasts()).toContain("Importing did not work: save broke");
    expect(s.t.chars).toEqual([]);
    expect(s.d.importButton.textContent).toBe("Import character...");
  });

  // Why: while the name question stands the button says so (not that the
  // file is still being read), and closing the list settles the question,
  // so Import is never left disabled.
  it("the name question has its own state, and closing the list ends it", async () => {
    const s = setup();
    s.panel.open();
    await settled();
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => {};
    readFile.mockResolvedValue(accepted(""));
    choose(s);
    await settled();
    expect(s.d.importAsk.hidden).toBe(false);
    expect(s.d.importButton.textContent).toBe("Waiting for a name...");
    expect(s.d.importButton.disabled).toBe(true);
    s.d.panel.close();
    s.d.panel.dispatchEvent(new Event("close"));
    await settled(10);
    expect(s.d.importButton.disabled).toBe(false);
    expect(s.d.importButton.textContent).toBe("Import character...");
    expect(s.library.lib.save).not.toHaveBeenCalled();
  });

  // Why: the other way the question settles - the author names the
  // character - must free the button too and import him.
  it("naming the character ends the question and imports him", async () => {
    const s = setup();
    s.panel.open();
    await settled();
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => {};
    readFile.mockResolvedValue(accepted(""));
    choose(s);
    await settled();
    s.d.importAsk.querySelector<HTMLInputElement>("[data-name]")!.value =
      "Rita";
    s.d.importAsk.querySelector<HTMLButtonElement>("[data-keep]")?.click();
    await settled(10);
    expect(s.t.chars.map((c) => c.name)).toEqual(["Rita"]);
    expect(s.d.importButton.disabled).toBe(false);
    expect(s.d.importButton.textContent).toBe("Import character...");
  });

  it("a file without a name asks for one, and cancelling imports nothing", async () => {
    const s = setup();
    s.panel.open();
    await settled();
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => {};
    readFile.mockResolvedValue(accepted(""));
    choose(s);
    await settled();
    expect(s.d.importAsk.hidden).toBe(false);
    s.d.importAsk.querySelector<HTMLButtonElement>("[data-cancel]")?.click();
    await settled(10);
    expect(s.toasts()).toContain("Not imported");
    expect(s.library.lib.save).not.toHaveBeenCalled();
  });
});

describe("with the list closed", () => {
  it("says its lines on the page", async () => {
    const s = setup();
    const made = s.panel.makeForTour();
    await settled();
    s.d.maker.close();
    await made;
    expect(s.d.toasts.textContent).toBe("");
    expect(s.said).toHaveLength(1);
  });
});

describe("the tour's own character ids", () => {
  // Why: the device library's id tells when a character was made; a tour
  // is shared, so that id must never reach it. The tour mints its own id,
  // and the list still knows which device character is in the tour by
  // his four poses.
  it("declares without the device id and still shows him as in the tour", async () => {
    const s = setup({ lib: [record("c1777000000abcdef", "Rita")] });
    s.panel.open();
    await settled();
    s.libRow("c1777000000abcdef")
      ?.querySelector<HTMLButtonElement>("[data-add]")
      ?.click();
    await settled(10);
    const input = vi.mocked(s.t.tour.declare).mock.calls[0]?.[0];
    expect(Object.keys(input ?? {}).sort()).toEqual([
      "frames",
      "image",
      "name",
    ]);
    expect(s.t.chars.map((c) => c.id)).toEqual(["t1"]);
    expect(s.libRow("c1777000000abcdef")?.textContent).toContain(
      "In this tour",
    );
  });

  // Why: a tour opened later holds the character under its own id; the
  // list must still see that the device's character is in it (no "Add to
  // tour" offered twice), which only the four poses can tell.
  it("knows a character of an opened tour by his four poses", async () => {
    const s = setup({ lib: [record("c1", "Rita"), record("c2", "Max")] });
    s.t.chars.push({
      id: "k7",
      name: "Rita",
      image: "x",
      frames: "file:poses of c1",
    });
    s.panel.open();
    await settled(10);
    expect(s.libRow("c1")?.textContent).toContain("In this tour");
    expect(s.libRow("c1")?.querySelector("[data-add]")).toBeNull();
    expect(s.libRow("c2")?.querySelector("[data-add]")).not.toBeNull();
  });

  // Why: the add menu's Character must hand back the tour's character
  // when the one just made is in the tour already, not add him twice.
  it("makeForTour hands back the character the tour holds already", async () => {
    const s = setup({ lib: [] });
    const made = s.panel.makeForTour();
    await settled();
    s.library.entries.unshift(record("c9", "Ada"));
    s.t.chars.push({
      id: "k1",
      name: "Ada",
      image: "x",
      frames: "file:poses of c9",
    });
    s.d.maker.close();
    expect((await made)?.id).toBe("k1");
    expect(s.t.tour.declare).not.toHaveBeenCalled();
  });
});

describe("the maker over the editor", () => {
  // Why: the editor stops drawing its 3D view while the maker covers it,
  // so the cut and the save get the machine; a close that did not tell it
  // would leave the view frozen for good.
  it("tells the editor when the maker covers the page and when it no longer does", async () => {
    const s = setup();
    s.d.make.click();
    expect(s.shown).toEqual([true]);
    s.d.makerBack.click();
    await settled();
    expect(s.shown).toEqual([true, false]);
  });

  // Why: the add menu shows its working state from the maker's close
  // until the character is in the tour; called before the close it would
  // cover the maker, called after the add it would show nothing.
  it("makeForTour says when the maker closed, before the character is added", async () => {
    const s = setup();
    const order: string[] = [];
    vi.mocked(s.t.tour.declare).mockImplementationOnce(async (c) => {
      order.push("declare");
      return Promise.resolve({
        kind: "declared",
        character: { id: "t9", name: c.name, image: "i", frames: "f" },
      });
    });
    const made = s.panel.makeForTour({ closed: () => order.push("closed") });
    await settled();
    expect(order).toEqual([]);
    s.library.entries.unshift(record("c2", "Max", "2026-11-10T12:00:00.000Z"));
    s.d.maker.close();
    await made;
    expect(order).toEqual(["closed", "declare"]);
  });

  // Why: a key pressed in the maker reaches the frame's document, not the
  // dialog, so without this Escape would do nothing inside the maker.
  it("Escape inside the maker leaves it like Back to the tour; a key the maker used does not", async () => {
    const s = setup();
    s.d.make.click();
    s.d.makerFrame.dispatchEvent(new Event("load"));
    const inner = s.d.makerFrame.contentDocument;
    expect(inner).not.toBeNull();
    const used = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    used.preventDefault();
    inner?.dispatchEvent(used);
    expect(s.d.maker.open).toBe(true);
    inner?.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(s.d.maker.open).toBe(true);
    inner?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.d.maker.open).toBe(false);
    await settled();
    expect(s.shown).toEqual([true, false]);
  });
});
