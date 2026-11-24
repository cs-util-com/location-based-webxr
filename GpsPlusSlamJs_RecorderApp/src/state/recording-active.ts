/**
 * Will an action dispatched now reach the recording's `actions/`?
 *
 * A mirror of the framework persistence middleware's `readIsRecording`
 * (persistence-middleware.ts), the gate every persisted recorder dispatch is
 * subject to: a missing `recording` slice reads as false, exactly like the
 * gate. The stop window counts as ended: Stop flushes and exports the zip for
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
