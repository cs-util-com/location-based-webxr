// Splat trainer prototype, direction A: guided steps. A scripted simulation
// only - no recording is read, no GPU is used, nothing is saved. The state
// lives in one object `S`; render() redraws the steps on every phase change
// and updateLive() touches only the moving parts (progress, times, preview).
import { drawPreview } from "./preview.js";

const WALK_M = 318;
const PHOTOS = 412;
const RECORDING = "recording-2026-11-14.zip";
const PREVIEW_EVERY_S = 15;
const SLOW_FACTOR = 6;

// The scripted walk: 11 stretches, their fake training time in seconds and
// how each one ends. The verdicts are fixed so every state can be shown.
const PLAN = [
  { dur: 190, verdict: "good" },
  { dur: 210, verdict: "good" },
  { dur: 180, verdict: "good" },
  {
    dur: 230,
    verdict: "weak",
    reasons: ["Many blurry photos in this stretch"],
  },
  { dur: 200, verdict: "good" },
  { dur: 170, verdict: "good" },
  {
    dur: 260,
    verdict: "bad",
    reasons: [
      "The photos are far apart here, about 2.4 m between them",
      "Places between the photos had to be guessed",
    ],
  },
  { dur: 190, verdict: "good" },
  {
    dur: 240,
    verdict: "weak",
    reasons: ["Ran out of time before it was fully sharp"],
  },
  { dur: 200, verdict: "good" },
  { dur: 180, verdict: "good" },
];
const RETRAIN_S = 480;

const NUMBERS = {
  good: ["29.6", "22.4"],
  weak: ["26.1", "19.8"],
  bad: ["22.9", "16.3"],
};
const SHARPNESS = { good: 1, weak: 0.72, bad: 0.42 };
const SENTENCE = {
  good: "Sharp from the photos and from between them. Ready to use.",
  weak: "Usable, but a little soft. Fine as context while you edit.",
  bad: "Not good enough. This stretch looks blurry from most angles, so it would show the place wrongly.",
};
const LABEL = {
  good: "Good",
  weak: "Weak",
  bad: "Not good enough",
  training: "Training",
  waiting: "Waiting",
  retraining: "Training again",
  discarded: "Left out",
};

const STATES = [
  ["start", "1 Start: choose a recording"],
  ["reading", "1 Reading the recording"],
  ["census", "2 Census"],
  ["gpu-warning", "2 Census: built-in graphics warning"],
  ["training", "3 Training"],
  ["not-good", "3 Training: a stretch not good enough"],
  ["cancel-confirm", "3 Training: stop, asking first"],
  ["cancelled", "3 Stopped (cancelled)"],
  ["resumed", "3 Carried on (resumed)"],
  ["review", "4 Review: not good enough stretch open"],
  ["retraining", "4 Review: training a stretch again"],
  ["save", "5 Save"],
  ["saving", "5 Saving"],
  ["saved", "5 Saved"],
  ["refusal-phone", "Refusal: a phone"],
  ["refusal-webgpu", "Refusal: no WebGPU"],
  ["refusal-old", "Refusal: old recording"],
  ["refusal-nodepth", "Refusal: no depth data"],
];

let S;

function freshStretches() {
  const len = WALK_M / PLAN.length;
  return PLAN.map((p, i) => ({
    i,
    from: Math.round(i * len),
    to: Math.round((i + 1) * len),
    photos: 34 + ((i * 7) % 9),
    dur: p.dur,
    t: 0,
    status: "waiting",
    verdict: null,
    reasons: [],
    decision: null,
    retrainT: 0,
    previewFrame: 0,
  }));
}

function baseline() {
  S = {
    phase: "choose",
    refusal: null,
    gpuWarn: false,
    gpuChecked: false,
    slow: false,
    cur: 0,
    stretches: freshStretches(),
    resumed: false,
    toast: null,
    confirmCancel: false,
    open: null,
    reading: 0,
    saveP: 0,
    deleted: false,
    stretchClock: 0,
    previewAge: 0,
    runClock: 0,
    webgpuCheck: "",
  };
}

const $ = (sel, root = document) => root.querySelector(sel);

// ---------- formatting ----------

function fmtLeft(sec) {
  if (sec < 50) return "less than a minute";
  const min = Math.round(sec / 60);
  if (min < 90) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 10) * 10;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}

function fmtSoFar(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}

const durOf = (st) => st.dur * (S.slow ? SLOW_FACTOR : 1);

function totalLeft() {
  let left = 0;
  for (const st of S.stretches) {
    if (st.status === "training") left += durOf(st) - st.t;
    else if (st.status === "waiting") left += durOf(st);
  }
  return left;
}

const totalPlanned = () => S.stretches.reduce((a, st) => a + durOf(st), 0);

function counts() {
  const c = { good: 0, weak: 0, bad: 0, discarded: 0, done: 0 };
  for (const st of S.stretches) {
    if (st.status === "done" || st.status === "retraining") c.done++;
    if (st.decision === "discard") c.discarded++;
    else if (st.verdict) c[st.verdict]++;
  }
  return c;
}

