import { describe, expect, it } from "vitest";
import { createPhotoCopies, type PhotoCopy } from "./photo-copy.js";

/**
 * Why these tests matter (the E2b-2 milestone review #3): after every save
 * the card's photos read from a session over the bytes just written, and
 * opening that session starts a whole-archive check that hashes a listed
 * tour's entries again in the background - about 6 s per GiB, and nothing
 * can stop it once it runs. Opened on every autosave, those checks piled up
 * on top of each other. Now at most one runs: the newest written copy waits
 * for it, replacing any copy that was waiting before it.
 */

interface FakeCopy extends PhotoCopy {
  readonly name: string;
  closed: boolean;
  finish: () => void;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function harness(options: { refuse?: (name: string) => boolean } = {}) {
  const opened: string[] = [];
  const copies: FakeCopy[] = [];
  let running = 0;
  let maxRunning = 0;
  const photos = createPhotoCopies<FakeCopy>((file) => {
    opened.push(file.name);
    if (options.refuse?.(file.name) === true) {
      return Promise.reject(new Error("not a readable tour zip"));
    }
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    let finish: () => void = () => undefined;
    const wholeArchiveCheck = new Promise<void>((resolve) => {
      finish = () => {
        running -= 1;
        resolve();
      };
    });
    const copy: FakeCopy = {
      name: file.name,
      closed: false,
      wholeArchiveCheck,
      finish,
      close: () => {
        copy.closed = true;
        return Promise.resolve();
      },
    };
    copies.push(copy);
    return Promise.resolve(copy);
  });
  const file = (name: string): File => new File(["zip"], name);
  return {
    photos,
    opened,
    copies,
    file,
    maxRunning: () => maxRunning,
  };
}

const live = (): boolean => true;

describe("createPhotoCopies", () => {
  it("opens the first written copy at once and reads the photos from it", async () => {
    const h = harness();
    expect(h.photos.current()).toBeNull();
    await h.photos.use(h.file("a.zip"), live);
    expect(h.photos.current()?.name).toBe("a.zip");
  });

  it("while a copy's check runs, the newest copy waits and replaces the one waiting before it", async () => {
    const h = harness();
    await h.photos.use(h.file("a.zip"), live);
    await h.photos.use(h.file("b.zip"), live);
    await h.photos.use(h.file("c.zip"), live);
    await settle();
    // The photos read from the last copy that opened meanwhile.
    expect(h.opened).toEqual(["a.zip"]);
    expect(h.photos.current()?.name).toBe("a.zip");
    h.copies[0]!.finish();
    await settle();
    expect(h.opened).toEqual(["a.zip", "c.zip"]);
    expect(h.photos.current()?.name).toBe("c.zip");
    expect(h.copies[0]!.closed).toBe(true);
    expect(h.maxRunning()).toBe(1);
    // Its check ended too: the next copy opens at once.
    h.copies[1]!.finish();
    await settle();
    await h.photos.use(h.file("d.zip"), live);
    expect(h.photos.current()?.name).toBe("d.zip");
    expect(h.maxRunning()).toBe(1);
  });

  it("a copy waiting for a tour that closed is never opened", async () => {
    const h = harness();
    let open = true;
    await h.photos.use(h.file("a.zip"), () => open);
    await h.photos.use(h.file("b.zip"), () => open);
    open = false;
    h.copies[0]!.finish();
    await settle();
    expect(h.opened).toEqual(["a.zip"]);
  });

  it("a copy that opened after its tour closed is closed, not used", async () => {
    const h = harness();
    let open = true;
    const using = h.photos.use(h.file("a.zip"), () => open);
    open = false;
    await using;
    expect(h.photos.current()).toBeNull();
    expect(h.copies[0]!.closed).toBe(true);
  });

  it("clear closes the current copy and drops the waiting one; the running check is still waited for", async () => {
    const h = harness();
    await h.photos.use(h.file("a.zip"), live);
    await h.photos.use(h.file("b.zip"), live);
    h.photos.clear();
    expect(h.photos.current()).toBeNull();
    expect(h.copies[0]!.closed).toBe(true);
    // The next tour's first copy waits for the check that still runs.
    await h.photos.use(h.file("next.zip"), live);
    expect(h.opened).toEqual(["a.zip"]);
    h.copies[0]!.finish();
    await settle();
    expect(h.opened).toEqual(["a.zip", "next.zip"]);
    expect(h.photos.current()?.name).toBe("next.zip");
    expect(h.maxRunning()).toBe(1);
  });

  it("a copy that does not open keeps the current one, and the next opens", async () => {
    const h = harness({ refuse: (name) => name === "bad.zip" });
    await h.photos.use(h.file("bad.zip"), live);
    expect(h.photos.current()).toBeNull();
    await h.photos.use(h.file("a.zip"), live);
    expect(h.photos.current()?.name).toBe("a.zip");
  });
});
