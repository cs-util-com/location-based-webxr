/**
 * Where the tour lives (polish round M2, A6/A7): the creator picks a host
 * first, and every later step speaks that host's language.
 *
 * Why these tests matter: the owner found step 1 confusing ("Host your
 * tour", a test link and a starter zip, all at once). The host choice is
 * the context the rest of the flow uses - its own upload and link steps,
 * whether the starter zip is needed, and how the zip is replaced later so
 * the printed link keeps working. A stored choice must survive a reload,
 * and an unreadable store must never break the page.
 */
import { describe, expect, it } from "vitest";

import {
  TOUR_HOSTS,
  hostReplaceOnComputer,
  hostReplaceText,
  hostSteps,
  isTourHost,
  needsStarterZip,
  readTourHost,
  writeTourHost,
  hostStepParts,
  hostOfLink,
} from "./tour-host.js";

function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

describe("tour hosts", () => {
  it("offers Google Drive, Dropbox, OneDrive, GitHub and your own server, in that order", () => {
    expect(TOUR_HOSTS.map((h) => h.id)).toEqual([
      "drive",
      "dropbox",
      "onedrive",
      "github",
      "own",
    ]);
    for (const h of TOUR_HOSTS) expect(h.label.length).toBeGreaterThan(0);
  });

  it("gives each host its own steps, ending at the link", () => {
    for (const h of TOUR_HOSTS) {
      const steps = hostSteps(h.id);
      expect(steps.length, h.id).toBeGreaterThanOrEqual(2);
      expect(steps.at(-1), h.id).toMatch(/link/i);
    }
  });

  // Why: an own server is reached by any browser only with cross-origin
  // reads and byte ranges (the Drive proxy fronts Drive only); without
  // saying so the creator's first check fails for no visible reason.
  it("tells an own server what it must allow, and that the link can come first", () => {
    const steps = hostSteps("own").join(" ");
    expect(steps).toContain("Access-Control-Allow-Origin");
    expect(steps).toContain("Accept-Ranges");
    expect(steps).toMatch(/before the file exists/i);
  });

  it("asks for the starter zip only where the host needs a file to give a link", () => {
    expect(needsStarterZip("drive")).toBe(true);
    expect(needsStarterZip("dropbox")).toBe(true);
    expect(needsStarterZip("onedrive")).toBe(true);
    expect(needsStarterZip("github")).toBe(true);
    expect(needsStarterZip("own")).toBe(false);
  });

  it("keeps the choice across a reload, and ignores anything it did not write", () => {
    const store = memoryStore();
    expect(readTourHost(store)).toBeNull();
    writeTourHost(store, "dropbox");
    expect(readTourHost(store)).toBe("dropbox");
    store.items.set([...store.items.keys()][0]!, "ftp");
    expect(readTourHost(store)).toBeNull();
    expect(isTourHost("ftp")).toBe(false);
  });

  it("never throws on a store that throws, or with no store at all", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTourHost(throwing)).toBeNull();
    expect(() => writeTourHost(throwing, "drive")).not.toThrow();
    expect(readTourHost(undefined)).toBeNull();
  });
});

describe("hostReplaceText (polish round M2, step 6)", () => {
  // Why: the completion step tells the creator how to put the saved zip in
  // place of the hosted one so the printed link keeps working. The page
  // used to list every host in one paragraph; the chosen host is known
  // now, so it gets its own words. Drive's steps come from the link
  // itself (they need the file's name), so it has none here.
  it("names the host's own way to replace the file under the same link", () => {
    expect(hostReplaceText("dropbox")).toMatch(/Dropbox/);
    expect(hostReplaceText("dropbox")).toMatch(/same name/);
    expect(hostReplaceText("onedrive")).toMatch(/"Replace"/);
    expect(hostReplaceText("github")).toMatch(/same path/);
    expect(hostReplaceText("own")).toMatch(/server/);
  });

  it("leaves Drive to the link's own steps", () => {
    expect(hostReplaceText("drive")).toBeNull();
  });

  it("speaks of one host only, never the others", () => {
    for (const { id } of TOUR_HOSTS) {
      const text = hostReplaceText(id);
      if (text === null) continue;
      const others = TOUR_HOSTS.filter((h) => h.id !== id && h.id !== "own");
      for (const other of others) expect(text).not.toContain(other.label);
    }
  });
});