// ---------- small pieces of markup ----------

const ICON = {
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  weak: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/></svg>',
  bad: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  training:
    '<svg viewBox="0 0 16 16" aria-hidden="true" class="spin"><path d="M8 2a6 6 0 1 1-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  waiting:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2"/></svg>',
  discarded:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};
ICON.retraining = ICON.training;

function stateOf(st) {
  if (st.decision === "discard") return "discarded";
  if (st.status === "retraining") return "retraining";
  if (st.status === "done") return st.verdict;
  return st.status;
}

function chip(state, extra = "") {
  return `<span class="chip chip-${state}">${ICON[state]}<span>${LABEL[state]}${extra}</span></span>`;
}

function ribbon(interactive) {
  const segs = S.stretches
    .map((st) => {
      const state = stateOf(st);
      const w = ((st.to - st.from) / WALK_M) * 100;
      const title = `Stretch ${st.i + 1}, ${st.from} to ${st.to} m: ${LABEL[state]}`;
      const sel = interactive && S.open === st.i ? " is-selected" : "";
      return interactive
        ? `<button type="button" class="seg seg-${state}${sel}" aria-pressed="${!!sel}" style="flex-basis:${w}%" data-open="${st.i}" title="${title}" aria-label="${title}"><span>${st.i + 1}</span></button>`
        : `<span class="seg seg-${state}" style="flex-basis:${w}%" title="${title}"><span>${st.i + 1}</span></span>`;
    })
    .join("");
  return `<div class="ribbon-wrap">
    <div class="ribbon" role="${interactive ? "group" : "img"}" aria-label="The walk, stretch by stretch">${segs}</div>
    <div class="ribbon-ticks" aria-hidden="true"><span>Start, 0 m</span><span>100 m</span><span>200 m</span><span>End, ${WALK_M} m</span></div>
  </div>`;
}

function canvas(cls, w, h, seed, sharp) {
  return `<canvas class="${cls}" width="${w}" height="${h}" data-seed="${seed}" data-sharp="${sharp}" aria-hidden="true"></canvas>`;
}

// ---------- steps ----------

function stepMeta() {
  const p = S.phase;
  const idx = {
    choose: 1,
    reading: 1,
    census: 2,
    training: 3,
    cancelled: 3,
    review: 4,
    save: 5,
    saving: 5,
    saved: 5,
  }[p];
  const c = counts();
  const kept = PLAN.length - c.discarded;
  const total = Math.round(totalPlanned() / 60);
  return [
    {
      title: "Choose the recording",
      summary: `${RECORDING} - ${PHOTOS} photos`,
    },
    {
      title: "Check it",
      summary: `${WALK_M} m walked, depth data present, ${fmtLeft(totalPlanned())} on this computer`,
    },
    {
      title: "Train",
      summary: `All ${PLAN.length} stretches trained in about ${total} min`,
    },
    {
      title: "Review the stretches",
      summary: `${c.good} good, ${c.weak} weak${c.bad ? `, ${c.bad} not good enough (marked)` : ""}${c.discarded ? `, ${c.discarded} left out` : ""}`,
    },
    {
      title: "Save",
      summary: `Saved one file with ${kept} stretches`,
    },
  ].map((m, i) => ({
    ...m,
    n: i + 1,
    state:
      i + 1 < idx
        ? "done"
        : i + 1 === idx
          ? p === "saved" && i === 4
            ? "finished"
            : "current"
          : "locked",
  }));
}

function bodyFor(n) {
  if (n === 1) return S.refusal ? refusalBody() : chooseBody();
  if (n === 2) return censusBody();
  if (n === 3) return S.phase === "cancelled" ? cancelledBody() : trainBody();
  if (n === 4) return reviewBody();
  return saveBody();
}

function chooseBody() {
  if (S.phase === "reading") {
    return `<div class="reading" role="status">
      <p class="file-chip">${fileIcon()}${RECORDING}</p>
      <p>Reading the recording on this computer...</p>
      <div class="bar"><span id="read-bar" style="width:${Math.round(S.reading * 100)}%"></span></div>
      <p class="hint" id="read-text">Looked at ${Math.round(S.reading * PHOTOS)} of ${PHOTOS} photos</p>
    </div>`;
  }
  return `<p>Choose the recording from the recorder app (a .zip file). It is read here and never uploaded.</p>
    <div class="drop" id="drop">
      ${fileIcon(40)}
      <p class="drop-title">Drop the recording file here</p>
      <p class="hint">or</p>
      <button type="button" class="btn btn-primary" data-act="choose">Choose a recording file</button>
    </div>
    <div class="what-next">
      <h3 class="label">What happens next</h3>
      <ol class="mini-steps">
        <li>The page checks the recording and says how long training will take.</li>
        <li>It trains the walk stretch by stretch: 30 to 60 minutes for a whole walk.</li>
        <li>You look at each stretch, then save one file for the tour editor.</li>
      </ol>
    </div>`;
}

