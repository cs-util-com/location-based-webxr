/**
 * Will an action dispatched now reach the recording's `actions/`?
 *
 * Modelled on the framework persistence middleware's `readIsRecording`
 * (persistence-middleware.ts), the gate every persisted recorder dispatch is
 * subject to, but stricter: only `recording.isRecording === true` counts, so
 * a missing slice, a missing state or a non-boolean flag reads as false and a
 * tap is never confirmed on a guess. The stop window counts as ended: Stop
 * flushes and exports the zip for
 * seconds while `recording.isRecording` is still true, so a dispatch in that
 * window could land after the export listed `actions/`.
 *
 * One implementation for every handler that records something on a tap (the
 * reference-point mark, the phase marker), so they can never disagree about
 * when a tap still counts.
 *
 * @see recording-active.ts.md
 */
export function isRecordingActive(
  state: unknown,
  stopInProgress: boolean
): boolean {
  if (stopInProgress) return false;
  const recording = (state as { recording?: { isRecording?: unknown } } | null)
    ?.recording;
  return recording?.isRecording === true;
}
