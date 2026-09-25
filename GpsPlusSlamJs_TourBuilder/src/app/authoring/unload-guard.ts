/**
 * `beforeunload` guard for the composed Authoring flow (plan
 * `plans/2026-08-14-authoring-composition-plan.md`, AC12). Reimplements the
 * `enable`/`disableBeforeUnloadWarning` idiom `GpsPlusSlamJs_RecorderApp`'s
 * `src/ui/navigation.ts` already uses — not imported, since apps don't
 * depend on each other's app-level code (only on the shared framework).
 */

let handler: ((event: BeforeUnloadEvent) => void) | null = null;

/**
 * Warns before the tab closes/navigates away while `shouldWarn()` is true.
 * Evaluated on every `beforeunload` fire, not just at registration — the
 * draft's empty/exported state changes over the session. Idempotent.
 */
export function enableBeforeUnloadWarning(shouldWarn: () => boolean): void {
  if (handler) return;
  handler = (event) => {
    if (!shouldWarn()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", handler);
}

export function disableBeforeUnloadWarning(): void {
  if (!handler) return;
  window.removeEventListener("beforeunload", handler);
  handler = null;
}
