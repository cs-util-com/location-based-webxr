/**
 * The `?qrperf` "Copy JSON" action with honest async feedback.
 * See copy-report.ts.md.
 */

export const COPY_LABELS = {
  idle: "Copy perf JSON",
  busy: "Copying…",
  done: "Copied",
  failed: "Copy failed - screenshot instead",
} as const;

interface ButtonLike {
  textContent: string | null;
  disabled: boolean;
}

/**
 * Write `json` with `writeText` (normally `navigator.clipboard.writeText`),
 * showing a busy state and then the real outcome on `button`.
 */
export async function copyReport(
  button: ButtonLike,
  json: string,
  writeText: ((text: string) => Promise<void>) | undefined,
): Promise<void> {
  button.disabled = true;
  button.textContent = COPY_LABELS.busy;
  try {
    if (!writeText) throw new Error("clipboard API unavailable");
    await writeText(json);
    button.textContent = COPY_LABELS.done;
  } catch {
    button.textContent = COPY_LABELS.failed;
  } finally {
    button.disabled = false;
  }
}
