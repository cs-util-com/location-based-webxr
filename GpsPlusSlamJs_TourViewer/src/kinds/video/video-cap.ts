/**
 * The play cap of free videos (station blocks design §6): at most
 * `VIDEO_PLAY_CAP` play at once, and at most one with its sound. The
 * first to start play; a later start waits, in the order it asked, until
 * one of them stops (paused, left, ended, gone). The newest start with
 * sound takes the sound, and the one heard before is muted where it is.
 *
 * `capStep` is the rule, pure; `videoCap` is the page's cap, which keeps
 * the rule's state and tells each video (a seat) when it may play or has
 * lost its sound.
 *
 * @see video-cap.ts.md
 */

/** How many free videos play at once: a guess at what a mid-range phone
 *  decodes smoothly (design §6). One stuttering pair on a phone would
 *  lower it to one. */
export const VIDEO_PLAY_CAP = 2;

/** Who plays (in the order they were let), who waits (in the order they
 *  asked), and who is heard (one that plays, or none). */
export interface CapState {
  readonly playing: readonly string[];
  readonly waiting: readonly string[];
  readonly audible: string | null;
}

/** Nobody plays, waits or is heard. */
export const EMPTY_CAP: CapState = { playing: [], waiting: [], audible: null };

/** What a video tells the cap: it wants to play (`ask`), it stopped
 *  playing or waiting (`leave`), it plays with its sound now (`heard`),
 *  its sound went off (`quiet`). */
export interface CapAction {
  readonly type: "ask" | "leave" | "heard" | "quiet";
  readonly id: string;
}

/** The state after an action, who may play now that did not before
 *  (`granted`), and who lost its sound (`muted`). */
export interface CapStepResult {
  readonly state: CapState;
  readonly granted: readonly string[];
  readonly muted: readonly string[];
}

/** `limit` as a whole number of at least one (anything else: one). */
function safeLimit(limit: number): number {
  return Number.isInteger(limit) && limit >= 1 ? limit : 1;
}

/**
 * The rule. `ask`: one that plays keeps playing, one that waits keeps
 * its place; else it plays when a place is free, or waits last in line.
 * `leave`: out of both lists and no longer heard; each freed place goes
 * to the first that waits. `heard`: one that plays becomes the one heard,
 * and the one heard before is muted; one that does not play is ignored.
 * `quiet`: the one heard is heard no more.
 */
export function capStep(
  state: CapState,
  action: CapAction,
  limit: number = VIDEO_PLAY_CAP,
): CapStepResult {
  const max = safeLimit(limit);
  const { id } = action;
  const none = { state, granted: [], muted: [] };
  switch (action.type) {
    case "ask": {
      if (state.playing.includes(id) || state.waiting.includes(id)) {
        return none;
      }
      if (state.playing.length < max) {
        return {
          state: { ...state, playing: [...state.playing, id] },
          granted: [id],
          muted: [],
        };
      }
      return {
        state: { ...state, waiting: [...state.waiting, id] },
        granted: [],
        muted: [],
      };
    }
    case "leave": {
      const playing = state.playing.filter((p) => p !== id);
      const waiting = state.waiting.filter((w) => w !== id);
      const granted = waiting.splice(0, Math.max(0, max - playing.length));
      return {
        state: {
          playing: [...playing, ...granted],
          waiting,
          audible: state.audible === id ? null : state.audible,
        },
        granted,
        muted: [],
      };
    }
    case "heard": {
      if (!state.playing.includes(id) || state.audible === id) return none;
      return {
        state: { ...state, audible: id },
        granted: [],
        muted: state.audible === null ? [] : [state.audible],
      };
    }
    case "quiet":
      return state.audible === id
        ? { state: { ...state, audible: null }, granted: [], muted: [] }
        : none;
  }
}

/** A video as the cap sees it: told when it may play after waiting, and
 *  when another took its sound. */
export interface CapSeat {
  granted(): void;
  muted(): void;
}

/** The page's cap: each call is one `capStep`, its state kept before any
 *  seat is called back, so a seat may call the cap again from inside. */
export interface VideoCap {
  /** True: it may play now (or plays already). False: it waits, and its
   *  `granted` is called once it may. */
  ask(seat: CapSeat): boolean;
  /** It stopped playing or waiting; asking again starts a new turn. */
  leave(seat: CapSeat): void;
  /** It plays with its sound now; the one heard before is muted. */
  heard(seat: CapSeat): void;
  /** Its sound went off. */
  quiet(seat: CapSeat): void;
}

/** A cap of `limit` places (default `VIDEO_PLAY_CAP`). */
export function videoCap(limit: number = VIDEO_PLAY_CAP): VideoCap {
  let state = EMPTY_CAP;
  const ids = new Map<CapSeat, string>();
  const seats = new Map<string, CapSeat>();
  let next = 0;
  const idOf = (seat: CapSeat): string => {
    let id = ids.get(seat);
    if (id === undefined) {
      id = `seat-${String(next++)}`;
      ids.set(seat, id);
      seats.set(id, seat);
    }
    return id;
  };
  const run = (type: CapAction["type"], seat: CapSeat): void => {
    const id = idOf(seat);
    const step = capStep(state, { type, id }, limit);
    state = step.state;
    // A seat that neither plays nor waits is forgotten, so a page that
    // builds and frees videos for hours keeps no list of the gone.
    if (!state.playing.includes(id) && !state.waiting.includes(id)) {
      ids.delete(seat);
      seats.delete(id);
    }
    for (const m of step.muted) seats.get(m)?.muted();
    for (const g of step.granted) {
      if (g !== id) seats.get(g)?.granted();
    }
  };
  return {
    ask(seat) {
      run("ask", seat);
      return state.playing.includes(idOf(seat));
    },
    leave: (seat) => {
      run("leave", seat);
    },
    heard: (seat) => {
      run("heard", seat);
    },
    quiet: (seat) => {
      run("quiet", seat);
    },
  };
}