function fileIcon(size = 18) {
  return `<svg class="file-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M6 2.5h8l4.5 4.5v14.5h-12.5z M14 2.5v4.5h4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 10h1M10 13h1M10 16h1" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

function refusalBody() {
  if (S.refusal === "webgpu") {
    return `<div class="callout callout-danger" role="alert">
      <h3>This browser cannot train splats</h3>
      <p>Training needs WebGPU, a graphics feature of current Chrome and Edge on desktop computers. It is missing or switched off in this browser.</p>
      <h4 class="label">What to do</h4>
      <p>Open this page in the newest Chrome or Edge, on a computer with a graphics card. Your recording file stays where it is.</p>
      <div class="actions">
        <button type="button" class="btn" data-act="webgpu-check">Check again</button>
        <span class="hint" role="status">${S.webgpuCheck}</span>
      </div>
    </div>`;
  }
  const old = S.refusal === "old";
  const file = old ? "recording-2025-03-02.zip" : "recording-2026-10-30.zip";
  return `<p class="file-chip">${fileIcon()}${file}</p>
    <div class="callout callout-danger" role="alert">
      <h3>${old ? "This recording is too old to train" : "This recording has no depth data"}</h3>
      <p>${
        old
          ? "It was made with an earlier version of the recorder app, which saved the camera positions in a way this page cannot use."
          : "Without depth data the page cannot work out how the camera's lens sees the world, so it cannot train."
      }</p>
      <h4 class="label">What to do</h4>
      <p>${
        old
          ? "Record the place again with the current recorder app, then choose the new file."
          : "Make a new recording with depth switched on, on a phone that records depth, then choose the new file."
      }</p>
      <div class="actions"><button type="button" class="btn btn-primary" data-act="restart">Choose another recording</button></div>
    </div>`;
}

function censusBody() {
  const est = fmtLeft(totalPlanned() * (S.gpuWarn ? SLOW_FACTOR : 1));
  const facts = [
    ["Photos", `${PHOTOS}`, ""],
    ["Walked", `${WALK_M} m`, ""],
    ["Photo spacing", "0.8 m", "one every 1.1 s"],
    ["Depth data", "Yes", ""],
    ["Photos skipped", "3", "unreadable, left out"],
    ["Passed twice", "2 places", ""],
  ];
  const gpu = S.gpuWarn
    ? `<div class="callout callout-warn" role="alert">
        <h3>This computer is using its built-in graphics</h3>
        <p>That is slow: <strong>${est}</strong> instead of ${fmtLeft(totalPlanned())}. If the computer has a second, faster graphics card, tell Windows to use it for your browser:</p>
        <p class="path">Settings &gt; System &gt; Display &gt; Graphics &gt; your browser &gt; High performance</p>
        <p>Then restart the browser and open this page again.</p>
        <div class="actions">
          <button type="button" class="btn" data-act="gpu-check">Check again</button>
          <button type="button" class="btn btn-quiet" data-act="start-slow">Train anyway (${est})</button>
        </div>
      </div>`
    : `<p class="gpu-ok">${ICON.good}<span>Graphics in use: a dedicated graphics card. ${S.gpuChecked ? "Switched over, thank you." : "Good for training."}</span></p>`;
  return `<div class="census">
      <h3 class="label">Your recording</h3>
      <dl class="facts">${facts.map(([k, v, h]) => `<div><dt>${k}</dt><dd>${v}${h ? `<small>${h}</small>` : ""}</dd></div>`).join("")}</dl>
      <h3 class="label">This computer</h3>
      <div class="machine">
        <p class="eta"><span class="eta-k">Training time here</span><span class="eta-v">${est}</span></p>
        ${gpu}
      </div>
      <h3 class="label">How it will train</h3>
      <p>The walk is cut into ${PLAN.length} stretches of about 30 m. Each one trains on its own for a few minutes. You see each stretch take shape as it trains.</p>
      ${ribbon(false)}
      <div class="actions">
        ${S.gpuWarn ? "" : `<button type="button" class="btn btn-primary" data-act="start">Start training (${est})</button>`}
        <span class="hint">You can stop at any time. Finished stretches are kept.</span>
      </div>
    </div>`;
}

function stretchList() {
  const c = counts();
  return `<div class="list-head"><h3 class="label">All stretches</h3><span class="hint">${c.done} of ${PLAN.length} done</span></div>
    <ol class="slist">${S.stretches
      .map((st) => {
        const state = stateOf(st);
        const cur = st.status === "training" ? ' aria-current="true"' : "";
        return `<li class="srow-compact s-${state}"${cur}><span class="sn">${st.i + 1}</span><span class="sm">${st.from}-${st.to} m</span>${chip(state)}</li>`;
      })
      .join("")}</ol>`;
}

function trainBody() {
  const st = S.stretches[S.cur];
  const p = st.t / durOf(st);
  const plan = PLAN[st.i];
  const sharp = SHARPNESS[plan.verdict] * easeOut(p);
  const banner = S.resumed
    ? `<p class="callout callout-info" role="status">Carried on where you stopped. The ${counts().done} finished stretches were kept; training continues with stretch ${S.cur + 1}.</p>`
    : "";
  const toast =
    S.toast !== null
      ? `<div class="callout callout-danger callout-slim" role="status"><p><strong>Stretch ${S.toast + 1} is not good enough.</strong> Training goes on. You decide what to do with it when all stretches are done.</p></div>`
      : "";
  const controls = S.confirmCancel
    ? `<div class="confirm" role="alert">
        <p><strong>Stop training now?</strong> The ${counts().done} finished stretches are kept on this computer. Stretch ${S.cur + 1} has not finished and starts again when you carry on.</p>
        <div class="actions">
          <button type="button" class="btn btn-danger" data-act="cancel-yes">Stop training</button>
          <button type="button" class="btn btn-primary" data-act="cancel-no">Keep training</button>
        </div>
      </div>`
    : `<div class="actions">
        <button type="button" class="btn" data-act="cancel">Stop training</button>
        <span class="hint">You can use other tabs meanwhile. Keep this one open.</span>
      </div>`;
  return `${banner}${toast}
    <div class="now">
      <figure class="now-preview">
        ${canvas("preview", 420, 280, st.i + 1, sharp)}
        <figcaption><span class="pulse" aria-hidden="true"></span><span>Preview of this stretch, new every 15 s. <span id="age">Last one ${Math.floor(S.previewAge)} s ago.</span></span></figcaption>
      </figure>
      <div class="now-info">
        <p class="label accent">Now training</p>
        <h3 class="now-title">Stretch ${st.i + 1} of ${PLAN.length}</h3>
        <p class="hint">${st.from} to ${st.to} m along the walk, ${st.photos} photos</p>
        <div class="bar bar-big" role="progressbar" aria-label="This stretch" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}" id="st-bar-wrap"><span id="st-bar" style="width:${(p * 100).toFixed(1)}%"></span></div>
        <dl class="times">
          <div><dt>This stretch, <span id="st-pct">${Math.round(p * 100)} %</span></dt><dd id="st-left">${stretchLeftText(st)}</dd></div>
          <div><dt>All stretches</dt><dd id="all-left">${allLeftText()}</dd></div>
        </dl>
        <p class="heartbeat" id="beat">Working. ${fmtSoFar(S.stretchClock)} on this stretch.</p>
        ${controls}
      </div>
    </div>
    ${stretchList()}`;
}

function stretchLeftText(st) {
  const left = durOf(st) - st.t;
  return `${fmtLeft(left)} left`;
}

function allLeftText() {
  if (S.cur === 0 && S.stretchClock < 10 && !S.resumed)
    return "working out the time...";
  return `${fmtLeft(totalLeft())} left`;
}

function cancelledBody() {
  const done = counts().done;
  return `<div class="callout callout-info stopped">
      <h3>Training stopped</h3>
      <p>The ${done} finished stretches are kept on this computer. Stretch ${S.cur + 1} had not finished; it starts again when you carry on.</p>
      <p class="hint">You can also close this page. Next time, choose the same recording file and the page carries on from stretch ${S.cur + 1}.</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-act="resume">Carry on training (${fmtLeft(totalLeft())})</button>
      </div>
    </div>
    ${stretchList()}`;
}

function reviewBody() {
  const c = counts();
  const undecided = S.stretches.filter(
    (st) => st.verdict === "bad" && !st.decision && st.status === "done",
  );
  const retraining = S.stretches.some((st) => st.status === "retraining");
  const summary = `<p class="tally">
      ${chip("good", `: ${c.good}`)} ${chip("weak", `: ${c.weak}`)} ${c.bad ? chip("bad", `: ${c.bad}`) : ""} ${c.discarded ? chip("discarded", `: ${c.discarded}`) : ""}
    </p>`;
  const rows = S.stretches.map((st) => reviewRow(st)).join("");
  const blockText = retraining
    ? "Wait for the stretch that is training again."
    : undecided.length
      ? `Decide what to do with stretch ${undecided.map((s) => s.i + 1).join(", ")} first.`
      : "";
  const sel = S.open !== null ? S.stretches[S.open] : null;
  const selected = sel
    ? `<section class="selected r-${stateOf(sel)}" aria-label="Stretch ${sel.i + 1}">
        <div class="sel-head"><h3>Stretch ${sel.i + 1} <span class="hint">${sel.from} to ${sel.to} m along the walk</span></h3>${chip(stateOf(sel))}</div>
        ${detail(sel)}
      </section>`
    : `<p class="hint">Click a stretch above or below to look at it.</p>`;
  return `${summary}
    <p>Where each stretch lies along the walk. Click one to look at it.</p>
    ${ribbon(true)}
    ${selected}
    <h3 class="label list-label">All stretches</h3>
    <ol class="rlist">${rows}</ol>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-act="to-save" ${blockText ? "disabled" : ""}>Continue to save</button>
      <span class="hint" role="status">${blockText}</span>
    </div>`;
}

function reviewRow(st) {
  const state = stateOf(st);
  const open = S.open === st.i;
  const sharp =
    st.decision === "discard" ? 0.2 : SHARPNESS[st.verdict || "good"];
  const tag =
    st.decision === "mark"
      ? '<span class="tag">Kept, marked as not good enough</span>'
      : "";
  return `<li class="rrow r-${state}${open ? " is-open" : ""}">
    <button type="button" class="rhead" data-open="${st.i}" aria-pressed="${open}">
      ${canvas("thumb", 72, 48, st.i + 1, sharp)}
      <span class="rtext"><span class="rname">Stretch ${st.i + 1}</span><span class="rmeta">${st.from}-${st.to} m</span></span>
      ${chip(state)}
    </button>
    ${tag}
  </li>`;
}

const retrainDur = () => RETRAIN_S * (S.slow ? SLOW_FACTOR : 1);

function retrainingDetail(st) {
  const p = st.retrainT / retrainDur();
  const sharp = SHARPNESS.bad + (SHARPNESS.weak - SHARPNESS.bad) * easeOut(p);
  return `<div class="rd-grid">
      ${canvas("rd-preview", 300, 200, st.i + 1, sharp)}
      <div>
        <p><strong>Training this stretch again with more time.</strong> The other stretches are not touched.</p>
        <div class="bar"><span id="rt-bar" style="width:${(p * 100).toFixed(1)}%"></span></div>
        <p class="hint" id="rt-text">${fmtLeft(retrainDur() - st.retrainT)} left</p>
      </div>
    </div>`;
}

function detailActions(st) {
  const retrain = `Train again with more time (${fmtLeft(retrainDur())})`;
  if (st.decision === "discard") {
    return `<p>This stretch is left out of the file. The rest of the walk is not affected.</p>
      <div class="actions"><button type="button" class="btn" data-act="undo" data-i="${st.i}">Undo, keep it</button></div>`;
  }
  if (st.verdict === "bad") {
    const marked = st.decision === "mark";
    return `<h4 class="label">What you can do</h4>
      <div class="actions actions-col">
        <button type="button" class="btn btn-primary" data-act="retrain" data-i="${st.i}">${retrain}</button>
        <button type="button" class="btn" data-act="mark" data-i="${st.i}" ${marked ? "disabled" : ""}>${marked ? "Kept, marked as not good enough" : "Save anyway, marked as not good enough"}</button>
        <button type="button" class="btn btn-quiet" data-act="discard" data-i="${st.i}">Leave it out of the file</button>
      </div>`;
  }
  if (st.verdict === "weak") {
    return `<div class="actions">
        <button type="button" class="btn" data-act="retrain" data-i="${st.i}">${retrain}</button>
        <button type="button" class="btn btn-quiet" data-act="discard" data-i="${st.i}">Leave it out</button>
      </div>`;
  }
  return "";
}

function detail(st) {
  if (st.status === "retraining") return retrainingDetail(st);
  const v = st.verdict;
  const [atPhotos, between] = NUMBERS[v];
  const reasons = st.reasons.length
    ? `<h4 class="label">Why</h4><ul class="reasons">${st.reasons.map((r) => `<li>${r}</li>`).join("")}</ul>`
    : "";
  const sharp = st.decision === "discard" ? 0.2 : SHARPNESS[v];
  return `<div class="rd-grid">
      ${canvas("rd-preview", 300, 200, st.i + 1, sharp)}
      <div>
        <p class="sentence">${SENTENCE[v]}</p>
        ${reasons}
        ${detailActions(st)}
        <details class="numbers"><summary>Numbers</summary>
          <p>Sharpness score at the photos: ${atPhotos} dB. Between the photos: ${between} dB. Higher is sharper.</p>
          <p>${st.photos} photos, ${st.to - st.from} m of the walk.</p>
        </details>
      </div>
    </div>`;
}

function saveBody() {
  const c = counts();
  const kept = PLAN.length - c.discarded;
  const marked = S.stretches.filter((s) => s.decision === "mark");
  const left = S.stretches.filter((s) => s.decision === "discard");
  const mb = kept * 84;
  const contents = `<ul class="contents">
      <li><strong>${kept} stretches</strong>: ${c.good} good, ${c.weak} weak${marked.length ? `, ${marked.length} marked as not good enough (stretch ${marked.map((s) => s.i + 1).join(", ")})` : ""}</li>
      ${left.length ? `<li>Left out: stretch ${left.map((s) => s.i + 1).join(", ")}</li>` : ""}
      <li>Size: about ${mb} MB</li>
    </ul>`;
  const privacy = `<div class="callout callout-warn">
      <h3>This file shows where you recorded</h3>
      <p>It holds the place in 3D and where it is on the map. Anyone you give the file to can see the place and find it.</p>
    </div>`;
  if (S.phase === "saved") {
    return `<div class="callout callout-ok" role="status">
        <h3>Saved</h3>
        <p>Saved as <span class="file-chip">${fileIcon()}splat-recording-2026-11-14.zip</span> (about ${mb} MB) in the folder you chose.</p>
        <h4 class="label">Next</h4>
        <p>In the tour editor, choose <strong>Add debug data</strong> and pick this file. It shows while you edit and is never part of the tour visitors get.</p>
      </div>
      <div class="cleanup">
        <p>${S.deleted ? "Training data deleted. Nothing is kept on this computer except your saved file." : "Training data kept on this computer, so you can save again: 1.1 GB."}</p>
        ${S.deleted ? "" : '<button type="button" class="btn btn-quiet" data-act="delete">Delete training data</button>'}
      </div>`;
  }
  const saving = S.phase === "saving";
  return `<p>One file with all kept stretches, for the tour editor.</p>
    ${contents}
    ${privacy}
    <div class="actions">
      <button type="button" class="btn btn-primary" data-act="save" ${saving ? "disabled" : ""}>${saving ? "Saving..." : "Save the file..."}</button>
      ${saving ? `<div class="bar bar-inline"><span id="save-bar" style="width:${(S.saveP * 100).toFixed(0)}%"></span></div><span class="hint" id="save-text">Writing the file, ${Math.round(S.saveP * 100)} %</span>` : '<span class="hint">You choose where it goes on your disk.</span>'}
    </div>`;
}

// How fast a preview sharpens with progress: slow at first, like training.
function easeOut(p) {
  return Math.min(1, Math.max(0, p)) ** 0.9;
}

// ---------- render ----------

let lastPhaseKey = "";

function stepItem(m) {
  const done = m.state === "done" || m.state === "finished";
  const open = m.state === "current" || m.state === "finished";
  const num = done
    ? `<span class="step-num done" aria-label="Done">${ICON.good}</span>`
    : `<span class="step-num">${m.n}</span>`;
  const change =
    m.n === 1 && m.state === "done" && S.phase === "census"
      ? '<button type="button" class="link-btn" data-act="restart">Change</button>'
      : "";
  const summary =
    m.state === "done" ? `<p class="step-summary">${m.summary}</p>` : "";
  const current = m.state === "current" ? 'aria-current="step"' : "";
  return `<li class="step is-${m.state}" ${current}>
      <div class="step-head">${num}<div class="step-text"><h2 class="step-title">${m.title}</h2>${summary}</div>${change}</div>
      ${open ? `<div class="step-body">${bodyFor(m.n)}</div>` : ""}
    </li>`;
}

function render() {
  const phone = S.refusal === "phone";
  $("#phone-refusal").hidden = !phone;
  $("#layout").hidden = phone;
  $(".top").hidden = phone;
  if (phone) return;

  $("#steps").innerHTML = stepMeta().map(stepItem).join("");
  drawCanvases();

  const key = `${S.phase}:${S.refusal}`;
  if (key !== lastPhaseKey) {
    lastPhaseKey = key;
    const cur = $(".step.is-current .step-head");
    if (cur) {
      const top = cur.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.55) {
        window.scrollTo({ top: scrollY + top - 16, behavior: "instant" });
      }
    }
  }
}

function drawCanvases() {
  for (const c of document.querySelectorAll("canvas[data-seed]")) {
    drawPreview(c, Number(c.dataset.seed), Number(c.dataset.sharp), 0);
  }
}

// Live updates touch only nodes that exist; a missing node is a no-op.
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setWidth(id, fraction) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${(fraction * 100).toFixed(1)}%`;
}

