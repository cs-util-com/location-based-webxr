/**
 * Which spelling of the tour link a printed code carries (r820 feedback R4,
 * R5).
 *
 * Why these tests matter: a code's identity is a hash of its full text,
 * and the measured pose is filed under it. Google Drive hands out the same
 * file under several spellings - the desktop's "copy link" ends in
 * `?usp=sharing`, the phone app's share in `?usp=drivesdk` - so a tour
 * measured from one and re-printed from the other got codes that matched
 * nothing it held, and the owner was told the link "must have changed"
 * while holding the very link they had used (r820 test). New codes print
 * the trimmed address (one QR version smaller for a phone-shared link);
 * a tour's own measured codes keep the spelling they were printed in, so a
 * re-print matches the posters on the wall.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { planPrintCode } from "gps-plus-slam-app-framework/utils/qr-payload/qr-print-plan";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

import { driveFileId } from "gps-plus-slam-app-framework/utils/drive-file-id";
import {
  linkSpellings,
  printableLink,
  printedCodes,
  spellingOfRecord,
} from "./print-link.js";

const ID = "1A4mU8eV16aaIvy6Msd76RC3_cbbftRkX";
const BARE = `https://drive.google.com/file/d/${ID}`;
const DESKTOP = `${BARE}/view?usp=sharing`;
const PHONE = `${BARE}/view?usp=drivesdk`;

/** The id a code would carry: the real launch-URL builder and hash. */
async function idOf(link: string, index: number): Promise<string> {
  return qrCodeId((await planPrintCode(link, { codeIndex: index })).url);
}

describe("driveFileId", () => {
  it("reads the id from every spelling Drive hands out", () => {
    for (const link of [
      DESKTOP,
      PHONE,
      BARE,
      `${BARE}/edit`,
      `https://drive.google.com/open?id=${ID}`,
      `https://drive.google.com/uc?id=${ID}&export=download`,
      `https://drive.usercontent.google.com/download?id=${ID}&confirm=t`,
    ]) {
      expect(driveFileId(link), link).toBe(ID);
    }
  });

  it("is null for anything that is not a Drive file", () => {
    for (const link of [
      "https://example.com/file/d/abc",
      "https://drive.google.com/drive/folders/abc",
      "not a link",
      `https://drive.google.com/file/d/${ID}%20x/view`,
    ]) {
      expect(driveFileId(link), link).toBeNull();
    }
  });
});

describe("printableLink", () => {
  it("trims a Drive link to the file's address, and leaves others alone", () => {
    expect(printableLink(DESKTOP)).toBe(BARE);
    expect(printableLink(PHONE)).toBe(BARE);
    expect(
      printableLink("https://www.dropbox.com/scl/fi/a/t.zip?rlkey=k&dl=0"),
    ).toBe("https://www.dropbox.com/scl/fi/a/t.zip?rlkey=k&dl=0");
  });

  // The measured gain (R5): a phone-shared link drops a QR version.
  it("prints a phone-shared Drive link one QR version smaller", async () => {
    const full = await planPrintCode(PHONE);
    const trimmed = await planPrintCode(printableLink(PHONE));
    expect(trimmed.qrVersion).toBeLessThan(full.qrVersion);
  });
});

describe("linkSpellings", () => {
  // The link as given first: a tour re-printed from the link it was
  // printed from - the common case - is found in one round (M0c review,
  // finding 2). Drive's newer share tails too (finding 3).
  it("tries the link as given first, then the trimmed address and Drive's spellings", () => {
    expect(linkSpellings(PHONE)).toEqual([
      PHONE,
      BARE,
      `${BARE}/view`,
      DESKTOP,
      `${BARE}/view?usp=drive_link`,
      `${BARE}/view?usp=share_link`,
    ]);
    expect(linkSpellings(`${BARE}/edit?usp=x`)[0]).toBe(`${BARE}/edit?usp=x`);
    expect(linkSpellings("https://h.example/t.zip")).toEqual([
      "https://h.example/t.zip",
    ]);
  });

  it("starts with the link as given, holds the printable link, and each spelling once (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(DESKTOP, PHONE, BARE, "https://h.example/t.zip"),
        fc.string({ maxLength: 8 }),
        (base, tail) => {
          const link = base + tail.replace(/\s/g, "");
          const spellings = linkSpellings(link);
          expect(spellings[0]).toBe(link);
          expect(spellings).toContain(printableLink(link));
          expect(new Set(spellings).size).toBe(spellings.length);
        },
      ),
    );
  });
});

