import { describe, expect, it } from "vitest";
import { normalizeShareUrl } from "gps-plus-slam-app-framework/storage";

import {
  DEFAULT_ASSET_PREFIX,
  launchPayload,
  resolveCodeTour,
  tourRelation,
} from "./code-tour.js";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";

/**
 * Why these tests matter (TourViewer scan-to-open plan §9 #2, #4, #6): in
 * step 4 the printed code IS the tour's link. Which tour a code names
 * decides whether a scan opens a tour, switches tours, or leaves Save off
 * for a code of another tour. Comparing links as written fails on Google
 * Drive, which gives one file three spellings; the first design did that,
 * and the tour's OWN code would have read "belongs to another tour" and
 * locked Save.
 */

const PROXY = "/api/drive-proxy";
const DRIVE_ID = "1AbCdEfGhIjKlMnOpQ";
const launch = (payload: string): string =>
  `https://gps.csutil.com/tour/?qr=${encodeURIComponent(payload)}`;

describe("launchPayload", () => {
  it("reads the qr parameter of a printed launch link", () => {
    expect(launchPayload(launch("x"))).toBe("x");
    expect(launchPayload(launch("https://h.test/a.zip"))).toBe(
      "https://h.test/a.zip",
    );
  });

  it("is null for anything that is not a launch link", () => {
    expect(launchPayload("https://h.test/?a=1")).toBeNull();
    expect(launchPayload("https://h.test/?qr=")).toBeNull();
    expect(launchPayload("https://h.test/?qr=%20%20")).toBeNull();
    expect(launchPayload("hello")).toBeNull();
    expect(launchPayload("")).toBeNull();
  });
});

describe("resolveCodeTour", () => {
  it("names the tour a launch link carries, in the form the open uses", async () => {
    const code = await resolveCodeTour(launch("https://h.test/t.zip"), PROXY);
    expect(code).toEqual({
      kind: "tour",
      url: "https://h.test/t.zip",
      normalizedUrl: "https://h.test/t.zip",
      comparable: true,
      levelId: await qrCodeId(launch("https://h.test/t.zip")),
    });
  });

  it("resolves a bare name under the default asset prefix, as a ?qr= boot does", async () => {
    const code = await resolveCodeTour(launch("demo.zip"), PROXY);
    expect(code.kind === "tour" && code.url).toBe(
      `${DEFAULT_ASSET_PREFIX}demo.zip`,
    );
  });

  it("tells a code that is no launch link from one whose payload is unreadable", async () => {
    expect(await resolveCodeTour("https://h.test/menu", PROXY)).toEqual({
      kind: "not-a-tour-code",
    });
    expect(await resolveCodeTour("plain text", PROXY)).toEqual({
      kind: "not-a-tour-code",
    });
    expect(await resolveCodeTour(launch("?!"), PROXY)).toEqual({
      kind: "unreadable",
    });
  });

  it("does not compare links that only a redirect resolves", async () => {
    const code = await resolveCodeTour(launch("https://bit.ly/abc"), PROXY);
    expect(code.kind === "tour" && code.comparable).toBe(false);
  });
});

