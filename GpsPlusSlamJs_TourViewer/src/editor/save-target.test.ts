/**
 * Why these tests matter: saving IN PLACE writes over the creator's only
 * copy of the tour (M6 E2b-1). The page must ask for write permission on
 * the open's own gesture (E2b plan review #8), must never overwrite a file
 * something else changed meanwhile (#4) - and must not refuse a file a sync
 * client only touched - and must say a moved or deleted file apart from a
 * changed one. One tab per file is a lock that lets go again (#6).
 */
import { describe, expect, it } from "vitest";
import {
  adoptsSavedFile,
  createSaveTarget,
  holdEditorDraftLock,
  holdEditorLock,
  pickSaveFile,
  pickTourFile,
  releaseUnusedPick,
  saveFinePrint,
  InPlaceRefusal,
  type PickerWindow,
  type SavePickerWindow,
  type WritableFileHandle,
  isSameFile,
} from "./save-target.js";

/** A file on a fake disk: its bytes and modified time, and the calls. */
function fakeHandle(initial: string, name = "tour.zip") {
  const state = {
    bytes: initial,
    modified: 1000,
    gone: false,
    failWrite: false,
    /** The read right after a write still sees the old bytes (with the
     *  new time): a lagging read of what was just written. */
    lagging: false,
    staleNext: null as string | null,
    calls: [] as string[],
    permission: "granted" as PermissionState | "throws",
  };
  const handle: WritableFileHandle = {
    kind: "file",
    name,
    getFile: () => {
      state.calls.push("getFile");
      if (state.gone) {
        return Promise.reject(new DOMException("gone", "NotFoundError"));
      }
      const bytes = state.staleNext ?? state.bytes;
      state.staleNext = null;
      return Promise.resolve(
        new File([bytes], name, { lastModified: state.modified }),
      );
    },
    createWritable: () => {
      state.calls.push("createWritable");
      let pending = "";
      return Promise.resolve({
        write: async (data: unknown) => {
          if (state.failWrite) throw new Error("the disk is full");
          pending += await (data as Blob).text();
        },
        close: () => {
          if (state.lagging) state.staleNext = state.bytes;
          state.bytes = pending;
          state.modified += 1;
          return Promise.resolve();
        },
        abort: () => Promise.resolve(),
      } as unknown as FileSystemWritableFileStream);
    },
    requestPermission: () => {
      state.calls.push("requestPermission");
      return state.permission === "throws"
        ? Promise.reject(new Error("no"))
        : Promise.resolve(state.permission);
    },
  } as unknown as WritableFileHandle;
  return { handle, state };
}

