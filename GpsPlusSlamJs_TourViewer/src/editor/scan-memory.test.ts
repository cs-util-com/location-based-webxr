/**
 * Why these tests matter: a scan shown beside a tour is a large file the
 * creator picked once; this browser remembers WHERE it is (a file handle
 * keyed by the tour's id), never its bytes, so reopening the tour can
 * offer "Show the scan again". That memory is a convenience: a store that
 * fails (a private window, blocked storage), a file moved away since, or a
 * permission the creator refuses must each end in words and never in a
 * broken page. The button follows the async-UI rule: busy while it runs,
 * back to its words on every end, the failure said.
 */
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import {
  SHOW_SCAN_AGAIN_LABELS,
  createScanMemory,
  indexedDbHandleStore,
  reopenScan,
  runShowScanAgain,
  type HandleStore,
  type ScanHandle,
} from "./scan-memory.js";

/** A Map-backed store that records what it was given. */
function mapStore(): HandleStore & { readonly map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: (key) => Promise.resolve(map.get(key)),
    put: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

/** A store whose every call fails, as a blocked IndexedDB does. */
const brokenStore: HandleStore = {
  get: () => Promise.reject(new Error("blocked")),
  put: () => Promise.reject(new Error("blocked")),
  delete: () => Promise.reject(new Error("blocked")),
};

/** A picked file's handle: its permission answer and its file. */
function fakeHandle(
  options: {
    readonly permission?: PermissionState | "throws" | "none";
    readonly read?: "ok" | "NotFoundError" | "NotAllowedError" | "odd";
    readonly name?: string;
  } = {},
) {
  const calls: string[] = [];
  const name = options.name ?? "walk-scan.zip";
  const permission = options.permission ?? "granted";
  const handle = {
    kind: "file",
    name,
    getFile: () => {
      calls.push("getFile");
      const read = options.read ?? "ok";
      if (read === "ok") return Promise.resolve(new File(["zip"], name));
      if (read === "odd") return Promise.reject(new Error("disk asleep"));
      return Promise.reject(new DOMException("no", read));
    },
    ...(permission === "none"
      ? {}
      : {
          requestPermission: (descriptor: { mode: string }) => {
            calls.push(`requestPermission:${descriptor.mode}`);
            return permission === "throws"
              ? Promise.reject(new DOMException("no", "SecurityError"))
              : Promise.resolve(permission);
          },
        }),
  } as unknown as ScanHandle;
  return { handle, calls };
}

describe("createScanMemory", () => {
  it("keeps the handle itself by tour id, never the file's bytes", async () => {
    const store = mapStore();
    const memory = createScanMemory(store);
    const { handle, calls } = fakeHandle();
    await memory.remember("tour-1", handle);
    expect(store.map.get("tour-1")).toBe(handle);
    // Remembering reads nothing: no bytes are copied into the browser.
    expect(calls).toEqual([]);
    expect(await memory.recall("tour-1")).toBe(handle);
    expect(await memory.recall("tour-2")).toBeNull();
    await memory.forget("tour-1");
    expect(await memory.recall("tour-1")).toBeNull();
  });

  it("remembers nothing for a tour without an id", async () => {
    // An unlisted tour without an id has no key that is its own: a scan
    // remembered under "" would be offered to every such tour.
    const store = mapStore();
    const memory = createScanMemory(store);
    for (const id of [null, undefined, ""]) {
      await memory.remember(id, fakeHandle().handle);
      expect(await memory.recall(id)).toBeNull();
      await memory.forget(id);
    }
    expect(store.map.size).toBe(0);
  });

  it("recalls only what is a file handle", async () => {
    // Whatever another version of the page left under the key is not
    // trusted to be a handle.
    const store = mapStore();
    const memory = createScanMemory(store);
    for (const value of [
      "walk-scan.zip",
      { kind: "directory", name: "x", getFile: () => undefined },
      { kind: "file", name: 3, getFile: () => undefined },
      { kind: "file", name: "x" },
      null,
    ]) {
      store.map.set("tour-1", value);
      expect(await memory.recall("tour-1")).toBeNull();
    }
  });

  it("never throws where the browser keeps no store, or a broken one", async () => {
    for (const memory of [
      createScanMemory(null),
      createScanMemory(brokenStore),
    ]) {
      await expect(
        memory.remember("tour-1", fakeHandle().handle),
      ).resolves.toBeUndefined();
      await expect(memory.recall("tour-1")).resolves.toBeNull();
      await expect(memory.forget("tour-1")).resolves.toBeUndefined();
    }
  });

  it("recalls the last handle remembered for each tour (property)", async () => {
    // Why: whatever order remembers and forgets come in, a recall gives
    // the newest handle of THAT tour, never another tour's.
    const op = fc.record({
      tour: fc.constantFrom("a", "b", "c"),
      forget: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 20 }), async (ops) => {
        const memory = createScanMemory(mapStore());
        const expected = new Map<string, ScanHandle>();
        for (const { tour, forget } of ops) {
          if (forget) {
            await memory.forget(tour);
            expected.delete(tour);
          } else {
            const { handle } = fakeHandle();
            await memory.remember(tour, handle);
            expected.set(tour, handle);
          }
        }
        for (const tour of ["a", "b", "c"]) {
          expect(await memory.recall(tour)).toBe(expected.get(tour) ?? null);
        }
      }),
    );
  });
});

