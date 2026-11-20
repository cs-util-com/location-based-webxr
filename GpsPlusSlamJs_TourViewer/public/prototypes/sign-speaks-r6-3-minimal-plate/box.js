// Sign speaks 6.3 - the round 5 narration box, as a module both pages use. Throwaway prototype.
// One box at the bottom edge: at most three lines, the speaker's name bold in their colour at
// the start of the words, unread words grey and read words white; a vertical drag scrubs, a tap
// pauses or plays. The host owns the clock: the box reads `t` every frame and reports a drag.
import { clamp, lineFloatAt, lineTimes, timeAtLine, wordAt } from "./story.js";

const FOLLOW_ROW = 1; // the spoken line sits in the middle of the three rows
const MAX_ROWS = 3;
export const TAP_SLOP = 8; // px a finger may move and still count as a tap
const BOX_CAP = 720; // px, the widest the box gets on a big screen
const BOX_SHARE = 0.8;

/**
 * `createBox({ host, speaker, synthetic, timeline, scale, on })`. `on.tap(x, y)`,
 * `on.scrubStart()`, `on.scrub(t)` and `on.scrubEnd()` are the host's; `scale()` is how much the
 * page is zoomed (a phone frame drawn smaller on a desktop), so finger distances are the phone's.
 */
export function createBox({
  host,
  speaker,
  synthetic,
  timeline,
  scale = () => 1,
  on = {},
  interactive = true,
}) {
  const el = document.createElement("section");
  el.className = "nbox off";
  el.tabIndex = interactive ? 0 : -1;
  el.setAttribute("aria-roledescription", "narration");
  el.setAttribute(
    "aria-label",
    `${speaker.name} speaks${synthetic ? ", an AI voice" : ""}. Tap to pause or play, drag up or down to move through what is said.`,
  );
  const win = document.createElement("div");
  win.className = "win";
  const col = document.createElement("div");
  col.className = "col";
  const sbar = document.createElement("div");
  sbar.className = "sbar";
  const thumb = document.createElement("i");
  sbar.append(thumb);
  win.append(col, sbar);
  el.append(win);
  host.append(el);

  const who = document.createElement("b");
  who.className = "who";
  who.style.color = speaker.color;
  who.textContent = speaker.name;
  col.append(who);
  if (synthetic) {
    const d = document.createElement("span");
    d.className = "disc";
    d.textContent = " · AI voice";
    col.append(d);
  }
  col.append(" ");
  const { words, total } = timeline;
  const spans = words.map((w) => {
    const s = document.createElement("span");
    s.className = "w";
    s.textContent = w.text;
    col.append(s, " ");
    return s;
  });

  let lt = lineTimes(
    words,
    words.map(() => 0),
    total,
  );
  let lineOf = [];
  let rows = 1;
  let lh = 22;
  let s = 0;
  let litUpTo = -1;
  let shown = false;
  let dragging = false;
  let press = null;
  let lastT = 0;
  let endPress = () => {};
  const maxScroll = () => Math.max(0, lt.nLines - rows);

  function layout() {
    lh = parseFloat(getComputedStyle(el).getPropertyValue("--lh")) || 22;
    const devW = host.clientWidth;
    const boxMax = Math.min(devW * BOX_SHARE, BOX_CAP);
    const chrome = 14 + 10 + 2 + 12;
    col.style.width = `${Math.floor(Math.max(90, boxMax - chrome))}px`;
    const tops = [];
    const lineAt = (node) => {
      const top = node.offsetTop;
      let k = tops.findIndex((x) => Math.abs(x - top) < lh / 2);
      if (k < 0) {
        tops.push(top);
        k = tops.length - 1;
      }
      return k;
    };
    lineAt(who);
    lineOf = spans.map(lineAt);
    lt = lineTimes(words, lineOf, total);
    // the name opens line 0; lines are counted from it
    lt.nLines = Math.max(lt.nLines, tops.length);
    lt.lineStart[0] = 0;
    rows = Math.min(MAX_ROWS, lt.nLines);
    el.style.setProperty("--rows", String(rows));
    sbar.classList.toggle("none", lt.nLines <= rows);
    s = followTarget(lastT);
  }
  function followTarget(t) {
    const cur = Math.max(0, wordAt(words, t));
    return clamp((lineOf[cur] ?? 0) - FOLLOW_ROW, 0, maxScroll());
  }

  function frame(dt, t, playing) {
    lastT = t;
    if (!shown) {
      return;
    }
    const lit = wordAt(words, t - 1e-6);
    if (lit !== litUpTo) {
      const lo = Math.min(lit, litUpTo);
      const hi = Math.max(lit, litUpTo);
      for (let i = Math.max(0, lo + 1); i <= hi; i++) {
        spans[i].classList.toggle("on", i <= lit);
      }
      litUpTo = lit;
    }
    if (!dragging) {
      const target = followTarget(t);
      s += (target - s) * (1 - Math.exp(-dt * 9));
      if (Math.abs(target - s) < 0.002) {
        s = target;
      }
    }
    col.style.transform = `translateY(${(-s * lh).toFixed(2)}px)`;
    const winH = rows * lh - 4;
    const thumbH = Math.max(14, (winH * rows) / lt.nLines);
    const pos = clamp(s / Math.max(1, maxScroll()), 0, 1) * (winH - thumbH);
    thumb.style.height = `${thumbH.toFixed(1)}px`;
    thumb.style.transform = `translateY(${pos.toFixed(1)}px)`;
    const talk = playing && !dragging ? "yes" : "no";
    if (el.dataset.speaking !== talk) {
      el.dataset.speaking = talk;
    }
  }

  function show(on) {
    if (on === shown) {
      return;
    }
    shown = on;
    el.classList.toggle("off", !on);
    el.inert = !on;
    if (on) {
      layout();
      spans.forEach((sp) => sp.classList.remove("on"));
      litUpTo = -1;
    } else if (press) {
      endPress({ pointerId: press.id, type: "pointercancel" });
    }
  }

  if (interactive) {
    el.addEventListener("pointerdown", (e) => {
      if (!shown) {
        return;
      }
      press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        s0: s,
        line0: lineFloatAt(lt, lastT),
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // a capture that fails is ignored; the drag still reads the moves it gets
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!press || e.pointerId !== press.id) {
        return;
      }
      const k = scale() || 1;
      const dy = (press.y - e.clientY) / k; // finger up = text up = ahead
      if (!dragging && Math.hypot((e.clientX - press.x) / k, dy) > TAP_SLOP) {
        dragging = true;
        col.classList.add("scrub");
        el.classList.add("dragging");
        on.scrubStart?.();
      }
      if (!dragging) {
        return;
      }
      const lines = dy / lh;
      on.scrub?.(timeAtLine(lt, press.line0 + lines));
      const raw = press.s0 + lines;
      const top = maxScroll();
      s = raw < 0 ? raw * 0.3 : raw > top ? top + (raw - top) * 0.3 : raw;
    });
    endPress = (e) => {
      if (!press || e.pointerId !== press.id) {
        return;
      }
      const wasDrag = dragging;
      press = null;
      dragging = false;
      col.classList.remove("scrub");
      el.classList.remove("dragging");
      if (wasDrag) {
        on.scrubEnd?.();
        return;
      }
      if (e.type === "pointerup") {
        on.tap?.(e.clientX, e.clientY);
      }
    };
    el.addEventListener("pointerup", endPress);
    el.addEventListener("pointercancel", endPress);
    el.addEventListener("lostpointercapture", endPress);
    el.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        on.tap?.(r.left + r.width / 2, r.top + r.height / 2);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        on.scrubStart?.();
        on.scrub?.(
          timeAtLine(
            lt,
            lineFloatAt(lt, lastT) + (e.key === "ArrowDown" ? 1 : -1),
          ),
        );
        on.scrubEnd?.();
      }
    });
  }

  return {
    el,
    show,
    layout,
    frame,
    get shown() {
      return shown;
    },
    get dragging() {
      return dragging;
    },
  };
}