describe("pickTourFile", () => {
  it("is unavailable without the picker, so the page uses its file input", async () => {
    expect(await pickTourFile({})).toEqual({ kind: "unavailable" });
  });

  it("treats a dismissed picker as a cancel, never an error", async () => {
    const outcome = await pickTourFile({
      showOpenFilePicker: () =>
        Promise.reject(new DOMException("dismissed", "AbortError")),
    });
    expect(outcome).toEqual({ kind: "cancelled" });
  });

  // Why (E2b-1 review #5): a second click while the picker is open is
  // refused with NotAllowedError; read as "no picker", it opened the file
  // input as well - a second dialog.
  it("treats a refused second picker as a cancel; only a blocked picker is unavailable", async () => {
    const refuse = (name: string) => ({
      showOpenFilePicker: () => Promise.reject(new DOMException("no", name)),
    });
    expect(await pickTourFile(refuse("NotAllowedError"))).toEqual({
      kind: "cancelled",
    });
    expect(await pickTourFile(refuse("SecurityError"))).toEqual({
      kind: "unavailable",
    });
    expect(
      await pickTourFile({
        showOpenFilePicker: () => Promise.reject(new TypeError("no")),
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("asks for write permission before it reads the file (review #8)", async () => {
    const { handle, state } = fakeHandle("zip bytes");
    const outcome = await pickTourFile({
      showOpenFilePicker: () => Promise.resolve([handle]),
    });
    expect(state.calls.slice(0, 2)).toEqual(["requestPermission", "getFile"]);
    expect(outcome).toMatchObject({ kind: "picked", writable: true });
    if (outcome.kind !== "picked") return;
    expect(await outcome.file.text()).toBe("zip bytes");
  });

  // Why (PR #614 review): the file can go between the pick and its read
  // (moved, deleted, an unmounted volume); that is said, not thrown.
  it("says a picked file that can no longer be read, instead of throwing", async () => {
    const { handle, state } = fakeHandle("zip bytes");
    state.gone = true;
    const outcome = await pickTourFile({
      showOpenFilePicker: () => Promise.resolve([handle]),
    });
    expect(outcome).toMatchObject({ kind: "unreadable" });
  });

  it("opens a file it may not write, to be saved as a download", async () => {
    for (const permission of ["denied", "prompt", "throws"] as const) {
      const { handle, state } = fakeHandle("zip bytes");
      state.permission = permission;
      const outcome = await pickTourFile({
        showOpenFilePicker: () => Promise.resolve([handle]),
      });
      expect(outcome).toMatchObject({ kind: "picked", writable: false });
    }
  });
});

describe("createSaveTarget", () => {
  it("writes the file in place and checks against what it wrote", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    expect(await target.check()).toBe("same");
    await target.write(new Blob(["version two"]));
    expect(state.bytes).toBe("version two");
    // Its own write is not "changed by something else".
    expect(await target.check()).toBe("same");
  });

  it("refuses to write over a file something else changed (review #4)", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.bytes = "another program";
    state.modified += 5;
    expect(await target.check()).toBe("changed");
    await expect(target.write(new Blob(["mine"]))).rejects.toMatchObject({
      kind: "changed",
    });
    expect(state.bytes).toBe("another program");
  });

  it("does not refuse a file a sync client only touched: same size, same end", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.modified += 60_000;
    expect(await target.check()).toBe("same");
    // The same size with other bytes at the end is a change.
    state.bytes = "version ONE";
    state.modified += 1;
    expect(await target.check()).toBe("changed");
  });

  it("says a moved, renamed or deleted file apart from a changed one", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.gone = true;
    expect(await target.check()).toBe("gone");
    const err = await target.write(new Blob(["mine"])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InPlaceRefusal);
    expect((err as InPlaceRefusal).kind).toBe("gone");
  });

  // Why (E2b-1 review #2): the rebuild stores entries uncompressed, so a
  // deflated tour grows; written over the original past the open cap, it
  // would leave a file no page can open again.
  it("refuses to write a tour larger than a tour may be, and writes nothing", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile(), {
      maxBytes: 20,
    });
    await expect(
      target.write(new Blob(["far more than twenty bytes"])),
    ).rejects.toMatchObject({ kind: "too-large" });
    expect(state.bytes).toBe("version one");
    await target.write(new Blob(["fits"]));
    expect(state.bytes).toBe("fits");
  });

  it("takes the written size from the bytes it wrote, as the tail, so a lagging read back is no change", async () => {
    // Why: the baseline after a write read the size (and time) back from
    // the file but the tail from the bytes written. A read back that still
    // saw the old size left a baseline that described no file, and the
    // next save was refused as "changed" though nothing else wrote it.
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.lagging = true;
    await target.write(new Blob(["version two, longer"]));
    expect(await target.check()).toBe("same");
  });

  it("keeps its baseline when a write fails, so the next check is honest", async () => {
    const { handle, state } = fakeHandle("version one");
    const target = await createSaveTarget(handle, await handle.getFile());
    state.failWrite = true;
    await expect(target.write(new Blob(["version two"]))).rejects.toThrow(
      /disk is full/,
    );
    expect(state.bytes).toBe("version one");
    expect(await target.check()).toBe("same");
  });
});

/**
 * Why (the M4b fix re-review #1): the walk's save dialog can be pointed at
 * the opened tour file itself. The walk's zip then lands over the tour,
 * the tour's own write is refused as "changed", and the tour's content
 * exists nowhere. The page asks the target first, before anything is
 * written; where the browser cannot tell, the same name counts as the same
 * file - refusing a move costs a retry, writing over the tour costs it.
 */
