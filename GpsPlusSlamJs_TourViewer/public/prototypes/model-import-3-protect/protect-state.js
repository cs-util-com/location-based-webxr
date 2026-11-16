// The protect prototype's choices as a pure reducer, so an editor store
// can take it over as a slice unchanged. The author's marks are part of
// the document they make, so they live here as strokes of dabs; the
// per-vertex weights made from them are derived data and stay outside.
import { DEFAULT_PICTURE_STEP, DEFAULT_DISTANCE_PRESET, PICTURE_STEPS, DISTANCE_PRESETS } from "./protect-sizes.js";
import { DEFAULT_STRENGTH, DEFAULT_BRUSH, BRUSH_MIN, BRUSH_MAX, STRENGTHS } from "./protect-mask.js";

export const SHOWS = ["original", "mine", "unmarked"];
export const TOOLS = ["look", "mark", "erase"];

export function initialState() {
  return {
    share: 100,
    pictureStep: DEFAULT_PICTURE_STEP,
    webp: false,
    positions8: false,
    triangles: false,
    showMarks: true,
    show: "mine",
    tool: "look",
    brush: DEFAULT_BRUSH,
    strength: DEFAULT_STRENGTH,
    preset: DEFAULT_DISTANCE_PRESET,
    visitor: 0,
    strokes: [],
  };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);

/**
 * @param {ReturnType<typeof initialState>} state
 * @param {{ type: string, [k: string]: unknown }} action
 */
export function protectReducer(state, action) {
  switch (action?.type) {
    case "share": {
      const share = Math.round(Number(action.value));
      return Number.isFinite(share) ? { ...state, share: clamp(share, 1, 100) } : state;
    }
    case "pictureStep":
      return { ...state, pictureStep: oneOf(action.value, PICTURE_STEPS.map((s) => s.id), state.pictureStep) };
    case "toggle": {
      const key = action.key;
      if (!["webp", "positions8", "triangles", "showMarks"].includes(key)) {
        return state;
      }
      return { ...state, [key]: typeof action.value === "boolean" ? action.value : !state[key] };
    }
    case "show":
      return { ...state, show: oneOf(action.value, SHOWS, state.show) };
    case "tool":
      return { ...state, tool: oneOf(action.value, TOOLS, state.tool) };
    case "brush": {
      const brush = Number(action.value);
      return Number.isFinite(brush) ? { ...state, brush: clamp(brush, BRUSH_MIN, BRUSH_MAX) } : state;
    }
    case "strength":
      return { ...state, strength: oneOf(action.value, STRENGTHS.map((s) => s.id), state.strength) };
    case "preset":
      return { ...state, preset: oneOf(action.value, DISTANCE_PRESETS.map((p) => p.id), state.preset) };
    case "visitor": {
      const v = Number(action.value);
      return Number.isFinite(v) ? { ...state, visitor: clamp(v, 0, 1) } : state;
    }
    case "strokeStart":
      return { ...state, strokes: [...state.strokes, { erase: action.erase === true, dabs: [] }] };
    case "dab": {
      const last = state.strokes[state.strokes.length - 1];
      if (!last || !action.dab) {
        return state;
      }
      const stroke = { ...last, dabs: [...last.dabs, action.dab] };
      return { ...state, strokes: [...state.strokes.slice(0, -1), stroke] };
    }
    case "undo":
      return { ...state, strokes: state.strokes.slice(0, -1) };
    case "clear":
      return { ...state, strokes: [] };
    case "reset":
      return initialState();
    default:
      return state;
  }
}

/** Every dab of every stroke, in order, erase flags carried over. */
export function allDabs(state) {
  const out = [];
  for (const stroke of state.strokes) {
    for (const dab of stroke.dabs) {
      out.push({ ...dab, erase: stroke.erase });
    }
  }
  return out;
}
