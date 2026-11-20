// Sign speaks 6.3 - the narration both pages play. Throwaway prototype: not wired to the app.
// One invented text with times invented from its letters (no recording), the line arithmetic
// the box and the plate share, and a generated tone that stands in for a voice.

export const SPEAKER = { name: "Narrator", color: "#f9a8d4" };
export const TITLE = "The old pump house";
export const SYNTHETIC = true;
export const STORY =
  "This little house once held the pump for the whole lane. " +
  "Every morning a keeper turned the big wheel, and water climbed from a deep spring into the trough outside. " +
  "Children were paid one coin a week to keep the trough clean. " +
  "In a dry summer the spring sank so low that the wheel turned for hours and brought up only mud. " +
  "The lane then shared one bucket per house, and the keeper wrote every bucket into a book with a blue cover. " +
  "Look at the door: the iron ring is the one the keeper pulled each night.";

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Times invented from the letters: about 150 words a minute, pauses after punctuation. */
function fakeTimes(texts) {
  let t = 0;
  return texts.map((w) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length;
    const d = clamp(0.11 + 0.052 * letters, 0.17, 0.64);
    const start = t;
    t += d;
    if (/[.!?]["']?$/.test(w)) {
      t += 0.42;
    } else if (/[,;:]$/.test(w)) {
      t += 0.22;
    }
    return { start, end: start + d };
  });
}

/** The text as timed words: `{ words: [{ text, start, end }], total }` in seconds. */
export function makeTimeline(text) {
  const texts = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const times = fakeTimes(texts);
  const words = texts.map((w, i) => ({
    text: w,
    start: times[i].start,
    end: times[i].end,
  }));
  const total = words.length ? words[words.length - 1].end + 0.3 : 0;
  return { words, total };
}

/** The last word that has started at `time`, -1 before the first. */
export function wordAt(words, time) {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (words[m].start <= time) {
      found = m;
      lo = m + 1;
    } else {
      hi = m - 1;
    }
  }
  return found;
}

/**
 * Lines as times, for one layout of the words (the box's or the plate's): `lineOf[i]` is
 * word i's line. Gives `{ lineStart, nLines, total }`, lineStart with one extra entry = total.
 */
export function lineTimes(words, lineOf, total) {
  const nLines = Math.max(1, lineOf.length ? Math.max(...lineOf) + 1 : 1);
  const lineStart = [];
  words.forEach((w, i) => {
    if (lineStart[lineOf[i]] === undefined) {
      lineStart[lineOf[i]] = w.start;
    }
  });
  for (let k = 0; k < nLines; k++) {
    if (lineStart[k] === undefined) {
      lineStart[k] = k > 0 ? lineStart[k - 1] : 0;
    }
  }
  lineStart[nLines] = total;
  return { lineStart, nLines, total };
}

/** Where `time` is, in lines (fractional inside a line). */
export function lineFloatAt(lt, time) {
  if (time >= lt.total) {
    return lt.nLines;
  }
  let k = 0;
  while (k + 1 < lt.nLines && lt.lineStart[k + 1] <= time) {
    k++;
  }
  const span = lt.lineStart[k + 1] - lt.lineStart[k];
  return k + (span > 0 ? clamp((time - lt.lineStart[k]) / span, 0, 1) : 0);
}

/** The time at a place in lines: the inverse of lineFloatAt. */
export function timeAtLine(lt, x) {
  const v = clamp(x, 0, lt.nLines);
  const k = Math.floor(v);
  if (k >= lt.nLines) {
    return lt.total;
  }
  return lt.lineStart[k] + (v - k) * (lt.lineStart[k + 1] - lt.lineStart[k]);
}

/**
 * A generated tone in place of a voice: one soft murmur per word. The audio context is made
 * on the first tap (`unlock`), so nothing can sound before the visitor asks for it.
 */
export function createToneVoice() {
  let ctx = null;
  let out = null;
  return {
    unlock() {
      if (ctx) {
        if (ctx.state === "suspended") {
          ctx.resume().catch(() => {});
        }
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        return;
      }
      try {
        ctx = new AC();
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 900;
        out = ctx.createGain();
        out.gain.value = 0.7;
        lp.connect(out).connect(ctx.destination);
        out = lp;
      } catch {
        ctx = null;
      }
    },
    /** One word's murmur, `dur` seconds long. */
    word(dur, seed) {
      if (!ctx || ctx.state !== "running") {
        return;
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      const f = 150 + ((seed * 37) % 70);
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.linearRampToValueAtTime(f * 0.86, now + dur);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.03);
      g.gain.linearRampToValueAtTime(0, now + Math.max(0.06, dur * 0.85));
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    },
    get ready() {
      return !!ctx && ctx.state === "running";
    },
  };
}