const LIVE = {
  reading() {
    setWidth("read-bar", S.reading);
    setText(
      "read-text",
      `Looked at ${Math.round(S.reading * PHOTOS)} of ${PHOTOS} photos`,
    );
  },
  training() {
    const st = S.stretches[S.cur];
    const p = st.t / durOf(st);
    setWidth("st-bar", p);
    $("#st-bar-wrap")?.setAttribute(
      "aria-valuenow",
      String(Math.round(p * 100)),
    );
    setText("st-pct", `${Math.round(p * 100)} %`);
    setText("st-left", stretchLeftText(st));
    setText("all-left", allLeftText());
    setText("beat", `Working. ${fmtSoFar(S.stretchClock)} on this stretch.`);
    setText("age", `Last one ${Math.floor(S.previewAge)} s ago.`);
  },
  saving() {
    setWidth("save-bar", S.saveP);
    setText("save-text", `Writing the file, ${Math.round(S.saveP * 100)} %`);
  },
  review() {
    const rt = S.stretches.find((s) => s.status === "retraining");
    if (!rt || S.open !== rt.i) return;
    setWidth("rt-bar", rt.retrainT / retrainDur());
    setText("rt-text", `${fmtLeft(retrainDur() - rt.retrainT)} left`);
  },
};

function updateLive() {
  LIVE[S.phase]?.();
}

