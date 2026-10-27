/**
 * The editor opens a tour from its link (tour editor plan 2026-10-17-1816,
 * W1 step 5).
 *
 * Why these tests matter: a creator whose tour is hosted had to download
 * the zip before the editor could open it. The link is fetched whole
 * through the same transport the viewer streams with (its Drive proxy, its
 * caps, its refusal causes) and handed to the editor's ONE open path as a
 * file. These pin what crosses that seam: every byte, in order; the name
 * the editor's Save offers; the download stopped on every outcome; and a
 * refusal worded as the viewer words it, never a raw transport error.
 */
import { OpenRemoteArchiveError } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it, vi } from "vitest";

import { HOST_REFUSED_TEXT, describeOpenError } from "../open-errors.js";
import {
  NOT_A_LINK,
  fetchTourFile,
  linkFileName,
  linkHostedName,
  linkOpenErrorText,
} from "./editor-link.js";

function fakeArchive(bytes: Uint8Array, url: string) {
  return {
    size: bytes.length,
    url,
    source: {
      size: bytes.length,
      read: vi.fn((offset: number, length: number) =>
        Promise.resolve(bytes.slice(offset, offset + length)),
      ),
    },
    dispose: vi.fn(),
  };
}

const LINK = "https://example.test/tours/Castle%20walk.zip";

describe("fetchTourFile", () => {
  it("reads the whole archive, in slices, into a zip File named after the link", async () => {
    const bytes = Uint8Array.from({ length: 10 }, (_, i) => i);
    const archive = fakeArchive(bytes, LINK);
    const open = vi.fn(() => Promise.resolve(archive));
    const file = await fetchTourFile(` ${LINK} `, {
      open,
      corsProxyBaseUrl: "/api/drive-proxy",
      sliceBytes: 4,
    });
    expect(open).toHaveBeenCalledWith(LINK, {
      corsProxyBaseUrl: "/api/drive-proxy",
      warm: false,
    });
    expect(file.name).toBe("Castle walk.zip");
    expect(file.type).toBe("application/zip");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(archive.source.read).toHaveBeenCalledTimes(3);
    expect(archive.dispose).toHaveBeenCalledTimes(1);
  });

  // Why: every Drive link used to suggest the bare `tour.zip`, so a second
  // tour opened from Drive offered the first one's file, and Enter plus
  // the system's "Replace?" wrote the original over an edited tour (r955
  // review #1). A Drive link's file carries the start of its file id.
  it("names a Drive link after the start of its file id, any other link without a .zip name tour.zip", async () => {
    const drive = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view";
    const archive = fakeArchive(new Uint8Array([1]), drive);
    const file = await fetchTourFile(drive, {
      open: () => Promise.resolve(archive),
    });
    expect(file.name).toBe("tour-1AbCdEfGhIjK.zip");
    const other = "https://example.test/share?file=7";
    const plain = await fetchTourFile(other, {
      open: () => Promise.resolve(fakeArchive(new Uint8Array([1]), other)),
    });
    expect(plain.name).toBe("tour.zip");
  });

  it("stops the download when a read fails, and rejects", async () => {
    const archive = fakeArchive(new Uint8Array(8), LINK);
    archive.source.read.mockImplementationOnce(() =>
      Promise.reject(new Error("network gone")),
    );
    await expect(
      fetchTourFile(LINK, { open: () => Promise.resolve(archive) }),
    ).rejects.toThrow("network gone");
    expect(archive.dispose).toHaveBeenCalledTimes(1);
  });

  it("refuses what is not a web link, before any request", async () => {
    const open = vi.fn();
    for (const text of ["", "   ", "castle.zip", "ftp://example.test/a.zip"]) {
      await expect(fetchTourFile(text, { open })).rejects.toThrow(NOT_A_LINK);
    }
    expect(open).not.toHaveBeenCalled();
  });
});

// Why: a tour opened from its link asks where to save it in the click,
// before the fetch - so the save dialog's suggested name must be the name
// the fetched file will carry, worked out from the link alone; and text
// that is not a link opens no dialog at all (the open refuses it).
// Why: Done tells the creator to upload the saved file under the hosted
// file's name; only a name the link itself carries is that name, never
// a stand-in made up for a link without one.
describe("linkHostedName", () => {
  it("is the link's own zip name, and null where the link names none", () => {
    expect(linkHostedName(LINK)).toBe("Castle walk.zip");
    expect(linkHostedName(`  ${LINK}  `)).toBe("Castle walk.zip");
    expect(linkHostedName("https://drive.google.com/open?id=abc")).toBeNull();
    expect(
      linkHostedName("https://drive.example.test/file/d/abc/view"),
    ).toBeNull();
  });
});

describe("linkFileName", () => {
  it("is the name the fetched file carries, before any request", async () => {
    expect(linkFileName(LINK)).toBe("Castle walk.zip");
    expect(linkFileName(`  ${LINK}  `)).toBe("Castle walk.zip");
    expect(linkFileName("https://drive.example.test/file/d/abc/view")).toBe(
      "tour.zip",
    );
    expect(linkFileName("https://drive.google.com/open?id=abc")).toBe(
      "tour-abc.zip",
    );
    const file = await fetchTourFile(LINK, {
      open: () => Promise.resolve(fakeArchive(new Uint8Array([1, 2]), LINK)),
    });
    expect(file.name).toBe(linkFileName(LINK));
  });

  it("is null for what is not a web link", () => {
    for (const text of ["", "   ", "castle.zip", "ftp://example.test/a.zip"]) {
      expect(linkFileName(text)).toBeNull();
      expect(linkHostedName(text)).toBeNull();
    }
  });
});

describe("linkOpenErrorText", () => {
  it("words a refusal as the viewer does (a host that blocks browsers)", () => {
    const text = linkOpenErrorText(
      new OpenRemoteArchiveError("blocked", "cors"),
      LINK,
    );
    // One wording for one refusal (M1 review #6): the viewer's first
    // sentence itself, not a copy that can drift from it.
    expect(text.split("\n")[0]).toBe(HOST_REFUSED_TEXT);
    // The viewer's "tap Open the downloaded file below" names a button
    // the editor has not got: here the way around is its own picker.
    expect(text).toMatch(/download the file to this computer, then choose it/i);
    expect(text).not.toMatch(/Open the downloaded file/);
  });

  it("words every other refusal exactly as the viewer does", () => {
    const err = new OpenRemoteArchiveError("gone", "missing");
    expect(linkOpenErrorText(err, LINK)).toBe(describeOpenError(err, LINK));
  });

  it("keeps a plain error's own words", () => {
    expect(linkOpenErrorText(new Error("network gone"), LINK)).toBe(
      "network gone",
    );
  });
});
