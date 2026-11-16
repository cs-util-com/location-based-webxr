// The bench's state: what the author has chosen and what the view shows,
// changed only through `benchReducer`, a pure function. The shelf's store
// can take it over as a slice as it stands. Three.js objects, Workers and
// the made files are resources, kept outside it (bench.js).
import { TEXTURE_STEPS, DEFAULT_TEXTURE_STEP } from "./bench-sizes.js";

export const INITIAL_BENCH = Object.freeze({
  /** Share of triangles kept up close, 1 to 100 (percent). */
  share: 100,
  /** The lowest share the model's order allows (percent). */
  minShare: 1,
  /** An id of `TEXTURE_STEPS`. */
  textureStep: DEFAULT_TEXTURE_STEP,
  webp: false,
  positions8: false,
  wireframe: false,
  /** "mine" or "original": which version the view draws. */
  showing: "mine",
  /** The visitor distance slider, 0 (up close) to 1000. */
  distance: 0,
  /** The detail drop slider, 0 (keep detail longest) to 100. */
  drop: 33,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** The next state; an action that does not apply returns `state` itself. */
export function benchReducer(state, action) {
  switch (action?.type) {
    case "loaded":
      return {
        ...state,
        share: 100,
        minShare: clamp(Math.ceil(action.minShare ?? 1), 1, 100),
        showing: "mine",
        distance: 0,
      };
    case "minShare": {
      if (!finite(action.value)) {
        return state;
      }
      const minShare = clamp(Math.ceil(action.value), 1, 100);
      return { ...state, minShare, share: Math.max(state.share, minShare) };
    }
    case "share":
      if (!finite(action.value)) {
        return state;
      }
      return {
        ...state,
        share: clamp(Math.round(action.value), state.minShare, 100),
      };
    case "textureStep":
      return TEXTURE_STEPS.some((s) => s.id === action.id)
        ? { ...state, textureStep: action.id }
        : state;
    case "toggle":
      if (!["webp", "positions8", "wireframe"].includes(action.name)) {
        return state;
      }
      return { ...state, [action.name]: Boolean(action.on) };
    case "show":
      return action.which === "mine" || action.which === "original"
        ? { ...state, showing: action.which }
        : state;
    case "flip":
      return {
        ...state,
        showing: state.showing === "mine" ? "original" : "mine",
      };
    case "distance":
      return finite(action.value)
        ? { ...state, distance: clamp(Math.round(action.value), 0, 1000) }
        : state;
    case "drop":
      return finite(action.value)
        ? { ...state, drop: clamp(Math.round(action.value), 0, 100) }
        : state;
    default:
      return state;
  }
}
