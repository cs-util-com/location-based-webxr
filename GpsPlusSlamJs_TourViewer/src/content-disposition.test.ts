import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  fileNameFromContentDisposition,
  nameSurvivesDownload,
} from "./content-disposition.js";

/**
 * Why these tests matter (Drive replace plan §2 decision 3, §5 #7): Drive
 * offers "Replace" only when the uploaded file has the SAME name as the one
 * in Drive, so the rebuilt zip must carry the hosted file's name exactly.
 * The name arrives in the `content-disposition` header, in any of the forms
 * RFC 6266 / RFC 8187 allow; a parser that misreads one produces a silent
 * second file on Drive, and one that passes a path through could steer the
 * download outside the Downloads folder.
 */

/** A path separator or a control character - written out here rather than
 *  imported, so the property does not test the code against itself. */
function unsafe(name: string): boolean {
  return [...name].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f || char === "/" || char === "\\";
  });
}

describe("fileNameFromContentDisposition", () => {
  it.each([
    ['attachment; filename="My tour.zip"', "My tour.zip"],
    ["attachment; filename=tour.zip", "tour.zip"],
    ['attachment; FILENAME="Tour.ZIP"', "Tour.ZIP"],
    ['attachment; filename="say \\"hi\\".zip"', 'say "hi".zip'],
    [
      "attachment; filename*=UTF-8''Altstadt%20F%C3%BChrung.zip",
      "Altstadt Führung.zip",
    ],
    ["attachment; filename*=utf-8'de'Stra%C3%9Fe.zip", "Straße.zip"],
    ["attachment; filename*=ISO-8859-1''Gr%FCn.zip", "Grün.zip"],
  ])("reads %s", (header, name) => {
    expect(fileNameFromContentDisposition(header)).toBe(name);
  });

  it("prefers filename* over filename", () => {
    expect(
      fileNameFromContentDisposition(
        `attachment; filename="fallback.zip"; filename*=UTF-8''real%20name.zip`,
      ),
    ).toBe("real name.zip");
  });

  it("falls back to filename when filename* is malformed", () => {
    expect(
      fileNameFromContentDisposition(
        `attachment; filename*=UTF-8''bad%E0%A4; filename="fallback.zip"`,
      ),
    ).toBe("fallback.zip");
  });

  it("gives no name for a missing, empty or path-like one", () => {
    expect(fileNameFromContentDisposition(null)).toBeNull();
    expect(fileNameFromContentDisposition("attachment")).toBeNull();
    expect(
      fileNameFromContentDisposition('attachment; filename=""'),
    ).toBeNull();
    expect(
      fileNameFromContentDisposition('attachment; filename="../x.zip"'),
    ).toBeNull();
    expect(
      fileNameFromContentDisposition('attachment; filename="a\\\\b.zip"'),
    ).toBeNull();
    expect(
      fileNameFromContentDisposition("attachment; filename*=UTF-8''a%0Ab.zip"),
    ).toBeNull();
  });

  it("never throws, and never returns a path", () => {
    fc.assert(
      fc.property(fc.string(), (header) => {
        const name = fileNameFromContentDisposition(header);
        expect(name === null || (name !== "" && !unsafe(name))).toBe(true);
      }),
    );
  });

  it("round-trips any safe name through the RFC 8187 form", () => {
    const safe = fc
      .string({ minLength: 1 })
      .filter((s) => !unsafe(s) && s.trim() === s);
    fc.assert(
      fc.property(safe, (name) => {
        const header = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
        expect(fileNameFromContentDisposition(header)).toBe(name);
      }),
    );
  });
});

describe("nameSurvivesDownload", () => {
  // Chrome on a phone keeps a name ending in .zip with plain characters as
  // is; one without .zip, or with characters a file system refuses, is
  // changed on save - and Drive then offers no "Replace" (plan §5 #7).
  it.each([
    ["tour.zip", true],
    ["My tour.ZIP", true],
    ["Altstadt Führung.zip", true],
    ["Altstadt Tour", false],
    ["tour.tar", false],
    ["a:b.zip", false],
    ["what?.zip", false],
    ['say "hi".zip', false],
  ])("%s -> %s", (name, survives) => {
    expect(nameSurvivesDownload(name)).toBe(survives);
  });
});