describe("SaveTarget.isSame", () => {
  function withSameEntry(
    handle: WritableFileHandle,
    same: (other: FileSystemHandle) => Promise<boolean>,
  ): WritableFileHandle {
    return Object.assign(handle, { isSameEntry: same });
  }

  it("is the browser's answer where it has one", async () => {
    const { handle } = fakeHandle("version one", "castle.zip");
    const other = { kind: "file", name: "castle.zip" } as FileSystemHandle;
    const seen: FileSystemHandle[] = [];
    const target = await createSaveTarget(
      withSameEntry(handle, (h) => {
        seen.push(h);
        return Promise.resolve(false);
      }),
      await handle.getFile(),
    );
    // Same name, another folder: not the tour.
    expect(await target.isSame(other)).toBe(false);
    expect(seen).toEqual([other]);
    const same = await createSaveTarget(
      withSameEntry(fakeHandle("v", "castle.zip").handle, () =>
        Promise.resolve(true),
      ),
      new File(["v"], "castle.zip"),
    );
    expect(await same.isSame(other)).toBe(true);
  });

  it("counts the same name as the same file where the browser cannot tell", async () => {
    const { handle } = fakeHandle("version one", "castle.zip");
    const target = await createSaveTarget(handle, await handle.getFile());
    const named = (name: string) =>
      ({ kind: "file", name }) as FileSystemHandle;
    expect(await target.isSame(named("castle.zip"))).toBe(true);
    expect(await target.isSame(named("castle-walk.zip"))).toBe(false);
    const throwing = await createSaveTarget(
      withSameEntry(fakeHandle("v", "castle.zip").handle, () =>
        Promise.reject(new DOMException("no", "SecurityError")),
      ),
      new File(["v"], "castle.zip"),
    );
    expect(await throwing.isSame(named("castle.zip"))).toBe(true);
    expect(await throwing.isSame(named("castle-walk.zip"))).toBe(false);
  });
});

describe("isSameFile", () => {
  // Why (r901 review #5): "Save the debug data" reads the opened file, so
  // a bundle written over it loses the walk from both. A file opened
  // without a handle (the file input, a drop) can only be told by its
  // name - which then decides, as for the move's target.
  const named = (name: string) => ({ kind: "file", name }) as FileSystemHandle;

  it("is the browser's answer where the opened file has a handle that gives one", async () => {
    const handle = Object.assign(named("castle.zip"), {
      isSameEntry: (other: FileSystemHandle) =>
        Promise.resolve(other.name === "elsewhere.zip"),
    });
    const opened = { name: "castle.zip", handle };
    expect(await isSameFile(opened, named("castle.zip"))).toBe(false);
    expect(await isSameFile(opened, named("elsewhere.zip"))).toBe(true);
  });

  it("counts the same name as the same file without a handle, or with one that cannot tell", async () => {
    const cannotTell = Object.assign(named("castle.zip"), {
      isSameEntry: () =>
        Promise.reject(new DOMException("no", "SecurityError")),
    }) as FileSystemHandle;
    for (const handle of [null, named("castle.zip"), cannotTell]) {
      const opened = { name: "castle.zip", handle };
      expect(await isSameFile(opened, named("castle.zip"))).toBe(true);
      expect(await isSameFile(opened, named("castle-debug.zip"))).toBe(false);
    }
  });
});

describe("holdEditorLock", () => {
  /** A Web Locks stand-in: exclusive, `ifAvailable`, released on demand. */
  function fakeLocks() {
    const held = new Set<string>();
    return {
      held,
      locks: {
        request: (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown,
        ) => {
          if (held.has(name)) return Promise.resolve(callback(null));
          held.add(name);
          return Promise.resolve(callback({ name, mode: "exclusive" })).finally(
            () => held.delete(name),
          );
        },
      } as unknown as LockManager,
    };
  }

  it("grants one tab a file's name, refuses a second, and lets go on release", async () => {
    const { locks, held } = fakeLocks();
    const first = await holdEditorLock(locks, "tour.zip");
    expect(first.granted).toBe(true);
    expect((await holdEditorLock(locks, "tour.zip")).granted).toBe(false);
    expect((await holdEditorLock(locks, "other.zip")).granted).toBe(true);
    first.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(held.has("gps-plus-slam/tour-viewer-editor/tour.zip")).toBe(false);
    expect((await holdEditorLock(locks, "tour.zip")).granted).toBe(true);
  });

  // Why (E2b-1 review #3): the same file opened again in the same tab
  // asked for its lock before the old hold had let go, and was told
  // another tab was editing it. `released` settles once it has.
  it("grants the name again once a released hold has let go", async () => {
    const { locks } = fakeLocks();
    const first = await holdEditorLock(locks, "tour.zip");
    first.release();
    await first.released;
    expect((await holdEditorLock(locks, "tour.zip")).granted).toBe(true);
  });

  // Why (E2c plan review #6): the draft is keyed by the tour's CONTENT,
  // the in-place save's lock by the file's NAME; each has its own lock,
  // in the editor's family (the recordings' housekeeping never lists it).
  it("holds a draft key apart from a file name, in the editor's family", async () => {
    const { locks, held } = fakeLocks();
    const file = await holdEditorLock(locks, "tour.zip");
    const draft = await holdEditorDraftLock(locks, "editor:local-file:abc");
    expect(file.granted && draft.granted).toBe(true);
    expect(held).toEqual(
      new Set([
        "gps-plus-slam/tour-viewer-editor/tour.zip",
        "gps-plus-slam/tour-viewer-editor/draft/editor:local-file:abc",
      ]),
    );
    expect(
      (await holdEditorDraftLock(locks, "editor:local-file:abc")).granted,
    ).toBe(false);
  });

  it("grants without Web Locks, or when the request fails: nothing to coordinate", async () => {
    expect((await holdEditorLock(undefined, "tour.zip")).granted).toBe(true);
    const failing = {
      request: () => Promise.reject(new Error("no locks here")),
    } as unknown as LockManager;
    expect((await holdEditorLock(failing, "tour.zip")).granted).toBe(true);
  });
});