function redrawTrainingPreview() {
  const c = $("canvas.preview");
  if (!c) return;
  const st = S.stretches[S.cur];
  const sharp =
    SHARPNESS[PLAN[st.i].verdict] * easeOut(st.t / Math.max(1, durOf(st)));
  st.previewFrame++;
  drawPreview(c, st.i + 1, sharp, st.previewFrame);
}

// ---------- simulation ----------

function finishStretch(st) {
  st.status = "done";
  st.t = durOf(st);
  st.verdict = PLAN[st.i].verdict;
  st.reasons = PLAN[st.i].reasons || [];
}

function startStretch(i) {
  S.cur = i;
  const st = S.stretches[i];
  st.status = "training";
  st.t = 0;
  S.stretchClock = 0;
  S.previewAge = 0;
}

function endOfStretch(st) {
  finishStretch(st);
  if (st.verdict === "bad") S.toast = st.i;
  S.confirmCancel = false;
  if (S.cur + 1 < PLAN.length) {
    startStretch(S.cur + 1);
    return;
  }
  S.phase = "review";
  S.toast = null;
  S.resumed = false;
  const bad = S.stretches.find((s) => s.verdict === "bad");
  S.open = bad ? bad.i : null;
}

function endOfRetrain(rt) {
  rt.status = "done";
  rt.decision = null;
  if (rt.verdict === "bad") {
    rt.verdict = "weak";
    rt.reasons = [
      "Better after more time, still a little soft: the photos are far apart here",
    ];
  } else {
    rt.verdict = "good";
    rt.reasons = [];
  }
}

