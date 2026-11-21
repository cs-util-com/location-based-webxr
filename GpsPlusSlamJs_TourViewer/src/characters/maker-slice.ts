/**
 * The character maker page's state: one Redux slice for the one page. It
 * holds the draft (where the author is in the six steps, what they wrote
 * and chose), whether a cut runs or is ready, and the version the previews
 * redraw by. The reducers own the page's rules - which step a tap may open,
 * what a new picture resets, what "Make another" keeps - and a listener
 * keeps the draft in storage. The cut picture itself (canvases and pixel
 * data), the library handle, timers and render caches stay in the page.
 *
 * @see maker-slice.ts.md
 */

import {
  configureStore,
  createListenerMiddleware,
  createSlice,
  type Draft,
  type PayloadAction,
} from "@reduxjs/toolkit";

import {
  CUT_CHOICE_DEFAULTS,
  type BackdropId,
  type CutChoice,
  cutChoiceOf,
  DESC_MAX,
  draftOf,
  freshDraft,
  isBackdropId,
  type MakerDraft,
  reachable,
  type TalkChoice,
} from "./maker-draft.js";

/** `cutting` while a picture is cut, `ready` while a cut is shown. */
type CutStatus = "none" | "cutting" | "ready";

export interface MakerState {
  readonly draft: MakerDraft;
  readonly cut: CutStatus;
  /** Moves on every new cut and talk style, so the previews redraw. */
  readonly version: number;
}

const isStep = (i: unknown): i is number =>
  typeof i === "number" && Number.isInteger(i) && i >= 0 && i <= 5;
const isTime = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

function freshFor(ground: BackdropId): MakerDraft {
  return { ...freshDraft(), ground };
}

/**
 * The state the page starts in, from what storage held: a saved draft
 * starts another character (the backdrop kept), and the check and save
 * steps fall back to step 4, because the cut picture is never stored.
 */
export function makerStateFrom(stored: unknown): MakerState {
  const d = draftOf(stored);
  const draft = d.savedId
    ? freshFor(d.ground)
    : d.step >= 4
      ? { ...d, step: 3 }
      : d;
  return { draft, cut: "none", version: 0 };
}

/** Whether a stored draft comes back without the picture it was at. */
export function asksForPictureAgain(stored: unknown): boolean {
  const d = draftOf(stored);
  return !d.savedId && d.step >= 4;
}

function goTo(s: Draft<MakerState>, i: number): void {
  if (!reachable(s.draft, i, s.cut === "ready")) return;
  s.draft.step = i;
  s.draft.maxStep = Math.max(s.draft.maxStep, Math.min(i, 3));
}