describe("tourRelation", () => {
  const driveSpellings = [
    `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`,
    `https://drive.google.com/open?id=${DRIVE_ID}`,
    `https://drive.google.com/uc?id=${DRIVE_ID}&export=download`,
  ];

  it("recognises the open tour's code under every Drive spelling", async () => {
    // The open tour's archive url is what `openRemoteArchive` made of the
    // link step 1 was given - here the first spelling.
    const openUrl = normalizeShareUrl(driveSpellings[0]!, {
      corsProxyBaseUrl: PROXY,
    });
    for (const spelling of driveSpellings) {
      const code = await resolveCodeTour(launch(spelling), PROXY);
      expect(tourRelation(code, openUrl), spelling).toBe("this-tour");
    }
  });

  it("calls a different file another tour", async () => {
    const openUrl = normalizeShareUrl(driveSpellings[0]!, {
      corsProxyBaseUrl: PROXY,
    });
    const code = await resolveCodeTour(
      launch("https://drive.google.com/file/d/ZZZotherfile/view"),
      PROXY,
    );
    expect(tourRelation(code, openUrl)).toBe("other-tour");
  });

  it("recognises a GitHub tour whether its link carries refs/heads or not", async () => {
    // Milestone review #7: the print step shrinks a raw GitHub link to
    // user/repo/path, which decodes to .../refs/heads/main/... - while the
    // tour may have been opened with the plain /main/ link.
    const openUrl = "https://raw.githubusercontent.com/u/r/main/t.zip";
    const code = await resolveCodeTour(
      launch("https://raw.githubusercontent.com/u/r/refs/heads/main/t.zip"),
      PROXY,
    );
    expect(tourRelation(code, openUrl)).toBe("this-tour");
  });

  it("recognises a Dropbox tour whatever copy of its share link was printed", async () => {
    // The st token differs between copies of one share; dl only picks a mode.
    const openUrl = normalizeShareUrl(
      "https://www.dropbox.com/scl/fi/abc/t.zip?rlkey=k&st=one&dl=0",
      { corsProxyBaseUrl: PROXY },
    );
    const code = await resolveCodeTour(
      launch("https://www.dropbox.com/scl/fi/abc/t.zip?rlkey=k&st=two&dl=1"),
      PROXY,
    );
    expect(tourRelation(code, openUrl)).toBe("this-tour");
    const other = await resolveCodeTour(
      launch("https://www.dropbox.com/scl/fi/abc/t.zip?rlkey=other"),
      PROXY,
    );
    expect(tourRelation(other, openUrl)).toBe("other-tour");
  });

  it("says unknown, not other, for a link it cannot compare", async () => {
    const code = await resolveCodeTour(launch("https://bit.ly/abc"), PROXY);
    expect(tourRelation(code, "https://h.test/t.zip")).toBe("unknown");
  });

  it("says unknown when the OPEN tour came from a link it cannot compare", async () => {
    const code = await resolveCodeTour(launch("https://h.test/t.zip"), PROXY);
    expect(tourRelation(code, "https://bit.ly/abc")).toBe("unknown");
  });

  it("with no tour open, a tour code is one to open", async () => {
    const code = await resolveCodeTour(launch("https://h.test/t.zip"), PROXY);
    expect(tourRelation(code, null)).toBe("no-tour-open");
  });

  it("a code that names no tour is never another tour", () => {
    expect(
      tourRelation({ kind: "not-a-tour-code" }, "https://h.test/t.zip"),
    ).toBe("not-a-tour");
    expect(tourRelation({ kind: "unreadable" }, null)).toBe("not-a-tour");
  });
});

/**
 * Why these tests matter (K0 milestone review R6): a tour opened from a
 * FILE is known by a content key, not a link, so its own printed code could
 * never match it and the creator's panel said "This code is from another
 * tour" about the tour's own poster. The tour's identity - the level files
 * it carries, named by the code's own id - decides first.
 */
describe("tourRelation for a tour opened from a file", () => {
  const FILE_KEY = "local-file:0123456789abcdef0123456789abcdef";

  it("recognises the tour's own printed code by the level it carries", async () => {
    const text = launch("https://h.test/t.zip");
    const code = await resolveCodeTour(text, PROXY);
    const levels = new Set([await qrCodeId(text)]);
    expect(tourRelation(code, FILE_KEY, levels)).toBe("this-tour");
  });

  it("cannot tell any other code's tour, so it says unknown, never another tour", async () => {
    const code = await resolveCodeTour(launch("https://h.test/t.zip"), PROXY);
    expect(tourRelation(code, FILE_KEY, new Set())).toBe("unknown");
  });

  it("knows a link-opened tour's code by its level too, whatever link was printed", async () => {
    const text = launch("https://other.example/renamed.zip");
    const code = await resolveCodeTour(text, PROXY);
    const levels = new Set([await qrCodeId(text)]);
    expect(tourRelation(code, "https://h.test/t.zip", levels)).toBe(
      "this-tour",
    );
  });
});
