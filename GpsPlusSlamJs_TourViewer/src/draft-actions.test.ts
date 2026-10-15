/**
 * Why these tests matter (M6 E2c, the E2c plan review #4): the phone's
 * object list and the desktop editor both back their edits up in a
 * draft, and the ORDER of a delete's and an undo's writes is what keeps a
 * cut-short undo from half restoring an object (the tombstone outranks a
 * record until it goes). One home for those sequences means the two
 * pages cannot come to disagree about it; these pin the order and the
 * outcomes, and that the builder's writes are the records'
 * (`draft-persistence.ts`).
 */
import { describe, expect, it } from "vitest";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import {
  draftObjectWrites,
  recordDelete,
  recordUndoDelete,
  type DraftObjectWrites,
} from "./draft-actions.js";
import { deletedKey, objectKey } from "./draft-persistence.js";

function pin(id: string): TourObject {
  return {
    id,
    kind: "pin",
    label: id,
    createdAtIso: "2026-10-14T00:00:00.000Z",
    geo: { lat: 48.5, lon: 9.0, alt: 340, headingDeg: 0 },
  };
}

/** Writes that log their calls, each answering `ok`. */
function logged(ok = true): DraftObjectWrites & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    saveObject: (object) => {
      calls.push(`save ${object.id}`);
      return Promise.resolve(ok);
    },
    saveDeletion: (id) => {
      calls.push(`tombstone ${id}`);
      return Promise.resolve(ok);
    },
    forgetDeletion: (id) => {
      calls.push(`untombstone ${id}`);
      return Promise.resolve(ok);
    },
    forgetObject: (id) => {
      calls.push(`forget ${id}`);
      return Promise.resolve();
    },
  };
}

describe("recordDelete", () => {
  it("a hosted object gets a tombstone, a local one loses its record", async () => {
    const writes = logged();
    expect(await recordDelete(writes, "a", true)).toBe(true);
    expect(await recordDelete(writes, "b", false)).toBe(true);
    expect(writes.calls).toEqual(["tombstone a", "forget b"]);
  });

  it("a tombstone that did not land, or a write that threw, is false", async () => {
    expect(await recordDelete(logged(false), "a", true)).toBe(false);
    const throwing: DraftObjectWrites = {
      ...logged(),
      saveDeletion: () => Promise.reject(new Error("quota")),
    };
    expect(await recordDelete(throwing, "a", true)).toBe(false);
  });
});

describe("recordUndoDelete", () => {
  it("writes the record FIRST, then takes the tombstone back - both queued at once", async () => {
    // Why: until the tombstone goes it outranks the record, so an undo
    // cut short leaves the object deleted, never half restored - and the
    // undo of a delete of an EDITED note must write its record again
    // (the deletion removed it; E2c plan review #11).
    const writes = logged();
    const done = recordUndoDelete(writes, {
      object: pin("a"),
      placed: { object: { ...pin("a"), label: "edited" } },
      hosted: true,
    });
    // Both issued synchronously, in this order (the id's queue lands them
    // in call order).
    expect(writes.calls).toEqual(["save a", "untombstone a"]);
    expect(await done).toBe(true);
  });

  it("an unedited hosted object only loses its tombstone; a local one only gets its record", async () => {
    const hosted = logged();
    await recordUndoDelete(hosted, {
      object: pin("a"),
      placed: null,
      hosted: true,
    });
    expect(hosted.calls).toEqual(["untombstone a"]);
    const local = logged();
    await recordUndoDelete(local, {
      object: pin("b"),
      placed: { object: pin("b") },
      hosted: false,
    });
    expect(local.calls).toEqual(["save b"]);
  });

  it("is false when either write failed or threw", async () => {
    expect(
      await recordUndoDelete(logged(false), {
        object: pin("a"),
        placed: { object: pin("a") },
        hosted: true,
      }),
    ).toBe(false);
    const throwing: DraftObjectWrites = {
      ...logged(),
      forgetDeletion: () => Promise.reject(new Error("gone")),
    };
    expect(
      await recordUndoDelete(throwing, {
        object: pin("a"),
        placed: { object: pin("a") },
        hosted: true,
      }),
    ).toBe(false);
  });
});

describe("draftObjectWrites", () => {
  it("writes and takes back a tombstone through the draft's own queue", async () => {
    const files = new Map<string, string>();
    const store = {
      put: (key: string, data: unknown) => {
        files.set(key, String(data));
        return Promise.resolve(true);
      },
      remove: (key: string) => {
        files.delete(key);
        return Promise.resolve();
      },
    } as unknown as DraftFileStore;
    const queued: string[] = [];
    const writes = draftObjectWrites({
      writeObject: (object) => {
        queued.push(`record ${object.id}`);
        return Promise.resolve(true);
      },
      write: (id, task) => {
        queued.push(`task ${id}`);
        return task(store);
      },
      forgetObject: (id) => {
        queued.push(`forget ${id}`);
        return Promise.resolve();
      },
    });
    files.set(objectKey("a"), "{}");
    expect(await writes.saveDeletion("a")).toBe(true);
    expect(files.has(deletedKey("a"))).toBe(true);
    // The tombstone is the commit point: the record goes with it.
    expect(files.has(objectKey("a"))).toBe(false);
    expect(await writes.forgetDeletion("a")).toBe(true);
    expect(files.has(deletedKey("a"))).toBe(false);
    await writes.saveObject(pin("b"));
    await writes.forgetObject("c");
    expect(queued).toEqual(["task a", "task a", "record b", "forget c"]);
  });
});
