// The guided model import's state: the order of the steps, where the
// author is, what each step left behind, and the author's choices. A pure
// reducer (no DOM, no three.js), so it can become a store slice as it is.
// Imperative resources (the scene, the helper threads, picture blobs) stay
// outside it, in the module that draws.

/** The steps, by id. "distance" is optional and always comes last. */
export const STEP_IDS = ["pictures", "shape", "distance"];

/** The choices a fresh import starts from: nothing changed yet. */
export const START_CHOICES = {
  /** Share of triangles kept, 1..100. */
  quality: 100,
  /** An id of TEXTURE_STEPS (size-model.js). */
  texture: "original",
  webp: false,
  positions8: false,
  /** How soon detail drops with distance, 1..100 (50 is the standard). */
  falloff: 50,
};

/** What "keep as it is" resets, per step. */
const KEEP = {
  pictures: { texture: "original", webp: false },
  shape: { quality: 100, positions8: false },
  distance: { falloff: 50 },
};

/** A fresh flow for a model whose bigger lever is `first`. `defaults` may
 *  start a choice elsewhere for this model (compact points are on when
 *  their error cannot be seen); unknown names are ignored. */
export function initialFlow(first, defaults = {}) {
  const order =
    first === "shape"
      ? ["shape", "pictures", "distance"]
      : ["pictures", "shape", "distance"];
  const choices = { ...START_CHOICES };
  for (const [name, value] of Object.entries(defaults ?? {})) {
    if (name in START_CHOICES && typeof value === typeof choices[name]) {
      choices[name] = value;
    }
  }
  return {
    recommended: first,
    order,
    current: order[0],
    status: { pictures: "todo", shape: "todo", distance: "todo" },
    choices,
    showOriginal: false,
    shapeLook: false,
    accepted: false,
  };
}

/** The first step after `from` in the order that is still to do, else
 *  "review". The optional last step always leads to the review: going on
 *  from it to a step the author left open looked as if the whole import
 *  had started again. */
function nextOpen(flow, status, from) {
  if (from === "distance") {
    return "review";
  }
  const at = flow.order.indexOf(from);
  for (let i = 1; i <= flow.order.length; i++) {
    const id = flow.order[(at + i) % flow.order.length];
    if (status[id] === "todo") {
      return id;
    }
  }
  return "review";
}

function finishStep(flow, how) {
  if (!STEP_IDS.includes(flow.current)) {
    return flow;
  }
  const status = { ...flow.status, [flow.current]: how };
  const choices =
    how === "kept" ? { ...flow.choices, ...KEEP[flow.current] } : flow.choices;
  return {
    ...flow,
    status,
    choices,
    current: nextOpen(flow, status, flow.current),
  };
}

function setChoice(flow, name, value) {
  if (!(name in START_CHOICES) || flow.choices[name] === value) {
    return flow;
  }
  return {
    ...flow,
    choices: { ...flow.choices, [name]: value },
    accepted: false,
  };
}

function swapOrder(flow) {
  // The first two steps trade places; the distance step stays last.
  const order = [flow.order[1], flow.order[0], flow.order[2]];
  const current = flow.status[order[0]] === "todo" ? order[0] : flow.current;
  return { ...flow, order, current };
}

const TOGGLES = ["showOriginal", "shapeLook"];

const ACTIONS = {
  go: (flow, a) =>
    STEP_IDS.includes(a.step) || a.step === "review"
      ? { ...flow, current: a.step }
      : flow,
  next: (flow) => finishStep(flow, "done"),
  keep: (flow) => finishStep(flow, "kept"),
  swap: swapOrder,
  set: (flow, a) => setChoice(flow, a.name, a.value),
  toggle: (flow, a) =>
    TOGGLES.includes(a.name) ? { ...flow, [a.name]: Boolean(a.on) } : flow,
  accept: (flow) => ({ ...flow, accepted: true }),
};

/** The next state; an action that does not apply returns `flow` itself. */
export function flowReducer(flow, action) {
  const handler = Object.hasOwn(ACTIONS, action?.type)
    ? ACTIONS[action.type]
    : null;
  return handler ? handler(flow, action) : flow;
}
