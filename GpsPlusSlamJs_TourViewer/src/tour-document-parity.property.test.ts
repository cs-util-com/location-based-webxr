/**
 * The parity contract as a property (the tour editor plan: one document,
 * shared by both pages): for any
 * sequence of the operations both pages offer - an edit of a pin's text, a
 * delete (taken back or not), a new pin, the tour's name - the phone's
 * Finish writes the same `tour.json` as the desktop's download. Both save
 * through one handle per open (`tour-document-save.ts`), so this is what
 * holds them to one write.
 *
 * Why this test matters: the table (`tour-document-parity.test.ts`) pins
 * the sequences someone thought of; the two pages once kept two working
 * copies of one tour, and a split that shows only after an unusual order
 * of edits is the kind the table misses. Only `tour.json` is compared:
 * no code is measured in these sequences, so the phone's Finish writes no
 * level (asserted: the file it made holds the same entries as the
 * desktop's).
 *
 * Seeded, so a red run names the same sequence again. 24 runs of one to four operations
 * over the four kinds (edit, delete, new pin, name) reach every ordered
 * pair of kinds several times over; each run opens both pages and
 * rebuilds two zips (about 1-2 s), so more would buy little within the
 * time budget.
 */
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { readStoredCentralDirectory } from "gps-plus-slam-app-framework/test-utils/zip-central-directory";
import { memoryDraftStores } from "./test-support/memory-draft-stores.js";
import { editorStore } from "./test-support/editor-store.js";
import {
  desktopPage,
  OPENED,
  phonePage,
  pin,
  tourFile,
  withStationsByOrder,
  type Page,
} from "./test-support/parity-pages.js";

beforeAll(() => {
  editorStore();
});

/** The entry names of a saved file, sorted. */
async function entryNames(file: File): Promise<string[]> {
  return readStoredCentralDirectory(new Uint8Array(await file.arrayBuffer()))
    .map((entry) => entry.name)
    .sort();
}

/** One operation, its target chosen at run time among what the tour
 *  still holds (`pick`, modulo their count). */
type Op =
  | { readonly kind: "edit"; readonly pick: number; readonly text: string }
  | { readonly kind: "remove"; readonly pick: number; readonly undo: boolean }
  | { readonly kind: "place"; readonly lat: number }
  | { readonly kind: "name"; readonly name: string };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("edit" as const),
    pick: fc.nat(5),
    text: fc.constantFrom("first words", "second words", "a third"),
  }),
  fc.record({
    kind: fc.constant("remove" as const),
    pick: fc.nat(5),
    undo: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("place" as const),
    // Within the first station's radius, and beyond every station's.
    lat: fc.constantFrom(48.52, 48.523),
  }),
  fc.record({
    kind: fc.constant("name" as const),
    name: fc.constantFrom("Harbour Lights", "Castle walk", ""),
  }),
);

/** Drives `ops` on `page`, tracking what the tour holds so every target
 *  exists; ends with an edit, so the phone always has work to Finish. */
async function drive(page: Page, ops: readonly Op[]): Promise<void> {
  const present = OPENED.map((o) => o.id);
  const pins = new Set(["a", "b"]);
  let placed = 0;
  const pinOf = (pick: number): string | undefined => {
    const ids = present.filter((id) => pins.has(id));
    return ids[pick % Math.max(1, ids.length)];
  };
  for (const op of ops) {
    switch (op.kind) {
      case "edit": {
        const id = pinOf(op.pick);
        if (id !== undefined) await page.edit(id, op.text);
        break;
      }
      case "remove": {
        const id = present[op.pick % present.length];
        if (id === undefined || present.length === 1) break;
        await page.remove(id);
        if (op.undo) await page.undoDelete();
        else present.splice(present.indexOf(id), 1);
        break;
      }
      case "place": {
        placed += 1;
        const id = `new-${String(placed)}`;
        await page.place(pin(id, `pin ${id}`, op.lat));
        present.push(id);
        pins.add(id);
        break;
      }
      case "name":
        await page.setDetails({ name: op.name });
        break;
    }
  }
  const last = pinOf(0);
  if (last !== undefined) await page.edit(last, "the last words");
}

describe("the parity contract as a property: the phone's Finish and the desktop's download write the same tour.json", () => {
  it("for any sequence of edits, deletes, new pins and names", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(opArb, { minLength: 1, maxLength: 4 }),
        async (ops) => {
          const desktop = await desktopPage(
            await tourFile(),
            memoryDraftStores().open,
          );
          await drive(desktop, ops);
          const downloaded = await desktop.download();
          const phone = await phonePage(
            await tourFile(),
            memoryDraftStores().open,
          );
          await drive(phone, ops);
          const finished = await phone.save();
          expect(withStationsByOrder(finished)).toEqual(
            withStationsByOrder(downloaded.written),
          );
          // No level the desktop's file lacks: the same entries in both.
          expect(await entryNames(phone.lastFinished())).toEqual(
            await entryNames(downloaded.file),
          );
        },
      ),
      { numRuns: 24, seed: 1558 },
    );
  }, 240_000);
});