describe("hostReplaceOnComputer (tour editor plan 2026-10-17-1816, W2: Done)", () => {
  // Why: the desktop editor's Done tells a creator at a computer how to put
  // the saved file in place of the hosted one, for the host it lives on -
  // Drive too, whose phone steps come from the link and speak of a phone.
  // The phone's sentences must stay exactly as they were.
  it("names the file and the host's own way to replace it under the same link", () => {
    for (const { id, label } of TOUR_HOSTS) {
      const text = hostReplaceOnComputer(id, "castle.zip");
      expect(text).toContain("castle.zip");
      expect(text).toMatch(/printed code - stays the same/);
      // An own server has no name to say.
      expect(id === "own" || text.includes(label)).toBe(true);
    }
    expect(hostReplaceOnComputer("drive", "castle.zip")).toMatch(
      /"Replace existing file"/,
    );
    expect(hostReplaceOnComputer("own", "castle.zip")).toMatch(/server/);
  });

  // Why: a host keeps the link only for a file of the same name, and the
  // file a creator saved may carry another (a dated one, from a link's
  // open): uploading it as it is would put a second file beside the
  // hosted one and leave the link on the old tour.
  it("says to rename the saved file to the hosted one's name when the two differ", () => {
    for (const { id } of TOUR_HOSTS) {
      const text = hostReplaceOnComputer(
        id,
        "castle-2026-10-07-090500.zip",
        "castle.zip",
      );
      expect(
        text.startsWith(
          "Rename castle-2026-10-07-090500.zip to castle.zip, the name of the file at your tour's link, and upload it under that name over that file, ",
        ),
      ).toBe(true);
      expect(text).toMatch(/printed code - stays the same/);
      expect(hostReplaceOnComputer(id, "castle.zip", "castle.zip")).toBe(
        hostReplaceOnComputer(id, "castle.zip"),
      );
    }
    // A link that names no file (a Drive link by its id): the name is the
    // creator's to look up.
    expect(
      hostReplaceOnComputer("drive", "tour-1AbC.zip", null).startsWith(
        "Rename tour-1AbC.zip to the name of the file at your tour's link, and upload it under that name over that file, ",
      ),
    ).toBe(true);
  });

  it("speaks of one host only, never the others", () => {
    for (const { id } of TOUR_HOSTS) {
      const text = hostReplaceOnComputer(id, "castle.zip");
      const others = TOUR_HOSTS.filter((h) => h.id !== id && h.id !== "own");
      for (const other of others) expect(text).not.toContain(other.label);
    }
  });

  it("leaves the phone's words as they were", () => {
    expect(hostReplaceText("onedrive")).toBe(
      'Last thing: upload this zip over the one at your link, so the link - and with it the printed code - stays the same. In OneDrive, upload it into the same folder with the same name and choose "Replace".',
    );
  });
});

describe("clearing the stored host", () => {
  // Why: a deselected host (P6) must not come back after a reload.
  it("writeTourHost(store, null) leaves no choice", () => {
    const store = memoryStore();
    writeTourHost(store, "drive");
    writeTourHost(store, null);
    expect(readTourHost(store)).toBeNull();
  });
});

describe("the host's name opens the host (r820 feedback R2)", () => {
  // Why: the owner, at step 1 with Drive chosen, had no way into Drive
  // from the steps that tell them to upload there - "at least Google Drive
  // as a link, opening drive.google.com in a second tab".
  it("links the host's name in the step that sends the creator there", () => {
    expect(hostStepParts("drive")[1]).toEqual([
      { text: "Upload it into a folder of its own in " },
      { text: "Google Drive", href: "https://drive.google.com/" },
      { text: ' (e.g. "My tour").' },
    ]);
  });

  it("gives every cloud host one link to its own site, and an own server none", () => {
    const homes = {
      drive: "https://drive.google.com/",
      dropbox: "https://www.dropbox.com/home",
      onedrive: "https://onedrive.live.com/",
      github: "https://github.com/",
    } as const;
    for (const [host, href] of Object.entries(homes)) {
      const links = hostStepParts(host as keyof typeof homes)
        .flat()
        .filter((part) => part.href !== undefined);
      expect(links, host).toEqual([
        { text: TOUR_HOSTS.find((h) => h.id === host)?.label, href },
      ]);
    }
    expect(
      hostStepParts("own")
        .flat()
        .some((part) => part.href !== undefined),
    ).toBe(false);
  });

  it("says the same words as the plain steps", () => {
    for (const { id } of TOUR_HOSTS) {
      expect(
        hostStepParts(id).map((parts) => parts.map((p) => p.text).join("")),
      ).toEqual([...hostSteps(id)]);
    }
  });
});

describe("hostOfLink (M0c review, finding 5)", () => {
  // Why: whether a missing file is "not uploaded yet" or "a wrong link"
  // depends on where the link points, not on a tile picked once and kept
  // in storage across tours - a stale "Drive" refused an own server's
  // link, and no choice let a wrong Drive link through to printing.
  it("names the cloud host a link points to", () => {
    const cases: [string, string | null][] = [
      ["https://drive.google.com/file/d/abc/view?usp=sharing", "drive"],
      ["https://drive.usercontent.google.com/download?id=abc", "drive"],
      ["https://www.dropbox.com/scl/fi/a/t.zip?rlkey=k&dl=0", "dropbox"],
      ["https://dl.dropboxusercontent.com/scl/fi/a/t.zip", "dropbox"],
      ["https://1drv.ms/u/c/abc/def", "onedrive"],
      ["https://onedrive.live.com/?cid=abc", "onedrive"],
      ["https://github.com/u/r/blob/main/t.zip", "github"],
      ["https://raw.githubusercontent.com/u/r/main/t.zip", "github"],
      ["https://own.example/tour.zip", null],
      ["not a link", null],
    ];
    for (const [link, host] of cases) {
      expect(hostOfLink(link), link).toBe(host);
    }
  });
});