/**
 * Why (tour editor plan 2026-10-17-1816, W2): the open dialog's fine print
 * said "Save gives you a new copy" in every browser, which is wrong where
 * the file picker lets Save write the chosen file itself (and autosave
 * does). The words follow what this browser can do. And (W6): it said
 * "nothing is uploaded" while the map's tiles come from OpenStreetMap -
 * it now says what does leave the computer.
 */
describe("saveFinePrint", () => {
  it("says Save writes the chosen file where the picker exists", () => {
    const text = saveFinePrint({
      showOpenFilePicker: () => Promise.resolve([]),
    });
    expect(text).toContain("The map comes from OpenStreetMap.");
    expect(text).not.toContain("nothing is uploaded");
    expect(text).toContain("saved into that file");
    expect(text).toContain("from a link");
    expect(text).not.toContain("Save gives you a new copy");
  });

  it("says Save gives a new copy where it does not", () => {
    const text = saveFinePrint({});
    expect(text).toContain("The map comes from OpenStreetMap.");
    expect(text).not.toContain("nothing is uploaded");
    expect(text).toContain("Save gives you a new copy");
    expect(text).not.toContain("saved into that file");
  });
});

/**
 * Why (the M4b milestone review #2): the walk's file was asked for with
 * the framework's download, after the move's build - by then Chromium's
 * click window had passed, the save dialog was refused, and the download
 * it fell back to counted as saved before the tour was rewritten without
 * the walk. The dialog must be opened IN the click, and only a dismissal
 * means "nothing to write"; anything else lets the page download instead.
 */