describe("reopenScan", () => {
  it("asks to read again before it reads", async () => {
    const { handle, calls } = fakeHandle();
    const outcome = await reopenScan(handle);
    expect(calls).toEqual(["requestPermission:read", "getFile"]);
    expect(outcome.kind).toBe("file");
  });

  it("reads a handle without the permission call as it is", async () => {
    const { handle, calls } = fakeHandle({ permission: "none" });
    expect((await reopenScan(handle)).kind).toBe("file");
    expect(calls).toEqual(["getFile"]);
  });

  it("is denied when the creator refuses, and reads nothing then", async () => {
    for (const permission of ["denied", "prompt", "throws"] as const) {
      const { handle, calls } = fakeHandle({ permission });
      expect(await reopenScan(handle)).toEqual({ kind: "denied" });
      expect(calls).not.toContain("getFile");
    }
    expect(
      await reopenScan(fakeHandle({ read: "NotAllowedError" }).handle),
    ).toEqual({ kind: "denied" });
  });

  it("says a file moved or deleted since apart from another failure", async () => {
    expect(
      await reopenScan(fakeHandle({ read: "NotFoundError" }).handle),
    ).toEqual({ kind: "gone" });
    expect(await reopenScan(fakeHandle({ read: "odd" }).handle)).toEqual({
      kind: "failed",
      reason: "disk asleep",
    });
  });
});

describe("runShowScanAgain", () => {
  /** The button's words and state at each call of the deps. */
  function button() {
    return { disabled: false, textContent: SHOW_SCAN_AGAIN_LABELS.idle };
  }

  it("is busy while it runs, adds the file, and ends back in its words", async () => {
    const b = button();
    const seen: unknown[] = [];
    const add = vi.fn((file: File) => {
      seen.push([b.disabled, b.textContent, file.name]);
      return Promise.resolve({ kind: "added" as const });
    });
    const forget = vi.fn();
    const result = await runShowScanAgain(b, "walk-scan.zip", {
      reopen: () => {
        seen.push([b.disabled, b.textContent]);
        return reopenScan(fakeHandle().handle);
      },
      add,
      forget,
    });
    expect(seen).toEqual([
      [true, SHOW_SCAN_AGAIN_LABELS.busy],
      [true, SHOW_SCAN_AGAIN_LABELS.busy, "walk-scan.zip"],
    ]);
    expect(result).toEqual({ kind: "done" });
    expect(b).toEqual({
      disabled: false,
      textContent: SHOW_SCAN_AGAIN_LABELS.idle,
    });
    expect(forget).not.toHaveBeenCalled();
  });

  it("forgets a scan that is gone, says so and withdraws the offer", async () => {
    const b = button();
    const forget = vi.fn();
    const add = vi.fn();
    const result = await runShowScanAgain(b, "walk-scan.zip", {
      reopen: () => Promise.resolve({ kind: "gone" }),
      add,
      forget,
    });
    expect(result).toEqual({
      kind: "failed",
      line: `The scan walk-scan.zip is no longer where it was (moved, renamed or deleted), so it was not shown again. Add it again with "Add debug data…".`,
      keepOffer: false,
    });
    expect(forget).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
    expect(b).toEqual({
      disabled: false,
      textContent: SHOW_SCAN_AGAIN_LABELS.idle,
    });
  });

  it("keeps the offer after a refusal, a failed read or a refused add, and says why", async () => {
    const cases = [
      {
        reopen: { kind: "denied" } as const,
        added: null,
        line: `The browser did not allow reading walk-scan.zip again, so it was not shown. Choose "Show the scan again" to be asked once more.`,
      },
      {
        reopen: { kind: "failed", reason: "disk asleep" } as const,
        added: null,
        line: "The scan walk-scan.zip could not be read again: disk asleep",
      },
      {
        reopen: null,
        added: { kind: "refused", reason: "it is no scan." } as const,
        line: "Not added: it is no scan.",
      },
    ];
    for (const c of cases) {
      const b = button();
      const forget = vi.fn();
      const result = await runShowScanAgain(b, "walk-scan.zip", {
        reopen: () =>
          c.reopen === null
            ? reopenScan(fakeHandle().handle)
            : Promise.resolve(c.reopen),
        add: () => Promise.resolve(c.added),
        forget,
      });
      expect(result).toEqual({ kind: "failed", line: c.line, keepOffer: true });
      expect(forget).not.toHaveBeenCalled();
      expect(b).toEqual({
        disabled: false,
        textContent: SHOW_SCAN_AGAIN_LABELS.idle,
      });
    }
  });

  it("says a throw in words and still ends back in its words", async () => {
    const b = button();
    const result = await runShowScanAgain(b, "walk-scan.zip", {
      reopen: () => Promise.reject(new Error("broken")),
      add: () => Promise.resolve(null),
      forget: () => undefined,
    });
    expect(result).toEqual({
      kind: "failed",
      line: "The scan walk-scan.zip could not be read again: broken",
      keepOffer: true,
    });
    expect(b.disabled).toBe(false);
    expect(b.textContent).toBe(SHOW_SCAN_AGAIN_LABELS.idle);
  });

  it("is done, saying nothing, when the tour changed meanwhile", async () => {
    // The add's null: another tour opened; the offer went with the old one.
    const result = await runShowScanAgain(button(), "walk-scan.zip", {
      reopen: () => reopenScan(fakeHandle().handle),
      add: () => Promise.resolve(null),
      forget: () => undefined,
    });
    expect(result).toEqual({ kind: "done" });
  });
});