const makerSlice = createSlice({
  name: "characterMaker",
  initialState: makerStateFrom(null),
  reducers: {
    /** A tap on a step: only an open one (steps 0-3 once reached, 4-5 with a cut). */
    went(s, a: PayloadAction<number>) {
      if (isStep(a.payload)) goTo(s, a.payload);
    },
    /** Next, or back from the image AI: opens step `i` (up to 3), then goes there. */
    reached(s, a: PayloadAction<number>) {
      if (!isStep(a.payload)) return;
      s.draft.maxStep = Math.max(s.draft.maxStep, Math.min(a.payload, 3));
      goTo(s, a.payload);
    },
    /**
     * A new description makes an earlier copy of the prompt stale. Kept to
     * `DESC_MAX` characters, as a stored draft is read back.
     */
    descChanged(s, a: PayloadAction<string>) {
      if (typeof a.payload !== "string") return;
      const desc = a.payload.slice(0, DESC_MAX);
      if (desc === s.draft.desc) return;
      s.draft.desc = desc;
      s.draft.copiedAt = 0;
    },
    copied(s, a: PayloadAction<number>) {
      if (isTime(a.payload)) s.draft.copiedAt = a.payload;
    },
    copyRefused(s) {
      s.draft.copiedAt = 0;
    },
    /** A picture brought back: a fresh cut at step 4; ignored while one runs. */
    cutStarted(s) {
      if (s.cut === "cutting") return;
      s.cut = "cutting";
      s.draft.failure = "";
      s.draft.choice = "drawn";
      s.draft.savedId = "";
      s.draft.step = 3;
      s.draft.maxStep = 3;
    },
    cutFinished(s) {
      s.cut = "ready";
      s.version += 1;
    },
    cutFailed(s, a: PayloadAction<string>) {
      s.cut = "none";
      s.draft.failure =
        typeof a.payload === "string" && a.payload
          ? a.payload
          : "Something went wrong";
    },
    /** A newer request replaced the cut. */
    cutAborted(s) {
      if (s.cut === "cutting") s.cut = "none";
    },
    /** "Adjust the cut" cut the same picture again. */
    cutReplaced(s) {
      if (s.cut === "ready") s.version += 1;
    },
    talkChosen(s, a: PayloadAction<TalkChoice>) {
      if (a.payload !== "drawn" && a.payload !== "steady") return;
      s.draft.choice = a.payload;
      s.version += 1;
    },
    groundChosen(s, a: PayloadAction<BackdropId>) {
      if (isBackdropId(a.payload)) s.draft.ground = a.payload;
    },
    /** The sliders' values; one outside its range takes its default. */
    cutChanged(s, a: PayloadAction<CutChoice>) {
      s.draft.cut = cutChoiceOf(a.payload);
    },
    cutReset(s) {
      s.draft.cut = { ...CUT_CHOICE_DEFAULTS };
    },
    named(s, a: PayloadAction<string>) {
      if (typeof a.payload === "string") s.draft.name = a.payload;
    },
    saved(s, a: PayloadAction<{ id: string; name: string }>) {
      s.draft.savedId = a.payload.id;
      s.draft.savedName = a.payload.name;
    },
    /** The page was hidden at `at` (ms), for the welcome-back offer. */
    left(s, a: PayloadAction<number>) {
      if (isTime(a.payload)) s.draft.leftAt = a.payload;
    },
    /**
     * "Make another", "Start over", "Discard": a new character with the
     * backdrop kept. A cut still running keeps running.
     */
    startedAnother(s) {
      s.draft = freshFor(s.draft.ground);
      if (s.cut === "ready") s.cut = "none";
    },
    /** Undo of `startedAnother`: the draft back (read field by field), with its cut. */
    restored(s, a: PayloadAction<{ draft: MakerDraft; hadCut: boolean }>) {
      s.draft = draftOf(a.payload.draft);
      if (s.cut !== "cutting") s.cut = a.payload.hadCut ? "ready" : "none";
    },
  },
});

export const makerActions = makerSlice.actions;
export const makerReducer = makerSlice.reducer;

interface PageState {
  readonly characterMaker: MakerState;
}

export const hasCut = (s: MakerState): boolean => s.cut === "ready";
export const isCutting = (s: MakerState): boolean => s.cut === "cutting";

/**
 * The page's store, started from what storage held. Every change of the
 * draft is handed to `save` once (a listener); a `save` that throws is
 * logged by the listener and never breaks a dispatch.
 */
export function createMakerStore(opts: {
  readonly stored: unknown;
  readonly save: (draft: MakerDraft) => void;
}) {
  const listener = createListenerMiddleware<PageState>({
    onError: (e) => console.warn("the character draft was not kept", e),
  });
  listener.startListening({
    predicate: (_a, now, before) =>
      now.characterMaker.draft !== before.characterMaker.draft,
    effect: (_a, api) => opts.save(api.getState().characterMaker.draft),
  });
  return configureStore({
    reducer: { characterMaker: makerReducer },
    preloadedState: { characterMaker: makerStateFrom(opts.stored) },
    middleware: (gd) => gd().prepend(listener.middleware),
  });
}
