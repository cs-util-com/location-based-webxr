/**
 * The messages between the character maker's page and the cut's module
 * Worker (`character-cut.worker.ts`), in a module of their own (no DOM, no
 * `new Worker`) so the Worker, its service (`cut-service.ts`), the page's
 * client (`cut-client.ts`) and the tests share one shape and one check of
 * what arrives.
 *
 * @see cut-protocol.ts.md
 */

import type { RgbaImage } from "./rgba-image.js";
import type { SheetAnalysis, PhaseState } from "./sheet-analyze.js";
import type { CutErrorCode, CutPhase } from "./sheet-cut.js";

/** page to Worker: cut a picture. With `picture` the Worker decodes it and
 *  keeps it as the current picture; without, it cuts the picture it kept
 *  (an "Adjust the cut" slider moved). */
export interface CutRequest {
  readonly type: "cut";
  /** Correlation id, echoed by every answer. */
  readonly job: number;
  readonly picture?: Blob;
  /** Read through `cutSettingsOf` on the Worker's side. */
  readonly settings: unknown;
}

/** `data` as a cut request, or null for anything else (the Worker ignores
 *  those). */
export function requestOf(data: unknown): CutRequest | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const m = data as Partial<Record<string, unknown>>;
  if (
    m.type !== "cut" ||
    typeof m.job !== "number" ||
    !Number.isSafeInteger(m.job)
  ) {
    return null;
  }
  if (m.picture !== undefined && !(m.picture instanceof Blob)) {
    return null;
  }
  return {
    type: "cut",
    job: m.job,
    settings: m.settings,
    ...(m.picture === undefined ? {} : { picture: m.picture }),
  };
}

interface PhaseMessage {
  readonly type: "phase";
  readonly job: number;
  readonly phase: CutPhase;
  readonly state: PhaseState;
  readonly note?: string;
}

interface DoneMessage {
  readonly type: "done";
  readonly job: number;
  readonly result: SheetAnalysis;
}

/** A refusal (`CutError`) keeps its phase and code; any other failure is
 *  `code: "failed"` in the phase that was running. */
interface FailedMessage {
  readonly type: "failed";
  readonly job: number;
  readonly phase: CutPhase;
  readonly code: CutErrorCode | "failed";
  readonly message: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export type CutAnswer = PhaseMessage | DoneMessage | FailedMessage;

const PHASES: ReadonlySet<string> = new Set([
  "read",
  "background",
  "poses",
  "align",
  "check",
]);
const STATES: ReadonlySet<string> = new Set(["running", "done", "failed"]);

function isImage(v: unknown, w?: number, h?: number): v is RgbaImage {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const img = v as Partial<Record<string, unknown>>;
  return (
    Number.isSafeInteger(img.width) &&
    Number.isSafeInteger(img.height) &&
    (w === undefined || img.width === w) &&
    (h === undefined || img.height === h) &&
    img.data instanceof Uint8ClampedArray &&
    img.data.length === (img.width as number) * (img.height as number) * 4
  );
}

/** Four frames of one size. */
function isFrames(v: unknown): v is RgbaImage[] {
  if (!Array.isArray(v) || v.length !== 4 || !isImage(v[0])) {
    return false;
  }
  const { width, height } = v[0];
  return v.every((f) => isImage(f, width, height));
}

function isResult(v: unknown): v is SheetAnalysis {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const r = v as Partial<Record<string, unknown>>;
  return (
    isFrames(r.frames) &&
    isFrames(r.steadyFrames) &&
    typeof r.check === "object" &&
    r.check !== null &&
    (r.mode === "alpha" || r.mode === "white") &&
    Array.isArray(r.gaps) &&
    typeof r.size === "object" &&
    r.size !== null &&
    Number.isSafeInteger(r.specks) &&
    (r.specks as number) >= 0
  );
}

function isPhaseMessage(m: Partial<Record<string, unknown>>): boolean {
  return (
    typeof m.phase === "string" &&
    PHASES.has(m.phase) &&
    typeof m.state === "string" &&
    STATES.has(m.state) &&
    (m.note === undefined || typeof m.note === "string")
  );
}

function isFailedMessage(m: Partial<Record<string, unknown>>): boolean {
  return (
    typeof m.phase === "string" &&
    PHASES.has(m.phase) &&
    typeof m.code === "string" &&
    typeof m.message === "string" &&
    typeof m.detail === "object" &&
    m.detail !== null
  );
}

/** `data` as a Worker answer, or null for anything that does not read
 *  (the page ignores those). A "done" whose result does not read becomes a
 *  failure of its job, so the page is never left waiting. */
export function answerOf(data: unknown): CutAnswer | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const m = data as Partial<Record<string, unknown>>;
  if (typeof m.job !== "number") {
    return null;
  }
  if (m.type === "done" && !isResult(m.result)) {
    return {
      type: "failed",
      job: m.job,
      phase: "check",
      code: "failed",
      message: "The cut answered with frames that do not read.",
      detail: {},
    };
  }
  const ok =
    (m.type === "phase" && isPhaseMessage(m)) ||
    (m.type === "done" && isResult(m.result)) ||
    (m.type === "failed" && isFailedMessage(m));
  return ok ? (data as CutAnswer) : null;
}

/** The buffers of a result, each once, for the transfer list. */
export function transferOf(result: SheetAnalysis): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const f of [...result.frames, ...result.steadyFrames]) {
    buffers.add(f.data.buffer as ArrayBuffer);
  }
  return [...buffers];
}
