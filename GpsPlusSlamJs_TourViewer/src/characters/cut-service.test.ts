import { describe, expect, it } from "vitest";

import type { CutAnswer } from "./cut-protocol.js";
import { createCutService, type PictureDecoder } from "./cut-service.js";
import { CutError } from "./sheet-cut.js";
import { syntheticSheet } from "./test-support/synthetic-sheet.js";

const picture = new Blob(["x"], { type: "image/png" });

function setup(decode: PictureDecoder) {
  const posted: { answer: CutAnswer; transfer: ArrayBuffer[] }[] = [];
  const handle = createCutService(decode, (answer, transfer) => {
    posted.push({ answer, transfer });
  });
  return { posted, handle };
}

const sheetDecoder: PictureDecoder = () =>
  Promise.resolve(syntheticSheet({ width: 800, height: 520, noise: 2 }).image);

// Why these tests matter: the Worker is the only place the cut runs in the
// app; it must answer every request exactly once (done or failed), report
// the phases in order, keep the decoded picture for a slider's re-cut, and
// transfer the frames instead of copying them.
describe("createCutService", () => {
  it("decodes, cuts and answers once with the frames transferred", async () => {
    const { posted, handle } = setup(sheetDecoder);
    await handle({ type: "cut", job: 3, picture, settings: {} });
    const last = posted.at(-1)!;
    expect(last.answer).toMatchObject({ type: "done", job: 3 });
    expect(last.transfer).toHaveLength(6);
    expect(posted.filter((p) => p.answer.type !== "phase")).toHaveLength(1);
    expect(posted[0]!.answer).toMatchObject({
      phase: "read",
      state: "running",
    });
    expect(posted[1]!.answer).toMatchObject({
      phase: "read",
      state: "done",
      note: "800 x 520",
    });
  });

  it("re-cuts the kept picture without decoding it again", async () => {
    let decodes = 0;
    const { posted, handle } = setup((file, s) => {
      decodes++;
      return sheetDecoder(file, s);
    });
    await handle({ type: "cut", job: 1, picture, settings: {} });
    await handle({ type: "cut", job: 2, settings: { whiteTol: 20 } });
    expect(decodes).toBe(1);
    expect(posted.at(-1)!.answer).toMatchObject({ type: "done", job: 2 });
  });

  it("asks for a picture when a re-cut comes first", async () => {
    const { posted, handle } = setup(sheetDecoder);
    await handle({ type: "cut", job: 1, settings: {} });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.answer).toMatchObject({
      type: "failed",
      phase: "read",
      message: "Choose a picture first.",
    });
  });

  it("passes a decoder's refusal on with its phase and code", async () => {
    const { posted, handle } = setup(() =>
      Promise.reject(new CutError("read", "too-big", "Too big.")),
    );
    await handle({ type: "cut", job: 4, picture, settings: {} });
    expect(posted.at(-1)!.answer).toMatchObject({
      type: "failed",
      job: 4,
      phase: "read",
      code: "too-big",
    });
  });

  it("reports an unexpected error in the phase that was running", async () => {
    const { posted, handle } = setup(() =>
      Promise.reject(new Error("out of memory")),
    );
    await handle({ type: "cut", job: 5, picture, settings: {} });
    expect(posted.at(-1)!.answer).toMatchObject({
      type: "failed",
      phase: "read",
      code: "failed",
      message: "out of memory",
    });
  });

  it("forgets a picture whose decoding failed", async () => {
    // A slider must not silently re-cut the previous picture after the
    // author chose a new one that would not open.
    let calls = 0;
    const { posted, handle } = setup((file, s) =>
      ++calls === 1
        ? sheetDecoder(file, s)
        : Promise.reject(new Error("broken")),
    );
    await handle({ type: "cut", job: 1, picture, settings: {} });
    await handle({ type: "cut", job: 2, picture, settings: {} });
    await handle({ type: "cut", job: 3, settings: {} });
    expect(posted.at(-1)!.answer).toMatchObject({
      type: "failed",
      job: 3,
      message: "Choose a picture first.",
    });
  });

  it("ignores a message that is no request", async () => {
    const { posted, handle } = setup(sheetDecoder);
    await handle({ type: "hello" });
    expect(posted).toEqual([]);
  });
});