// Each returns true when the phase or the page structure changed.
const STEP = {
  reading(dt) {
    S.reading = Math.min(1, S.reading + dt / 2.5);
    if (S.reading < 1) return false;
    S.phase = "census";
    return true;
  },
  saving(dt) {
    S.saveP = Math.min(1, S.saveP + dt / 3);
    if (S.saveP < 1) return false;
    S.phase = "saved";
    return true;
  },
  training(dt) {
    const simDt = dt * S.speed;
    const st = S.stretches[S.cur];
    st.t += simDt;
    S.stretchClock += simDt;
    S.previewAge += simDt;
    S.runClock += simDt;
    if (st.t >= durOf(st)) {
      endOfStretch(st);
      return true;
    }
    if (S.previewAge >= PREVIEW_EVERY_S) {
      S.previewAge %= PREVIEW_EVERY_S;
      redrawTrainingPreview();
    }
    return false;
  },
  review(dt) {
    const rt = S.stretches.find((s) => s.status === "retraining");
    if (!rt) return false;
    rt.retrainT += dt * S.speed;
    if (rt.retrainT < retrainDur()) return false;
    endOfRetrain(rt);
    return true;
  },
};

function step(dt) {
  const fn = STEP[S.phase];
  if (!fn) return;
  if (fn(dt)) render();
  else updateLive();
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!S.paused) step(dt);
  requestAnimationFrame(loop);
}

