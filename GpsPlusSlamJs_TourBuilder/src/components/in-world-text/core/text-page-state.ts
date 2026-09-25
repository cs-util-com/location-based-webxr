/**
 * Pure page-navigation state for the in-world text label.
 *
 * The single source of truth for "which page is showing", driven by a small
 * reducer (mirrors component 1's transport reducer). It is *hosted inside each
 * label* rather than a shared store, because page position is per-label,
 * ephemeral view state that no tour/Redux slice should own (plan D10).
 *
 * Pure input → output: no Three.js, no DOM.
 */

export interface TextPageState {
  readonly pageIndex: number; // 0-based
  readonly pageCount: number; // always >= 1
}

export type TextPageAction =
  | { readonly type: "next" }
  | { readonly type: "prev" }
  | { readonly type: "setText"; readonly pageCount: number }; // resets to page 0

/** Initial state for a label with `pageCount` pages (clamped to >= 1). */
export function initialTextPageState(pageCount: number): TextPageState {
  return { pageIndex: 0, pageCount: Math.max(1, pageCount) };
}

export function textPageReducer(
  state: TextPageState,
  action: TextPageAction,
): TextPageState {
  switch (action.type) {
    case "next":
      return {
        ...state,
        pageIndex: Math.min(state.pageIndex + 1, state.pageCount - 1),
      };
    case "prev":
      return { ...state, pageIndex: Math.max(state.pageIndex - 1, 0) };
    case "setText":
      return { pageIndex: 0, pageCount: Math.max(1, action.pageCount) };
  }
}

/** Whether a Prev step is available (not on the first page). */
export function canPrev(state: TextPageState): boolean {
  return state.pageIndex > 0;
}

/** Whether a Next step is available (not on the last page). */
export function canNext(state: TextPageState): boolean {
  return state.pageIndex < state.pageCount - 1;
}

/** 1-based human label, e.g. "2 / 5". */
export function pageLabel(state: TextPageState): string {
  return `${state.pageIndex + 1} / ${state.pageCount}`;
}
