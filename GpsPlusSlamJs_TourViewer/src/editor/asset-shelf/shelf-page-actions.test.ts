import { describe, expect, it, vi } from "vitest";

import { FILE_ADD_FAILED, FILE_NOT_KEPT } from "../add-file-item.js";
import {
  createShelfPageActions,
  NOT_ON_SHELF,
  type ShelfPageDeps,
  type ShelfPageSession,
} from "./shelf-page-actions.js";

/** A page that records what it was asked to show. */
function page(open: ShelfPageSession, over: Partial<ShelfPageDeps> = {}) {
  const said: string[] = [];
  const busy: { text: string; testId: string; removed: boolean }[] = [];
  const undo: string[] = [];
  const deleted: string[] = [];
  const deps: ShelfPageDeps = {
    current: () => open,
    toast: (text) => said.push(text),
    busy: (text, testId) => {
      const entry = { text, testId, removed: false };
      busy.push(entry);
      return {
        remove: () => {
          entry.removed = true;
        },
      };
    },
    pick: () => Promise.resolve(new File(["x"], "new.png")),
    pickMany: () => Promise.resolve([new File(["x"], "a.png")]),
    reveal: () => undefined,
    refresh: () => undefined,
    endUndo: () => undefined,
    offerUndo: (text) => undo.push(text),
    deleted: (_outcome, text) => deleted.push(text),
    nameOf: () => "old.png",
    ...over,
  };
  return { actions: createShelfPageActions(deps), said, busy, undo, deleted };
}

function session(over: Partial<Record<keyof ShelfPageSession, unknown>> = {}) {
  return {
    addFile: () =>
      Promise.resolve({
        kind: "added",
        asset: { id: "a1", kind: "image" },
        backedUp: true,
      }),
    assetOf: () => ({ id: "old", kind: "image" }),
    deleteFileAndUses: () => ({ kind: "deleted" }),
    replaceFile: () =>
      Promise.resolve({ kind: "replaced", items: 2, backedUp: true }),
    revision: () => 1,
    ...over,
  } as unknown as ShelfPageSession;
}

describe("the shelf's add", () => {
  // Why: the async-UI rule - while files are read the page shows it works,
  // and the busy state ends on every outcome.
  it("shows the busy toast while reading and removes it after", async () => {
    const open = session();
    const p = page(open);
    await p.actions.addToShelf(open, [new File(["x"], "a.png")]);
    expect(p.busy).toEqual([
      { text: 'Adding "a.png"...', testId: "shelf-add-busy", removed: true },
    ]);
    expect(p.said).toEqual(["The file is on the shelf."]);
  });

  // Why: an unforeseen error while reading is said per file, never
  // swallowed, and the busy toast still goes.
  it("says a throw per file as FILE_ADD_FAILED and ends the busy state", async () => {
    const open = session({ addFile: () => Promise.reject(new Error("boom")) });
    const p = page(open);
    await p.actions.addToShelf(open, [new File(["x"], "a.png")]);
    expect(p.said).toEqual([`a.png: ${FILE_ADD_FAILED}`]);
    expect(p.busy[0]?.removed).toBe(true);
  });

  // Why: a picker that fails is said rather than leaving the press silent.
  it("says a failing picker", async () => {
    const open = session();
    const p = page(open, { pickMany: () => Promise.reject(new Error("no")) });
    await p.actions.addFiles(open);
    expect(p.said).toEqual([FILE_ADD_FAILED]);
    expect(p.busy).toEqual([]);
  });

  // Why: a file the draft could not keep must be said, or a reload loses it.
  it("says a file the browser could not keep", async () => {
    const open = session({
      addFile: () =>
        Promise.resolve({
          kind: "added",
          asset: { id: "a1", kind: "image" },
          backedUp: false,
        }),
    });
    const p = page(open);
    await p.actions.addToShelf(open, [new File(["x"], "a.png")]);
    expect(p.said).toEqual(["The file is on the shelf.", FILE_NOT_KEPT]);
  });
});

describe("the shelf's Replace everywhere", () => {
  // Why: the read is async I/O; the busy toast shows it and goes after.
  it("shows the busy toast and offers the Undo with the count", async () => {
    const open = session();
    const p = page(open);
    await p.actions.replaceEverywhere(open, "old");
    expect(p.busy).toEqual([
      {
        text: 'Reading "new.png"...',
        testId: "replace-everywhere-busy",
        removed: true,
      },
    ]);
    expect(p.undo).toEqual(['"new.png" is used in 2 places now.']);
  });

  // Why: a throw while reading is said and nothing is offered for Undo.
  it("says a failed read as FILE_ADD_FAILED and ends the busy state", async () => {
    const open = session({
      replaceFile: () => Promise.reject(new Error("boom")),
    });
    const p = page(open);
    await p.actions.replaceEverywhere(open, "old");
    expect(p.said).toEqual([FILE_ADD_FAILED]);
    expect(p.busy[0]?.removed).toBe(true);
    expect(p.undo).toEqual([]);
  });

  // Why: the session's refusal reaches the user in its own words.
  it("says a refusal", async () => {
    const open = session({
      replaceFile: () => Promise.resolve({ kind: "refused", reason: "No." }),
    });
    const p = page(open);
    await p.actions.replaceEverywhere(open, "old");
    expect(p.said).toEqual(["No."]);
    expect(p.undo).toEqual([]);
  });

  // Why: a failing picker is said; nothing is read.
  it("says a failing picker", async () => {
    const open = session();
    const p = page(open, { pick: () => Promise.reject(new Error("no")) });
    await p.actions.replaceEverywhere(open, "old");
    expect(p.said).toEqual([FILE_ADD_FAILED]);
    expect(p.busy).toEqual([]);
  });

  // Why: a file gone from the shelf is said before any picker opens.
  it("says a file no longer on the shelf", async () => {
    const pick = vi.fn();
    const open = session({ assetOf: () => undefined });
    const p = page(open, { pick });
    await p.actions.replaceEverywhere(open, "old");
    expect(p.said).toEqual([NOT_ON_SHELF]);
    expect(pick).not.toHaveBeenCalled();
  });
});

describe("the shelf's delete of a file in use", () => {
  // Why: a delete that made no step (nothing used the file after all) must
  // not offer an Undo that would take back an older change.
  it("says a delete that made no step without an Undo", () => {
    const open = session({ revision: () => 7 });
    const p = page(open);
    p.actions.deleteInUse(open, "old");
    expect(p.said).toEqual(["Deleted old.png."]);
    expect(p.deleted).toEqual([]);
  });

  // Why: a delete that made a step goes through the page's Undo path.
  it("says a delete that made a step through the Undo path", () => {
    let revision = 1;
    const open = session({
      revision: () => revision,
      deleteFileAndUses: () => {
        revision = 2;
        return { kind: "deleted" };
      },
    });
    const p = page(open);
    p.actions.deleteInUse(open, "old");
    expect(p.deleted).toEqual(["Deleted old.png."]);
    expect(p.said).toEqual([]);
  });
});