// ---------- actions ----------

function startTraining(slow) {
  S.slow = slow;
  S.gpuWarn = false;
  S.phase = "training";
  startStretch(0);
}

const ACTIONS = {
  choose() {
    S.phase = "reading";
    S.reading = 0;
  },
  start: () => startTraining(false),
  "start-slow": () => startTraining(true),
  "gpu-check"() {
    S.gpuWarn = false;
    S.gpuChecked = true;
  },
  "webgpu-check"() {
    S.webgpuCheck = "Checked again: still not available in this browser.";
  },
  cancel() {
    S.confirmCancel = true;
  },
  "cancel-no"() {
    S.confirmCancel = false;
  },
  "cancel-yes"() {
    const st = S.stretches[S.cur];
    st.status = "waiting";
    st.t = 0;
    S.confirmCancel = false;
    S.toast = null;
    S.resumed = false;
    S.phase = "cancelled";
  },
  resume() {
    S.phase = "training";
    S.resumed = true;
    startStretch(S.cur);
  },
  retrain(i) {
    const st = S.stretches[i];
    st.status = "retraining";
    st.retrainT = 0;
    st.decision = null;
    S.open = i;
  },
  mark(i) {
    S.stretches[i].decision = "mark";
  },
  discard(i) {
    S.stretches[i].decision = "discard";
  },
  undo(i) {
    S.stretches[i].decision = null;
  },
  "to-save"() {
    S.phase = "save";
    S.open = null;
  },
  save() {
    S.phase = "saving";
    S.saveP = 0;
  },
  delete() {
    S.deleted = true;
  },
};

function act(name, el) {
  if (name === "restart") {
    jump("start");
    return;
  }
  const fn = ACTIONS[name];
  if (!fn) return;
  fn(el.dataset.i !== undefined ? Number(el.dataset.i) : null);
  render();
}

