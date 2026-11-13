/**
 * A free video's card on the page's screen (`WorldEnv.screen`), open while
 * the visitor is at the video: its title, what it does, play or pause, the
 * sound switch ("Sound on", or "Tap for sound" while muted) with the time,
 * and one line for a hint or a note ("Walk closer to start · 4 m", "The
 * browser kept the sound off"). A video with captions also has a CC switch
 * and a caption strip that follows the clip's time. A porthole's card also carries the clip
 * itself, large, with a close - the prototype's full-screen player. The
 * card shares the narration card's frame (`narration-card.ts`), scoped to
 * the video kind.
 *
 * @see video-card.ts.md
 */

import { clockText } from "../../read-along.js";

/** What the card asks of the video it shows. */
export interface VideoControls {
  /** The visitor's tap: play, pause, resume or replay. */
  toggle(): void;
  /** The visitor's sound switch. */
  toggleSound(): void;
  playing(): boolean;
  sound(): boolean;
  timeMs(): number;
  /** 0 while its length is not known. */
  durationMs(): number;
  /** A hint or a note; null: none. */
  line(): string | null;
  /** Its captions; absent: it has none, and the card offers no CC. */
  readonly captions?: VideoCaptionControls;
}

/** What the card asks of a video's captions. */
export interface VideoCaptionControls {
  /** The words on now; "" between cues. */
  text(): string;
  /** Whether the visitor has them on. */
  on(): boolean;
  /** The visitor's CC switch. */
  toggle(): void;
}

/** An open card: `render` brings it up to the video (each frame; it
 *  writes only what changed), `dispose` takes it off the screen. */
export interface VideoCard {
  render(): void;
  dispose(): void;
}

/** What the card says of the video now. */
function stateWords(c: VideoControls): { state: string; button: string } {
  if (c.playing()) return { state: "Playing", button: "Pause" };
  const time = c.timeMs();
  const duration = c.durationMs();
  if (duration > 0 && time >= duration) {
    return { state: "Watched. Play again?", button: "Play again" };
  }
  return time > 0
    ? { state: "Paused", button: "Play" }
    : { state: "Ready", button: "Play" };
}

/**
 * The card for the video `title` in `host`, driven by `controls`. With
 * `player` (a porthole's clip) the clip shows in the card, large, until
 * `onClose`; the clip is taken out again when the card goes.
 */
export function videoCard(
  host: HTMLElement,
  video: { readonly title?: string },
  controls: VideoControls,
  player: { readonly element: HTMLElement; onClose(): void } | null = null,
): VideoCard {
  const doc = host.ownerDocument;
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    parent: HTMLElement,
  ): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.className = className;
    parent.append(el);
    return el;
  };
  const title = video.title ?? "Video";
  const root = make("section", "narration-card", host);
  root.dataset["testid"] = "video-card";
  root.dataset["kind"] = "video";
  root.setAttribute("aria-label", `Video: ${title}`);
  if (player !== null) {
    root.dataset["player"] = "open";
    const frame = make("div", "video-card-player", root);
    frame.append(player.element);
    const close = make("button", "video-card-close", frame);
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      player.onClose();
    });
  }
  const head = make("div", "narration-card-head", root);
  make("span", "narration-card-kicker", head).textContent = "Video";
  const state = make("span", "narration-card-state", head);
  state.setAttribute("aria-live", "polite");
  make("h2", "narration-card-title", root).textContent = title;
  const row = make("div", "narration-card-row", root);
  const play = make("button", "narration-card-play", row);
  play.type = "button";
  const sound = make("button", "video-card-sound", row);
  sound.type = "button";
  const time = make("span", "narration-card-time", row);
  const captions = controls.captions;
  const cc =
    captions === undefined ? null : make("button", "video-card-cc", row);
  if (cc !== null) {
    cc.type = "button";
    cc.textContent = "CC";
    cc.setAttribute("aria-label", "Captions");
    cc.addEventListener("click", () => {
      captions?.toggle();
      render();
    });
  }
  // Not a live region: the transcript is the text for a screen reader.
  const strip =
    captions === undefined ? null : make("p", "video-card-caption", root);
  const line = make("p", "narration-card-line", root);
  play.addEventListener("click", () => {
    controls.toggle();
    render();
  });
  sound.addEventListener("click", () => {
    controls.toggleSound();
    render();
  });

  const last = {
    state: "",
    button: "",
    sound: "",
    time: "",
    line: "\u0000",
    cc: "",
    caption: "\u0000",
  };
  function render(): void {
    const words = stateWords(controls);
    if (words.state !== last.state) {
      state.textContent = words.state;
      last.state = words.state;
    }
    if (words.button !== last.button) {
      play.textContent = words.button;
      play.setAttribute("aria-label", words.button);
      last.button = words.button;
    }
    const on = controls.sound();
    const soundWords = on ? "Sound on" : "Tap for sound";
    if (soundWords !== last.sound) {
      sound.textContent = soundWords;
      sound.setAttribute("aria-pressed", String(on));
      last.sound = soundWords;
    }
    const shown = `${clockText(controls.timeMs())} / ${clockText(controls.durationMs())}`;
    if (shown !== last.time) {
      time.textContent = shown;
      last.time = shown;
    }
    renderCaptions();
    const said = controls.line() ?? "";
    if (said !== last.line) {
      line.textContent = said;
      line.hidden = said === "";
      last.line = said;
    }
  }
  /** The CC switch's state and the cue on now (none while switched off). */
  function renderCaptions(): void {
    if (captions === undefined || cc === null || strip === null) return;
    const ccOn = captions.on();
    if (String(ccOn) !== last.cc) {
      cc.setAttribute("aria-pressed", String(ccOn));
      last.cc = String(ccOn);
    }
    const cue = ccOn ? captions.text() : "";
    if (cue !== last.caption) {
      strip.textContent = cue;
      strip.hidden = cue === "";
      last.caption = cue;
    }
  }
  render();
  return {
    render,
    dispose() {
      player?.element.remove();
      root.remove();
    },
  };
}