describe("pickSaveFile", () => {
  const handle = { kind: "file", name: "castle-walk.zip" };

  it("opens the save dialog before it returns, with the suggested name", async () => {
    const calls: string[] = [];
    const picked = pickSaveFile(
      {
        showSaveFilePicker: (options) => {
          calls.push(options.suggestedName);
          return Promise.resolve(handle as unknown as FileSystemFileHandle);
        },
      },
      "castle-walk.zip",
    );
    // Called synchronously: no await came between the click and the dialog.
    expect(calls).toEqual(["castle-walk.zip"]);
    await expect(picked).resolves.toEqual({ kind: "picked", handle });
  });

  it("is cancelled only when the creator dismissed the dialog", async () => {
    await expect(
      pickSaveFile(
        {
          showSaveFilePicker: () =>
            Promise.reject(new DOMException("dismissed", "AbortError")),
        },
        "w.zip",
      ),
    ).resolves.toEqual({ kind: "cancelled" });
  });

  it("is unavailable without a dialog, or when the browser refuses one", async () => {
    await expect(pickSaveFile({}, "w.zip")).resolves.toEqual({
      kind: "unavailable",
    });
    for (const refusal of [
      new DOMException("no click", "SecurityError"),
      new DOMException("busy", "NotAllowedError"),
      new TypeError("not here"),
    ]) {
      await expect(
        pickSaveFile(
          { showSaveFilePicker: () => Promise.reject(refusal) },
          "w.zip",
        ),
      ).resolves.toEqual({ kind: "unavailable" });
    }
    await expect(
      pickSaveFile(
        {
          showSaveFilePicker: () => {
            throw new TypeError("thrown, not rejected");
          },
        },
        "w.zip",
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});

/**
 * Why: a tour opened from a link or the sample used to be saved as a new
 * copy at every Save, which the creator then had to put in place by hand
 * - and nothing saved by itself. Where the browser has both file dialogs,
 * it asks for a file (as it opens, or at its first Save) and keeps saving
 * into it. Android was held back until a check on a phone (Chrome 155,
 * Android 10, the file-access check page) showed its picked files behave
 * as a desktop's: saved under a new name, kept across a reload with one tap
 * to grant the permission again, and a rewrite cut short by closing the tab
 * leaves the old file whole (the new bytes are swapped in only when the
 * write closes). So the platform decides nothing any more; these tests pin
 * that, and that the fine print says what each browser does.
 */
describe("adoptsSavedFile", () => {
  // Never called: the check reads only whether the dialogs exist.
  const pickers: PickerWindow & SavePickerWindow = {
    showOpenFilePicker: () => Promise.resolve([]),
    showSaveFilePicker: () => Promise.reject(new Error("not opened")),
  };

  it("adopts wherever the browser has both file dialogs, Android included", () => {
    expect(adoptsSavedFile(pickers)).toBe(true);
  });

  it("does not adopt without either file dialog", () => {
    expect(
      adoptsSavedFile({ showOpenFilePicker: () => Promise.resolve([]) }),
    ).toBe(false);
    expect(
      adoptsSavedFile({
        showSaveFilePicker: () => Promise.reject(new Error("not opened")),
      }),
    ).toBe(false);
    expect(adoptsSavedFile({})).toBe(false);
  });

  // Why: a tour from a link or the sample asks where to save it as it
  // opens (and a dismissed dialog leaves the first Save to ask), so the
  // fine print says so where the browser adopts the file, and nowhere else.
  it("the fine print says a link's tour asks for its file as it opens, only where it is", () => {
    const adopting = saveFinePrint(pickers);
    expect(adopting).toContain(
      "asks where to save it as it opens (or at its first Save)",
    );
    expect(adopting).not.toContain("new copy");
    const openOnly = saveFinePrint({
      showOpenFilePicker: () => Promise.resolve([]),
    });
    expect(openOnly).toContain("saved as a new copy");
    expect(openOnly).not.toContain("asks where to save it");
  });
});

// Why: the open from a link or the sample asks for its file IN the click,
// before the fetch (the dialog needs the click), so a fetch or an open
// can fail after the creator picked a file. The browser has made that file
// by then, empty. It must never stay behind unexplained (PR bot finding
// 11, r955 review #1): an empty one is removed where the browser can, a
// file that holds something is left as it was, and each case is said.
describe("releaseUnusedPick", () => {
  function picked(size: number, remove?: () => Promise<void>) {
    const calls: string[] = [];
    const handle = {
      kind: "file",
      name: "linked.zip",
      getFile: () =>
        Promise.resolve(new File([new Uint8Array(size)], "linked.zip")),
      ...(remove === undefined
        ? {}
        : {
            remove: () => {
              calls.push("remove");
              return remove();
            },
          }),
    } as unknown as FileSystemFileHandle;
    return {
      pick: Promise.resolve({ kind: "picked", handle } as const),
      calls,
    };
  }

  it("removes an empty picked file and says so", async () => {
    const { pick, calls } = picked(0, () => Promise.resolve());
    expect(await releaseUnusedPick(pick)).toBe(
      "Nothing was written into linked.zip, and the empty file was removed.",
    );
    expect(calls).toEqual(["remove"]);
  });

  it("leaves a file that holds something as it was", async () => {
    const { pick, calls } = picked(5, () => Promise.resolve());
    expect(await releaseUnusedPick(pick)).toBe(
      "Nothing was written into linked.zip; it is as it was.",
    );
    expect(calls).toEqual([]);
  });

  it("names an empty file it cannot remove, so the creator can", async () => {
    for (const remove of [undefined, () => Promise.reject(new Error("no"))]) {
      const { pick } = picked(0, remove);
      expect(await releaseUnusedPick(pick)).toBe(
        "Nothing was written into linked.zip: it is empty and can be deleted.",
      );
    }
  });

  it("says nothing for a dismissed or unavailable dialog, or none at all", async () => {
    expect(await releaseUnusedPick(null)).toBeNull();
    for (const kind of ["cancelled", "unavailable"] as const) {
      expect(await releaseUnusedPick(Promise.resolve({ kind }))).toBeNull();
    }
  });

  it("says only that nothing was written into a picked file it cannot read", async () => {
    const handle = {
      kind: "file",
      name: "linked.zip",
      getFile: () => Promise.reject(new Error("gone")),
      remove: () => Promise.resolve(),
    } as unknown as FileSystemFileHandle;
    expect(
      await releaseUnusedPick(Promise.resolve({ kind: "picked", handle })),
    ).toBe("Nothing was written into linked.zip.");
  });
});
