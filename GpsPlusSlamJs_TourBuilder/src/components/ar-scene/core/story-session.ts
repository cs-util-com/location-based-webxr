/**
 * Story session — one story at a time, globally (plan A13).
 *
 * The audio never auto-plays; it starts only when the visitor taps a visible
 * knight (TASK §2.3.4). But two knights can be a few metres apart, so without a
 * rule the tour becomes two overlapping voices. This reducer is that rule:
 *
 * - tapping a **different** knight stops the current story and starts the new one,
 * - tapping the **playing** knight toggles pause/resume (not a restart — comp 1's
 *   transport reducer already owns position),
 * - walking away (the waypoint leaving ACTIVE) stops the story outright,
 * - the story ending clears the session.
 *
 * Pure: it returns the commands to run, so the view layer stays a dumb executor
 * and every policy question above is a unit test.
 *
 * @see plans/2026-07-31-ar-scene-plan.md §6
 */

export interface StorySessionState {
  /** The waypoint whose story is loaded, or `null` when nothing is playing. */
  readonly playingId: string | null;
  readonly paused: boolean;
}

export type StoryCommand =
  /** Stop and unload the current story, hide its transcript. */
  | { readonly kind: "stop"; readonly id: string }
  /** Begin this waypoint's story (fetch audio lazily, show the transcript). */
  | { readonly kind: "start"; readonly id: string }
  | { readonly kind: "pause"; readonly id: string }
  | { readonly kind: "resume"; readonly id: string };

export interface StorySessionResult {
  readonly state: StorySessionState;
  readonly commands: readonly StoryCommand[];
}

export function initialStorySession(): StorySessionState {
  return { playingId: null, paused: false };
}

/** The visitor tapped a knight that is currently ACTIVE. */
export function tapWaypoint(
  state: StorySessionState,
  id: string,
): StorySessionResult {
  if (state.playingId === id) {
    const paused = !state.paused;
    return {
      state: { playingId: id, paused },
      commands: [{ kind: paused ? "pause" : "resume", id }],
    };
  }

  const commands: StoryCommand[] = [];
  if (state.playingId !== null) {
    commands.push({ kind: "stop", id: state.playingId });
  }
  commands.push({ kind: "start", id });
  return { state: { playingId: id, paused: false }, commands };
}

/**
 * A waypoint left ACTIVE. Stops the story if it was that waypoint's — the
 * visitor has physically walked away from the knight that was talking.
 */
export function leaveActive(
  state: StorySessionState,
  id: string,
): StorySessionResult {
  if (state.playingId !== id) return { state, commands: [] };
  return {
    state: initialStorySession(),
    commands: [{ kind: "stop", id }],
  };
}

/** The audio element reached its end on its own. */
export function storyEnded(state: StorySessionState): StorySessionResult {
  if (state.playingId === null) return { state, commands: [] };
  return {
    state: initialStorySession(),
    commands: [{ kind: "stop", id: state.playingId }],
  };
}

/** Teardown / tour change: stop whatever is playing. */
export function stopAll(state: StorySessionState): StorySessionResult {
  return storyEnded(state);
}