describe("spellingOfRecord", () => {
  // The owner's r820 case: measured from the phone's link, re-printed from
  // the desktop's copy of the same file.
  it("finds the spelling a tour's codes were printed from, and continues its numbering", async () => {
    const measured = new Set([await idOf(PHONE, 1), await idOf(PHONE, 2)]);
    await expect(
      spellingOfRecord(DESKTOP, measured, idOf, 50),
    ).resolves.toEqual({
      link: PHONE,
      next: 3,
    });
  });

  it("prints the trimmed address for a tour with no codes, from number 1", async () => {
    await expect(spellingOfRecord(PHONE, new Set(), idOf, 50)).resolves.toEqual(
      {
        link: BARE,
        next: 1,
      },
    );
  });

  // A different FILE is a different link: nothing matches, the new codes
  // print trimmed from 1, and the orphan warning is the panel's to give.
  it("falls back to the trimmed address when no spelling matches", async () => {
    const other = new Set([await idOf("https://h.example/other.zip", 1)]);
    await expect(spellingOfRecord(PHONE, other, idOf, 50)).resolves.toEqual({
      link: BARE,
      next: 1,
    });
  });

  it("stops at the first spelling that matches", async () => {
    const measured = new Set([await idOf(BARE, 1)]);
    const asked: string[] = [];
    const counting = (link: string, index: number) => {
      asked.push(link);
      return idOf(link, index);
    };
    await expect(
      spellingOfRecord(PHONE, measured, counting, 50),
    ).resolves.toEqual({
      link: BARE,
      next: 2,
    });
    // The link as given (the phone's) has no match, so all 50 numbers are
    // tried; the trimmed one matches at number 1 and the search stops there
    // (PR #586).
    expect(asked.filter((l) => l === PHONE)).toHaveLength(50);
    expect(asked.filter((l) => l === BARE)).toHaveLength(1);
    expect(asked.at(-1)).toBe(BARE);
  });
});

