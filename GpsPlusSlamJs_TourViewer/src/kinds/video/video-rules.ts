/**
 * A free video's rules, kept apart from its drawing (pure): the width it
 * first takes, when the creator's trigger starts it, when the visitor is
 * there (a reach with a margin, so one at its edge does not flicker it),
 * what a start, a leave, a return, a tap and its end do to its playing,
 * whether it starts with its sound, and the visitor's own sound choice in
 * the visitor's stored preferences. No three.js and no page: the world
 * part (`video-world.ts`) drives these.
 *
 * @see video-rules.ts.md
 */

import type { TourVideoBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";

import { prefsRoot } from "../../visitor-prefs.js";

/** How a video starts: the format's `start` values. */
type TourVideoStart = NonNullable<TourVideoBlock["start"]>;

/** A video's width in the world (m) when it first stands there - a new
 *  video from a file, or a story's card moved out of its story: about a
 *  person's shoulders twice over, readable from across a small station. */
export const VIDEO_DEFAULT_WIDTH_M = 1.6;

/** A `near` start's distance when the block names none (m). */
export const VIDEO_DEFAULT_WITHIN_M = 6;

/** How far the visitor may go from a video that starts on entering, on a
 *  look or on a tap before it counts as left (m): a station's reach. */
export const VIDEO_AWAY_M = 25;

/** How much farther than its reach the visitor must go to leave (m): a
 *  visitor standing at the edge does not pause and resume it at every
 *  step of the position's noise. */
export const VIDEO_MARGIN_M = 2;

/** A `look` start: the video's centre within this angle of the middle of
 *  the view (degrees), held for `VIDEO_LOOK_DWELL_S`. */
export const VIDEO_LOOK_DEG = 15;
export const VIDEO_LOOK_DWELL_S = 0.6;

/** How long a start with sound waits for the browser to play it before
 *  the visitor is told the sound stayed off (ms). */
export const VIDEO_SOUND_REFUSED_MS = 1000;

/** The block's start trigger (absent: `enter`). */
export function videoStartOf(
  block: Pick<TourVideoBlock, "start">,
): TourVideoStart {
  return block.start ?? "enter";
}

/** How near the visitor must come to be "there" (m): a `near` start's
 *  distance, else the station's reach. */
export function videoReachM(
  block: Pick<TourVideoBlock, "start" | "withinM">,
): number {
  return videoStartOf(block) === "near"
    ? (block.withinM ?? VIDEO_DEFAULT_WITHIN_M)
    : VIDEO_AWAY_M;
}

/**
 * Whether the visitor, `distanceM` from the video, is there: within
 * `reachM` to come, beyond `reachM + VIDEO_MARGIN_M` to go, between them
 * as `was`. A distance that is no number keeps `was`.
 */
export function videoThere(
  distanceM: number,
  reachM: number,
  was: boolean,
): boolean {
  if (!Number.isFinite(distanceM)) return was;
  if (distanceM <= reachM) return true;
  if (distanceM > reachM + VIDEO_MARGIN_M) return false;
  return was;
}

/** The look's dwell after a frame of `dtS` seconds with the video's
 *  centre `offDeg` from the view's middle: grows while within
 *  `VIDEO_LOOK_DEG`, back to 0 outside. A step or angle that is no number
 *  counts as no step and as outside. */
export function lookDwell(dwellS: number, offDeg: number, dtS: number): number {
  if (!(offDeg < VIDEO_LOOK_DEG)) return 0;
  const step = Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
  return (Number.isFinite(dwellS) ? dwellS : 0) + step;
}

/** Whether the creator's trigger fires now: `enter` once there, `near`
 *  once there (its reach is the distance), `look` once the dwell is held,
 *  `tap` never (the visitor's tap starts it). */
export function startFires(
  start: TourVideoStart,
  there: boolean,
  dwellS: number,
): boolean {
  if (!there) return false;
  switch (start) {
    case "enter":
    case "near":
      return true;
    case "look":
      return dwellS >= VIDEO_LOOK_DWELL_S;
    case "tap":
      return false;
  }
}

/** Where a video is: not started yet, playing, paused because the visitor
 *  left, paused by the visitor's tap, or played to its end. */
export type VideoState = "waiting" | "playing" | "held" | "paused" | "finished";

/** What happens to it: its trigger fired, the visitor left or came back,
 *  tapped it, or it reached its end. */
export type VideoEvent = "start" | "leave" | "return" | "tap" | "ended";

/** What the player does: nothing, play from the start, carry on where it
 *  stopped, pause, or play again from the start. */
export type VideoAction = "none" | "play" | "resume" | "pause" | "replay";

/**
 * The playing rule. The trigger starts it once; a tap starts it whatever
 * the trigger. Leaving pauses it and coming back resumes it; the visitor's
 * own pause holds through a leave and a return. A finished video stays
 * finished - no trigger, leave or return plays it again - and a tap
 * replays it from the start.
 */
export function videoStep(
  state: VideoState,
  event: VideoEvent,
): { readonly state: VideoState; readonly action: VideoAction } {
  const stay = { state, action: "none" } as const;
  switch (state) {
    case "waiting":
      return event === "start" || event === "tap"
        ? { state: "playing", action: "play" }
        : stay;
    case "playing":
      if (event === "leave") return { state: "held", action: "pause" };
      if (event === "tap") return { state: "paused", action: "pause" };
      if (event === "ended") return { state: "finished", action: "none" };
      return stay;
    case "held":
      if (event === "return") return { state: "playing", action: "resume" };
      // Paused already: the visitor's tap keeps it paused by his choice.
      if (event === "tap") return { state: "paused", action: "none" };
      return stay;
    case "paused":
      return event === "tap" ? { state: "playing", action: "resume" } : stay;
    case "finished":
      return event === "tap" ? { state: "playing", action: "replay" } : stay;
  }
}

/** Sound on or off. */
export type VideoSound = "on" | "off";

/**
 * Whether a video starts with its sound: the visitor's own stored choice,
 * else the creator's, else off - and on only after the visitor has
 * touched the page (`activated`), since a browser refuses sound before
 * that. `blocked`: wanted on, but started muted for that reason (the
 * visitor's next tap turns it on).
 */
export function decideStartSound(input: {
  readonly chosen: VideoSound | null;
  readonly creator: VideoSound | undefined;
  readonly activated: boolean;
}): { readonly sound: boolean; readonly blocked: boolean } {
  const want = (input.chosen ?? input.creator ?? "off") === "on";
  if (want && !input.activated) return { sound: false, blocked: true };
  return { sound: want, blocked: false };
}

/** The key of the visitor's sound choice in the stored preferences. */
const SOUND_KEY = "videoSound";

/** The visitor's stored sound choice for every video; null when he never
 *  chose or the stored value is not one. */
export function videoSoundChoice(stored: unknown): VideoSound | null {
  const value = prefsRoot(stored)[SOUND_KEY];
  return value === "on" || value === "off" ? value : null;
}

/** A new stored value with the sound choice set (null: cleared); every
 *  other key kept, `stored` not changed. */
export function withVideoSound(
  stored: unknown,
  choice: VideoSound | null,
): Record<string, unknown> {
  const root = { ...prefsRoot(stored) };
  if (choice === null) delete root[SOUND_KEY];
  else root[SOUND_KEY] = choice;
  return root;
}

/** The line that tells the visitor how it starts, while it waits: a tap
 *  start asks for a tap, a `near` start says how far to come; none
 *  otherwise. */
export function videoHint(
  start: TourVideoStart,
  state: VideoState,
  distanceM: number,
  reachM: number,
): string | null {
  if (state !== "waiting") return null;
  if (start === "tap") return "Tap the video to play";
  if (start === "near" && Number.isFinite(distanceM) && distanceM > reachM) {
    return `Walk closer to start · ${String(Math.max(1, Math.round(distanceM - reachM)))} m`;
  }
  return null;
}
