import { describe, expect, it } from "vitest";

import { createCutClient, CutFailed, type CutWorker } from "./cut-client.js";
import type { CutRequest } from "./cut-protocol.js";
import { blankImage } from "./rgba-image.js";
import type { SheetAnalysis } from "./sheet-analyze.js";

class FakeWorker implements CutWorker {
  sent: CutRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  postMessage(message: CutRequest): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
  crash(): void {
    this.onerror?.(new Event("error"));
  }
}

function result(): SheetAnalysis {
  const frames = [0, 1, 2, 3].map(() => blankImage(4, 8));
  return {
    frames,
    steadyFrames: frames,
    check: {} as SheetAnalysis["check"],
    mode: "white",
    gaps: [1, 2, 3],
    size: { w: 10, h: 10 },
    specks: 0,
  };
}

function setup() {
  const workers: FakeWorker[] = [];
  const client = createCutClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
  return { client, workers };
}

const pic = (name: string) => new Blob([name], { type: "image/png" });

// Why these tests matter: the maker's sliders fire many re-cuts while a
// picture's cut may still be running; only the newest may run next, a
// picture must never be lost to a slider, and a crashed Worker must not
// leave the page waiting.
describe("createCutClient", () => {
  it("sends a cut, forwards phases and resolves with the result", async () => {
    const { client, workers } = setup();
    const phases: string[] = [];
    const p = client.cut(pic("a"), { whiteTol: 30 }, (phase, state) =>
      phases.push(`${phase}:${state}`),
    );
    const w = workers[0]!;
    expect(w.sent[0]).toMatchObject({
      type: "cut",
      job: 1,
      settings: { whiteTol: 30 },
    });
    expect(w.sent[0]!.picture).toBeInstanceOf(Blob);
    w.answer({ type: "phase", job: 1, phase: "poses", state: "running" });
    w.answer({ type: "done", job: 1, result: result() });
    await expect(p).resolves.toMatchObject({ mode: "white" });
    expect(phases).toEqual(["poses:running"]);
  });

  it("rejects with the Worker's refusal", async () => {
    const { client, workers } = setup();
    const p = client.cut(pic("a"), {});
    workers[0]!.answer({
      type: "failed",
      job: 1,
      phase: "poses",
      code: "joined",
      message: "two poses touch",
      detail: {},
    });
    await expect(p).rejects.toMatchObject({
      name: "CutFailed",
      phase: "poses",
      code: "joined",
    });
  });

  it("runs one cut at a time, the newest waiting one replacing older ones", async () => {
    const { client, workers } = setup();
    const first = client.cut(pic("a"), {});
    const second = client.cut(null, { whiteTol: 10 });
    const third = client.cut(null, { whiteTol: 20 });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    const w = workers[0]!;
    expect(w.sent).toHaveLength(1);
    w.answer({ type: "done", job: 1, result: result() });
    await first;
    expect(w.sent).toHaveLength(2);
    expect(w.sent[1]).toMatchObject({ job: 2, settings: { whiteTol: 20 } });
    expect(w.sent[1]!.picture).toBeUndefined();
    w.answer({ type: "done", job: 2, result: result() });
    await expect(third).resolves.toBeDefined();
  });

  it("carries a replaced request's new picture over to the one replacing it", async () => {
    const { client, workers } = setup();
    const first = client.cut(pic("a"), {});
    const replaced = client.cut(pic("b"), {});
    const slider = client.cut(null, { whiteTol: 12 });
    await expect(replaced).rejects.toMatchObject({ name: "AbortError" });
    const w = workers[0]!;
    w.answer({ type: "done", job: 1, result: result() });
    await first;
    expect(await w.sent[1]!.picture!.text()).toBe("b");
    w.answer({ type: "done", job: 2, result: result() });
    await expect(slider).resolves.toBeDefined();
  });

  it("ignores answers of another job and answers that do not read", async () => {
    const { client, workers } = setup();
    const p = client.cut(pic("a"), {});
    const w = workers[0]!;
    w.answer({ type: "done", job: 99, result: result() });
    w.answer("noise");
    w.answer({ type: "done", job: 1, result: result() });
    await expect(p).resolves.toBeDefined();
  });

  it("rejects held cuts on a crash and sends the last picture to the next Worker", async () => {
    const { client, workers } = setup();
    const p = client.cut(pic("a"), {});
    workers[0]!.crash();
    await expect(p).rejects.toBeInstanceOf(CutFailed);
    await expect(p).rejects.toMatchObject({ code: "crashed" });
    expect(workers[0]!.terminated).toBe(true);
    void client.cut(null, { whiteTol: 15 }).catch(() => {});
    expect(workers).toHaveLength(2);
    expect(await workers[1]!.sent[0]!.picture!.text()).toBe("a");
  });

  it("close rejects every held cut as aborted and ends the Worker", async () => {
    const { client, workers } = setup();
    const running = client.cut(pic("a"), {});
    const waiting = client.cut(null, {});
    client.close();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(workers[0]!.terminated).toBe(true);
  });

  it("rejects when the Worker cannot be made", async () => {
    const client = createCutClient(() => {
      throw new Error("no workers here");
    });
    await expect(client.cut(pic("a"), {})).rejects.toThrow("no workers here");
  });
});
