/**
 * Why these tests matter (M6 E2c): the phone backs its object edits up
 * through `draftObjectWrites`, and the tombstone tasks it builds must be
 * the records' own (`draft-persistence.ts`), in the draft's per-id
 * queue - the queue is what lands an undo's record before its tombstone
 * goes (the order itself is `followDocument`'s,
 * `tour-document-draft.test.ts`).
 */
import { describe, expect, it } from "vitest";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { DraftFileStore } from "gps-plus-slam-app-framework/storage";
import { draftObjectWrites } from "./draft-actions.js";
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
