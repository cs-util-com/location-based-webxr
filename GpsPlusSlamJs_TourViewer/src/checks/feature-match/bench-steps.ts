/**
 * The benchmark page's guided flow: which of its four steps (photo A,
 * photo B, run, save) is done, current or still to do.
 *
 * @see bench-steps.ts.md
 */

export type StepState = "done" | "current" | "todo";

/** What exists so far for the camera pair on the page. */
export interface FlowState {
  readonly a: boolean;
  readonly b: boolean;
  /** The run on this pair: none yet, running, finished, or thrown. */
  readonly run: "none" | "running" | "done" | "failed";
  /** The files of this pair and run were offered for saving. */
  readonly saved: boolean;
}

/**
 * The four steps' states. A step is done only when its work exists and
 * every earlier step is done; the first step that is not done is current.
 */
export function stepStates(
  f: FlowState,
): [StepState, StepState, StepState, StepState] {
  const done = [f.a, f.a && f.b, f.a && f.b && f.run === "done", false];
  done[3] = done[2]! && f.saved;
  const current = done.indexOf(false);
  return done.map((d, i): StepState =>
    d ? "done" : i === current ? "current" : "todo",
  ) as [StepState, StepState, StepState, StepState];
}
