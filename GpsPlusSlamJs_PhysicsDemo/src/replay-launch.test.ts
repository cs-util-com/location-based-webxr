/**
 * Tests for the replay launch flow.
 *
 * Why this test matters:
 * Loading a recording is the demo's core async action (read the zip, build the
 * scene, drive the engine). Per the repo's async-feedback rule the UI must move
 * to an in-progress state and then to a durable ready/error state on BOTH the
 * success and failure paths — pinned here at the orchestration level (the DOM
 * wiring in main.ts is covered by the e2e smoke). `loadRecordingActions` maps the
 * zip entries to a bare action list (the shape startReplaySession expects).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("gps-plus-slam-app-framework/storage/zip-reader", () => ({
  loadActionsFromZip: vi.fn(),
}));

import { loadActionsFromZip } from "gps-plus-slam-app-framework/storage/zip-reader";
import {
  loadRecordingActions,
  loadAndStartReplay,
  type ReplayLaunchSink,
  type ReplayLaunchDeps,
} from "./replay-launch";

function makeSink(): ReplayLaunchSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onLoading: vi.fn(() => void calls.push("loading")),
    onReady: vi.fn(() => void calls.push("ready")),
    onError: vi.fn(() => void calls.push("error")),
  };
}

const fakeFile = {
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
} as File;

describe("loadRecordingActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps zip entries to their bare actions", async () => {
    const a1 = { type: "x" };
    const a2 = { type: "y" };
    vi.mocked(loadActionsFromZip).mockResolvedValue([
      { action: a1 },
      { action: a2 },
    ] as never);

    const actions = await loadRecordingActions(fakeFile);

    expect(actions).toEqual([a1, a2]);
  });
});

describe("loadAndStartReplay", () => {
  const controller = { getActionCount: () => 2 } as never;

  function deps(over: Partial<ReplayLaunchDeps> = {}): ReplayLaunchDeps {
    return {
      loadActions: vi.fn().mockResolvedValue([{ type: "a" }, { type: "b" }]),
      startSession: vi.fn().mockReturnValue(controller),
      ...over,
    };
  }

  it("drives loading → ready and returns the controller on success", async () => {
    const sink = makeSink();
    const d = deps();
    const container = {} as HTMLElement;

    const result = await loadAndStartReplay(fakeFile, container, sink, d);

    expect(result).toBe(controller);
    // In-progress state reached BEFORE the durable ready state.
    expect(sink.calls).toEqual(["loading", "ready"]);
    expect(sink.onReady).toHaveBeenCalledWith(controller, 2);
    expect(d.startSession).toHaveBeenCalledWith(
      [{ type: "a" }, { type: "b" }],
      container,
    );
  });

  it("drives loading → error (and returns null) when the load throws", async () => {
    const sink = makeSink();
    const d = deps({
      loadActions: vi.fn().mockRejectedValue(new Error("bad zip")),
    });

    const result = await loadAndStartReplay(
      fakeFile,
      {} as HTMLElement,
      sink,
      d,
    );

    expect(result).toBeNull();
    // The in-progress state was reached and then reverted to a durable error.
    expect(sink.calls).toEqual(["loading", "error"]);
    expect(sink.onError).toHaveBeenCalledWith("bad zip");
    expect(d.startSession).not.toHaveBeenCalled();
  });

  it("reports an error (not a crash) for an empty recording", async () => {
    const sink = makeSink();
    const d = deps({ loadActions: vi.fn().mockResolvedValue([]) });

    const result = await loadAndStartReplay(
      fakeFile,
      {} as HTMLElement,
      sink,
      d,
    );

    expect(result).toBeNull();
    expect(sink.calls).toEqual(["loading", "error"]);
    expect(d.startSession).not.toHaveBeenCalled();
  });
});
