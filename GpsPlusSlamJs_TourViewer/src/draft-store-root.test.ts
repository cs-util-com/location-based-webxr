/**
 * Why these tests matter (M6 E2c, the E2c plan review #4): the phone's
 * creator page and the desktop editor open their drafts through this one
 * wrapper. `getDirectory()` can REJECT rather than be absent (a private
 * window, an embedded WebView, an insecure origin), and a draft is a
 * safety net: every way storage is missing must read as "no
 * persistence" (undefined), never as a throw the page did not expect.
 */
import { describe, expect, it } from "vitest";
import { openDraftStore } from "./draft-store-root.js";

describe("openDraftStore", () => {
  it("is undefined without a navigator, without storage, or without the call", async () => {
    expect(await openDraftStore(undefined, "k")).toBeUndefined();
    expect(await openDraftStore({}, "k")).toBeUndefined();
    expect(await openDraftStore({ storage: {} }, "k")).toBeUndefined();
  });

  it("is undefined when the root rejects, or its directory cannot be made", async () => {
    expect(
      await openDraftStore(
        { storage: { getDirectory: () => Promise.reject(new Error("no")) } },
        "k",
      ),
    ).toBeUndefined();
    const refusing = {
      getDirectoryHandle: () => Promise.reject(new Error("quota")),
    } as unknown as FileSystemDirectoryHandle;
    expect(
      await openDraftStore(
        { storage: { getDirectory: () => Promise.resolve(refusing) } },
        "k",
      ),
    ).toBeUndefined();
  });

  it("opens the namespace's directory under drafts/ when the root answers", async () => {
    const asked: string[] = [];
    const directory = {
      getDirectoryHandle: (name: string) => {
        asked.push(name);
        return Promise.resolve(directory);
      },
    } as unknown as FileSystemDirectoryHandle;
    const store = await openDraftStore(
      { storage: { getDirectory: () => Promise.resolve(directory) } },
      "editor:local-file:abc",
    );
    expect(store).toBeDefined();
    expect(asked).toEqual([
      "drafts",
      encodeURIComponent("editor:local-file:abc"),
    ]);
  });
});
