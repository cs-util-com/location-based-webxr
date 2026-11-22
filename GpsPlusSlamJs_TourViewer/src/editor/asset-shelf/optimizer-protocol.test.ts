/**
 * Why these tests matter: the Worker takes messages from whatever posts to
 * it, and its sidecar promises that a non-object or an unknown message is
 * ignored rather than thrown on (a throw in the Worker's message handler
 * would surface as its error event, which the page reads as a crash and
 * retries). `inboundOf` is that promise, kept pure so it can be tested
 * without a Worker.
 */
import { describe, expect, it } from "vitest";

import {
  inboundOf,
  type OptimizerOutbound,
  serveSteps,
  stoppedError,
} from "./optimizer-protocol.js";
import { OPTIMIZER_SETTINGS } from "./optimizer-settings.js";

describe("inboundOf: what the Worker takes", () => {
  it("takes a run and a cancel of the protocol", () => {
    const run = {
      type: "run",
      job: 1,
      kind: "image",
      payload: new Blob(["x"]),
      settings: OPTIMIZER_SETTINGS,
    };
    expect(inboundOf(run)).toBe(run);
    expect(inboundOf({ type: "cancel", job: 2 })).toEqual({
      type: "cancel",
      job: 2,
    });
  });

  it.each([
    ["null", null],
    ["a string", "run"],
    ["a number", 3],
    ["an unknown type", { type: "nonsense", job: 1 }],
    ["no job", { type: "cancel" }],
    ["a job that is no whole number", { type: "cancel", job: 1.5 }],
    [
      "an unknown kind",
      { type: "run", job: 1, kind: "text", settings: OPTIMIZER_SETTINGS },
    ],
    ["no settings", { type: "run", job: 1, kind: "image", settings: null }],
  ])("ignores %s", (_what, data) => {
    expect(inboundOf(data)).toBeNull();
  });
});

/**
 * Why these tests matter: the optimizer and the model converter run the
 * same message loop in two Workers. It must post each answer with its job,
 * forward progress, post nothing once a run was stopped (the page has
 * settled it already), turn a throw into "failed" with its words, answer
 * a kind without a step in words, and ignore what is no message of the
 * protocol rather than throw (a throw there reads as a crash).
 */
describe("serveSteps: the Worker loop", () => {
  function fakeScope() {
    const posted: OptimizerOutbound[] = [];
    let listener: ((event: MessageEvent) => void) | null = null;
    return {
      posted,
      scope: {
        postMessage: (message: OptimizerOutbound) => {
          posted.push(message);
        },
        addEventListener: (
          _type: "message",
          l: (event: MessageEvent) => void,
        ) => {
          listener = l;
        },
      },
      send: (data: unknown) => listener?.({ data } as MessageEvent),
    };
  }
  const run = (job: number, kind = "model") => ({
    type: "run",
    job,
    kind,
    payload: job,
    settings: OPTIMIZER_SETTINGS,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("answers a run with its job, forwards progress, and fails a throw in words", async () => {
    const { posted, scope, send } = fakeScope();
    serveSteps(scope, {
      model: (payload, _settings, control) => {
        control.progress(0.5);
        if (payload === 2) return Promise.reject(new Error("no good"));
        return Promise.resolve({ type: "kept", reason: "small" });
      },
    });
    send(run(1));
    send(run(2));
    send("nonsense");
    send(run(3, "audio"));
    await flush();
    expect(posted).toEqual([
      { type: "progress", job: 1, fraction: 0.5 },
      { type: "progress", job: 2, fraction: 0.5 },
      {
        type: "failed",
        job: 3,
        reason: "This kind of file cannot be made smaller yet (audio).",
      },
      { type: "kept", reason: "small", job: 1 },
      { type: "failed", job: 2, reason: "no good" },
    ]);
  });

  it("posts nothing for a run that was stopped, and the step sees the stop", async () => {
    const { posted, scope, send } = fakeScope();
    const seen: AbortSignal[] = [];
    serveSteps(scope, {
      model: (_payload, _settings, control) => {
        seen.push(control.signal);
        return new Promise((_resolve, reject) => {
          control.signal.addEventListener("abort", () =>
            reject(stoppedError()),
          );
        });
      },
    });
    send(run(7));
    send({ type: "cancel", job: 7 });
    await flush();
    expect(seen.map((s) => s.aborted)).toEqual([true]);
    expect(posted).toEqual([]);
  });
});
