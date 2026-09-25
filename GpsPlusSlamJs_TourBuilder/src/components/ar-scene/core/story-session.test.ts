import { describe, expect, it } from "vitest";

import {
  initialStorySession,
  leaveActive,
  stopAll,
  storyEnded,
  tapWaypoint,
} from "./story-session.js";

describe("tapping a knight", () => {
  it("starts its story when nothing is playing", () => {
    const { state, commands } = tapWaypoint(initialStorySession(), "wp-1");
    expect(commands).toEqual([{ kind: "start", id: "wp-1" }]);
    expect(state).toEqual({ playingId: "wp-1", paused: false });
  });

  it("stops the current story before starting another — one voice at a time", () => {
    const playing = tapWaypoint(initialStorySession(), "wp-1").state;
    const { state, commands } = tapWaypoint(playing, "wp-2");
    expect(commands).toEqual([
      { kind: "stop", id: "wp-1" },
      { kind: "start", id: "wp-2" },
    ]);
    expect(state.playingId).toBe("wp-2");
  });

  it("toggles pause on the knight that is already playing, not a restart", () => {
    const playing = tapWaypoint(initialStorySession(), "wp-1").state;
    const paused = tapWaypoint(playing, "wp-1");
    expect(paused.commands).toEqual([{ kind: "pause", id: "wp-1" }]);
    expect(paused.state.paused).toBe(true);

    const resumed = tapWaypoint(paused.state, "wp-1");
    expect(resumed.commands).toEqual([{ kind: "resume", id: "wp-1" }]);
    expect(resumed.state.paused).toBe(false);
  });

  it("switching away from a paused story still stops it", () => {
    const playing = tapWaypoint(initialStorySession(), "wp-1").state;
    const paused = tapWaypoint(playing, "wp-1").state;
    const { commands } = tapWaypoint(paused, "wp-2");
    expect(commands[0]).toEqual({ kind: "stop", id: "wp-1" });
  });
});

describe("walking away", () => {
  it("stops the story when its own waypoint leaves ACTIVE", () => {
    const playing = tapWaypoint(initialStorySession(), "wp-1").state;
    const { state, commands } = leaveActive(playing, "wp-1");
    expect(commands).toEqual([{ kind: "stop", id: "wp-1" }]);
    expect(state.playingId).toBeNull();
  });

  it("ignores another waypoint leaving ACTIVE", () => {
    const playing = tapWaypoint(initialStorySession(), "wp-1").state;
    const { state, commands } = leaveActive(playing, "wp-2");
    expect(commands).toEqual([]);
    expect(state.playingId).toBe("wp-1");
  });

  it("is a no-op when nothing is playing", () => {
    expect(leaveActive(initialStorySession(), "wp-1").commands).toEqual([]);
  });
});

describe("ending and teardown", () => {
  it("clears the session when the audio finishes", () => {
    const playing = tapWaypoint(initialStorySession(), "wp-1").state;
    const { state, commands } = storyEnded(playing);
    expect(commands).toEqual([{ kind: "stop", id: "wp-1" }]);
    expect(state).toEqual(initialStorySession());
  });

  it("stopAll is a no-op on an idle session", () => {
    expect(stopAll(initialStorySession())).toEqual({
      state: initialStorySession(),
      commands: [],
    });
  });

  it("stopAll stops whatever is playing", () => {
    const playing = tapWaypoint(initialStorySession(), "wp-9").state;
    expect(stopAll(playing).commands).toEqual([{ kind: "stop", id: "wp-9" }]);
  });
});