/** What the fake IndexedDB was asked to do. */
interface FakeIdbLog {
  opens: { name: string; version: number }[];
  created: string[];
  modes: string[];
}

/**
 * A small IndexedDB stand-in with the surface the adapter uses: `open`
 * with an upgrade on first open, one object store, `get`/`put`/`delete`
 * requests whose results are read at the transaction's `complete`.
 * `failOpens` opens fail first; `blocked` makes every open blocked;
 * `failTx` makes every transaction fail.
 */
function fakeIdb(
  options: { failOpens?: number; blocked?: boolean; failTx?: boolean } = {},
): { factory: IDBFactory; log: FakeIdbLog; data: Map<string, unknown> } {
  const log: FakeIdbLog = { opens: [], created: [], modes: [] };
  const data = new Map<string, unknown>();
  let failOpens = options.failOpens ?? 0;
  let version = 0;
  const later = (fn: () => void) => setTimeout(fn, 0);
  const db = {
    createObjectStore(name: string) {
      log.created.push(name);
    },
    transaction(_name: string, mode: string) {
      log.modes.push(mode);
      const tx: Record<string, unknown> = {};
      const request = (result: unknown) => ({ result });
      tx.objectStore = () => ({
        get: (key: string) => request(data.get(key)),
        put: (value: unknown, key: string) => {
          data.set(key, value);
          return request(key);
        },
        delete: (key: string) => {
          data.delete(key);
          return request(undefined);
        },
      });
      later(() => {
        if (options.failTx === true) {
          tx.error = new DOMException("quota", "QuotaExceededError");
          (tx.onerror as () => void)();
        } else (tx.oncomplete as () => void)();
      });
      return tx;
    },
  };
  const factory = {
    open(name: string, v: number) {
      log.opens.push({ name, version: v });
      const request: Record<string, unknown> = {};
      later(() => {
        if (options.blocked === true)
          return (request.onblocked as () => void)();
        if (failOpens > 0) {
          failOpens -= 1;
          request.error = new DOMException("denied", "UnknownError");
          return (request.onerror as () => void)();
        }
        request.result = db;
        if (version < v) {
          version = v;
          (request.onupgradeneeded as () => void)();
        }
        (request.onsuccess as () => void)();
      });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, log, data };
}

describe("indexedDbHandleStore", () => {
  // Why: this adapter is where the handle actually persists between visits.
  // A real handle read back from IndexedDB crashes the headless test
  // browsers, so the e2e runs on a stand-in store and these tests are the
  // adapter's only check: its database, its one-time upgrade, one open for
  // many calls, a failed open tried again, and failures that reject (the
  // memory above turns a rejection into "nothing remembered").
  it("is null where the browser has no IndexedDB", () => {
    expect(indexedDbHandleStore(undefined)).toBeNull();
  });

  it("puts, gets and deletes by key in one database opened once", async () => {
    const { factory, log } = fakeIdb();
    const store = indexedDbHandleStore(factory);
    const handle = { kind: "file", name: "walk.zip" };
    await store?.put("tour-1", handle);
    expect(await store?.get("tour-1")).toBe(handle);
    await store?.delete("tour-1");
    expect(await store?.get("tour-1")).toBeUndefined();
    expect(log.opens).toEqual([{ name: "tour-editor-scans", version: 1 }]);
    expect(log.created).toEqual(["scans"]);
    expect(log.modes).toEqual([
      "readwrite",
      "readonly",
      "readwrite",
      "readonly",
    ]);
  });

  it("rejects a failed open and opens again at the next call", async () => {
    const { factory, log } = fakeIdb({ failOpens: 1 });
    const store = indexedDbHandleStore(factory);
    await expect(store?.get("tour-1")).rejects.toThrow("denied");
    await store?.put("tour-1", "x");
    expect(await store?.get("tour-1")).toBe("x");
    expect(log.opens).toHaveLength(2);
  });

  it("rejects an open blocked by another tab", async () => {
    const store = indexedDbHandleStore(fakeIdb({ blocked: true }).factory);
    await expect(store?.get("tour-1")).rejects.toThrow("blocked");
  });

  it("rejects a failed transaction with its error", async () => {
    const { factory } = fakeIdb({ failTx: true });
    const store = indexedDbHandleStore(factory);
    await expect(store?.put("tour-1", "x")).rejects.toThrow("quota");
  });
});
