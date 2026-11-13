/**
 * Then and now's slider: the panel a visitor lined up with the viewpoint
 * gets on the page's screen (`WorldScreen`). The picture's year and first
 * sentence, and a slider from today to then, the old picture's share. The
 * part moves it while the fade-in runs; once the visitor moves it, the
 * visitor's value holds (`then-now-fade.ts`).
 *
 * @see then-now-slider.ts.md
 */

/** What the panel shows beside the slider. */
export interface ThenNowSliderContent {
  readonly year?: string | undefined;
  readonly caption?: string | undefined;
}

/** The slider's steps: a share in hundredths. */
const STEPS = 100;
/** The caption's first sentence, cut at about two lines. */
const FIRST_SENTENCE_MAX = 110;

/** The caption's first sentence, cut at a word within the limit. */
export function firstSentence(text: string | undefined): string {
  const first = (text ?? "").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (first.length <= FIRST_SENTENCE_MAX) return first;
  return `${first.slice(0, FIRST_SENTENCE_MAX - 2).replace(/\s+\S*$/, "")}…`;
}

/**
 * Builds the panel into `host` showing `fade` (0 to 1). `changed` hears
 * the visitor's moves; `set` moves it from the part (not heard back);
 * `dispose` is the screen's clean-up.
 */
export function buildThenNowSlider(
  host: HTMLElement,
  content: ThenNowSliderContent,
  fade: number,
  changed: (fade: number) => void,
): { readonly set: (fade: number) => void; readonly dispose: () => void } {
  const doc = host.ownerDocument;
  const panel = doc.createElement("div");
  panel.className = "then-now-slider";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Then and now");
  const words = doc.createElement("div");
  words.className = "then-now-words";
  const year = content.year?.trim() ?? "";
  if (year !== "") {
    const y = doc.createElement("span");
    y.className = "then-now-year";
    y.textContent = year;
    words.append(y);
  }
  const line = doc.createElement("span");
  line.className = "then-now-caption";
  line.textContent = firstSentence(content.caption);
  words.append(line);
  const row = doc.createElement("label");
  row.className = "then-now-row";
  const now = doc.createElement("span");
  now.textContent = "Today";
  const then = doc.createElement("span");
  then.textContent = "Then";
  const input = doc.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = String(STEPS);
  input.step = "1";
  input.setAttribute("aria-label", "Between today and then");
  const show = (value: number): void => {
    const clamped = Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : 0;
    input.value = String(Math.round(clamped * STEPS));
    input.setAttribute(
      "aria-valuetext",
      `${String(Math.round(clamped * 100))} % then`,
    );
  };
  show(fade);
  const onInput = (): void => {
    const value = Number(input.value) / STEPS;
    show(value);
    changed(value);
  };
  input.addEventListener("input", onInput);
  row.append(now, input, then);
  panel.append(words, row);
  host.append(panel);
  return {
    set(value) {
      // The visitor's thumb is not moved under them.
      if (doc.activeElement !== input) show(value);
    },
    dispose() {
      input.removeEventListener("input", onInput);
      panel.remove();
    },
  };
}