describe("the printed text on the levels (F2)", () => {
  // Why: a spelling outside `linkSpellings` - Drive for desktop's
  // `open?id=...&usp=drive_fs` - was a different code to the search, so the
  // re-print started a new numbering and the orphan warning fired on a
  // link the creator never changed (M0c milestone review #3). A code
  // measured since F2 carries its text; the spelling and number are read.
  const DRIVE_FS = `https://drive.google.com/open?id=${ID}&usp=drive_fs`;

  async function level(link: string, index: number) {
    const text = (await planPrintCode(link, { codeIndex: index })).url;
    return { id: await qrCodeId(text), text };
  }

  it("reads a code's link and number back from its text", async () => {
    const two = await level(DRIVE_FS, 2);
    const one = await level(DRIVE_FS, 1);
    await expect(printedCodes([two, one])).resolves.toEqual([
      { id: two.id, link: DRIVE_FS, index: 2 },
      { id: one.id, link: DRIVE_FS, index: 1 },
    ]);
  });

  it("ignores a text that is not its level's own, and one that is not a launch URL", async () => {
    const two = await level(DRIVE_FS, 2);
    const one = await level(DRIVE_FS, 1);
    await expect(
      printedCodes([
        { id: one.id, text: two.text },
        { id: await qrCodeId("hello"), text: "hello" },
      ]),
    ).resolves.toEqual([]);
  });

  it("continues an unlisted spelling's numbering from the stored texts", async () => {
    expect(linkSpellings(DESKTOP)).not.toContain(DRIVE_FS);
    const codes = [await level(DRIVE_FS, 1), await level(DRIVE_FS, 2)];
    const printed = await printedCodes(codes);
    await expect(
      spellingOfRecord(
        DESKTOP,
        new Set(codes.map((c) => c.id)),
        idOf,
        50,
        printed,
      ),
    ).resolves.toEqual({ link: DRIVE_FS, next: 3 });
  });

  it("takes the higher next when older codes of the same spelling have no text", async () => {
    // Codes 1-3 printed before F2; only code 1 was measured again since,
    // so only it carries its text. Number 2 must not be printed again.
    const one = await level(PHONE, 1);
    const measured = new Set([
      one.id,
      await idOf(PHONE, 2),
      await idOf(PHONE, 3),
    ]);
    await expect(
      spellingOfRecord(PHONE, measured, idOf, 50, await printedCodes([one])),
    ).resolves.toEqual({ link: PHONE, next: 4 });
  });

  // r834 milestone review #2a: the textless codes are searched in the
  // STORED spelling, not the link as given - the case F2 exists for.
  it("searches codes without a text in the stored spelling, not the link as given", async () => {
    const one = await level(DRIVE_FS, 1);
    const measured = new Set([
      one.id,
      await idOf(DRIVE_FS, 2),
      await idOf(DRIVE_FS, 3),
    ]);
    await expect(
      spellingOfRecord(DESKTOP, measured, idOf, 50, await printedCodes([one])),
    ).resolves.toEqual({ link: DRIVE_FS, next: 4 });
  });

  // r834 review #2b: two spellings of one tour - the one with more codes
  // wins; on a tie, the one with the higher number.
  it("prefers the spelling with more codes, then the higher number", async () => {
    const more = await printedCodes([
      await level(PHONE, 1),
      await level(PHONE, 2),
      await level(DRIVE_FS, 5),
    ]);
    await expect(
      spellingOfRecord(BARE, new Set(more.map((c) => c.id)), idOf, 50, more),
    ).resolves.toEqual({ link: PHONE, next: 3 });
    const tie = await printedCodes([
      await level(PHONE, 1),
      await level(DRIVE_FS, 4),
    ]);
    await expect(
      spellingOfRecord(BARE, new Set(tie.map((c) => c.id)), idOf, 50, tie),
    ).resolves.toEqual({ link: DRIVE_FS, next: 5 });
  });

  // r834 review #2c: a link that is not a Drive file matches only itself.
  it("reads a non-Drive tour's own stored codes", async () => {
    const LINK = "https://h.example/tours/mill.zip";
    const two = await level(LINK, 2);
    await expect(
      spellingOfRecord(
        LINK,
        new Set([two.id]),
        idOf,
        50,
        await printedCodes([two]),
      ),
    ).resolves.toEqual({ link: LINK, next: 3 });
  });

  it("ignores stored texts that name another tour", async () => {
    const other = await level("https://h.example/other.zip", 4);
    await expect(
      spellingOfRecord(
        PHONE,
        new Set([other.id]),
        idOf,
        50,
        await printedCodes([other]),
      ),
    ).resolves.toEqual({ link: BARE, next: 1 });
  });

  it("numbers on from the highest stored number of a spelling (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 9 }), {
          minLength: 1,
          maxLength: 4,
        }),
        async (indexes) => {
          const codes = await Promise.all(
            indexes.map((i) => level(DRIVE_FS, i)),
          );
          const result = await spellingOfRecord(
            DRIVE_FS,
            new Set(codes.map((c) => c.id)),
            idOf,
            50,
            await printedCodes(codes),
          );
          expect(result).toEqual({
            link: DRIVE_FS,
            next: Math.max(...indexes) + 1,
          });
        },
      ),
      { numRuns: 15 },
    );
  });
});