document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const a = target.closest("[data-act]");
  if (a && !a.disabled) {
    act(a.dataset.act, a);
    return;
  }
  const o = target.closest("[data-open]");
  if (o && S.phase === "review") {
    const i = Number(o.dataset.open);
    S.open = S.open === i ? null : i;
    render();
    const panel = $(".selected");
    if (panel && o.classList.contains("rhead")) {
      panel.scrollIntoView({ block: "nearest" });
    }
  }
});

document.addEventListener("dragover", (e) => {
  if (S.phase === "choose" && !S.refusal) e.preventDefault();
});
document.addEventListener("drop", (e) => {
  // Prototype: a dropped file is not read; it starts the scripted run.
  e.preventDefault();
  if (S.phase === "choose" && !S.refusal) act("choose", document.body);
});

// ---------- jump to state ----------

function finishFirst(n) {
  for (let i = 0; i < n; i++) finishStretch(S.stretches[i]);
}

function trainingAt(i, t) {
  finishFirst(i);
  S.phase = "training";
  startStretch(i);
  S.stretches[i].t = t;
  S.stretchClock = t;
}

function midStretch5() {
  trainingAt(4, durOf(S.stretches[4]) * 0.38);
  S.previewAge = 6;
}

function reviewAll() {
  finishFirst(PLAN.length);
  S.phase = "review";
  S.open = 6;
}

function savePhase(phase) {
  finishFirst(PLAN.length);
  S.stretches[6].decision = "mark";
  S.phase = phase;
  S.saveP = 0.45;
}

const JUMPS = {
  start() {},
  reading() {
    S.phase = "reading";
    S.reading = 0.42;
  },
  census() {
    S.phase = "census";
  },
  "gpu-warning"() {
    S.phase = "census";
    S.gpuWarn = true;
  },
  training: midStretch5,
  "cancel-confirm"() {
    midStretch5();
    S.confirmCancel = true;
  },
  "not-good"() {
    trainingAt(7, 8);
    S.toast = 6;
  },
  cancelled() {
    finishFirst(4);
    S.cur = 4;
    S.phase = "cancelled";
  },
  resumed() {
    trainingAt(4, 20);
    S.resumed = true;
  },
  review: reviewAll,
  retraining() {
    reviewAll();
    S.stretches[6].status = "retraining";
    S.stretches[6].retrainT = RETRAIN_S * 0.4;
  },
  save: () => savePhase("save"),
  saving: () => savePhase("saving"),
  saved: () => savePhase("saved"),
  "refusal-phone"() {
    S.refusal = "phone";
  },
  "refusal-webgpu"() {
    S.refusal = "webgpu";
  },
  "refusal-old"() {
    S.refusal = "old";
  },
  "refusal-nodepth"() {
    S.refusal = "nodepth";
  },
};

function jump(name) {
  const keep = { speed: S ? S.speed : 60, paused: S ? S.paused : false };
  baseline();
  Object.assign(S, keep);
  (JUMPS[name] || JUMPS.start)();
  $("#ctl-state").value = name;
  lastPhaseKey = "";
  render();
}

// ---------- prototype controls ----------

function applyTheme(v) {
  if (v === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", v);
}

function initControls() {
  const params = new URLSearchParams(location.search);
  const sel = $("#ctl-state");
  sel.innerHTML = STATES.map(
    ([v, l]) => `<option value="${v}">${l}</option>`,
  ).join("");
  sel.addEventListener("change", () => jump(sel.value));

  const speed = $("#ctl-speed");
  if (params.get("speed")) speed.value = params.get("speed");
  speed.addEventListener("change", () => {
    S.speed = Number(speed.value) || 60;
  });

  const theme = $("#ctl-theme");
  const t = params.get("theme");
  if (t === "light" || t === "dark") theme.value = t;
  applyTheme(theme.value);
  theme.addEventListener("change", () => applyTheme(theme.value));

  const pause = $("#ctl-pause");
  pause.checked = params.get("pause") === "1";
  pause.addEventListener("change", () => {
    S.paused = pause.checked;
  });

  const toggle = $("#dock-toggle");
  const setDock = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    $("#dock-body").hidden = !open;
    $("#dock").classList.toggle("is-closed", !open);
  };
  setDock(params.get("controls") !== "closed");
  toggle.addEventListener("click", () =>
    setDock(toggle.getAttribute("aria-expanded") !== "true"),
  );

  $("#copy-link").addEventListener("click", async () => {
    const status = $("#copy-link-status");
    try {
      await navigator.clipboard.writeText(location.href);
      status.textContent = "Link copied. Send it to yourself.";
    } catch {
      status.textContent =
        "Copying did not work here. The address is in the address bar.";
    }
  });

  return {
    state:
      params.get("state") ||
      (matchMedia("(max-width: 600px)").matches ? "refusal-phone" : "start"),
    speed: Number(speed.value) || 60,
    paused: pause.checked,
  };
}

const init = initControls();
S = { speed: init.speed, paused: init.paused };
jump(STATES.some(([v]) => v === init.state) ? init.state : "start");
requestAnimationFrame(loop);
