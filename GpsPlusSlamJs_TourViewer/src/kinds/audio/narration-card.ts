/**
 * A narration's player card: the screen part of a narration circle
 * (`spot.ts`), open while the visitor is inside it. Its title, play or
 * pause, a scrub bar with the time, and the sentence of the transcript
 * being spoken. The structure follows the narration prototype's card; its
 * look is deliberately plain and lives behind this one function until the
 * look is decided.
 *
 * @see narration-card.ts.md
 */

/** What the card asks of the narration it shows. */
export interface NarrationControls {
  /** Play, or pause a playing one (the circle's tap rule). */
  toggle(): void;
  seek(ms: number): void;
  timeMs(): number;
  /** 0 while its length is not known. */
  durationMs(): number;
  playing(): boolean;
}

/** The transcript's sentences, in order: split after `.`, `!` or `?`
 *  followed by a space; blank or none gives none. */
export function transcriptSentences(text: string | undefined): string[] {
  if (text === undefined) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * The sentence spoken at `timeMs` of `durationMs`, by each sentence's share
 * of the transcript's characters (the format keeps no timings, so this
 * reads them as spoken at an even pace); -1 for no sentences. Before the
 * start it is the first, past the end the last.
 */
export function sentenceAt(
  sentences: readonly string[],
  timeMs: number,
  durationMs: number,
): number {
  if (sentences.length === 0) return -1;
  if (!(durationMs > 0) || !(timeMs > 0)) return 0;
  const total = sentences.reduce((n, s) => n + s.length, 0);
  const at = (Math.min(timeMs, durationMs) / durationMs) * total;
  let reached = 0;
  for (const [i, s] of sentences.entries()) {
    reached += s.length;
    if (at < reached) return i;
  }
  return sentences.length - 1;
}

/** `ms` as m:ss. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

/** What the card says of the narration now. */
function stateWords(c: NarrationControls): {
  readonly state: string;
  readonly button: string;
} {
  if (c.playing()) return { state: "Playing", button: "Pause" };
  const time = c.timeMs();
  const duration = c.durationMs();
  if (duration > 0 && time >= duration) {
    return { state: "Heard. Play again?", button: "Play again" };
  }
  return time > 0
    ? { state: "Paused", button: "Play" }
    : { state: "Tap play to listen", button: "Play" };
}

/** An open card: `render` brings it up to the narration (each frame;
 *  it writes only what changed), `dispose` takes it off the screen. */
export interface NarrationCard {
  render(): void;
  dispose(): void;
}

/**
 * The card for the narration `title` with `transcript`, built into `host`
 * and driven by `controls`.
 */
export function narrationCard(
  host: HTMLElement,
  narration: { readonly title?: string; readonly transcript?: string },
  controls: NarrationControls,
): NarrationCard {
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
  const title = narration.title ?? "Narration";
  const sentences = transcriptSentences(narration.transcript);
  const root = make("section", "narration-card", host);
  root.dataset["testid"] = "narration-card";
  root.setAttribute("aria-label", `Narration: ${title}`);
  const head = make("div", "narration-card-head", root);
  make("span", "narration-card-kicker", head).textContent = "Narration";
  const state = make("span", "narration-card-state", head);
  state.setAttribute("aria-live", "polite");
  make("h2", "narration-card-title", root).textContent = title;
  const row = make("div", "narration-card-row", root);
  const button = make("button", "narration-card-play", row);
  button.type = "button";
  const scrub = make("input", "narration-card-scrub", row);
  scrub.type = "range";
  scrub.min = "0";
  scrub.step = "1";
  scrub.setAttribute("aria-label", "Position");
  const time = make("span", "narration-card-time", row);
  const line = make("p", "narration-card-line", root);
  line.hidden = sentences.length === 0;

  let dragging = false;
  button.addEventListener("click", () => {
    controls.toggle();
    render();
  });
  scrub.addEventListener("input", () => {
    dragging = true;
  });
  scrub.addEventListener("change", () => {
    dragging = false;
    controls.seek(Number(scrub.value) * 1000);
    render();
  });

  const last = { state: "", button: "", time: "", line: -2 };
  function render(): void {
    const words = stateWords(controls);
    if (words.state !== last.state) {
      state.textContent = words.state;
      last.state = words.state;
    }
    if (words.button !== last.button) {
      button.textContent = words.button;
      button.setAttribute("aria-label", words.button);
      last.button = words.button;
    }
    const ms = controls.timeMs();
    const duration = controls.durationMs();
    const shown = `${clock(ms)} / ${clock(duration)}`;
    if (shown !== last.time) {
      time.textContent = shown;
      scrub.max = String(Math.max(0, Math.round(duration / 1000)));
      scrub.disabled = !(duration > 0);
      if (!dragging) scrub.value = String(Math.floor(ms / 1000));
      scrub.setAttribute(
        "aria-valuetext",
        `${clock(ms)} of ${clock(duration)}`,
      );
      last.time = shown;
    }
    const i = sentenceAt(sentences, ms, duration);
    if (i !== last.line) {
      line.textContent = i < 0 ? "" : (sentences[i] ?? "");
      last.line = i;
    }
  }
  render();
  return {
    render,
    dispose() {
      root.remove();
    },
  };
}
