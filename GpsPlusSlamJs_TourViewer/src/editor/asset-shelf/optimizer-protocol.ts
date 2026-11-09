/**
 * The messages between the page and the asset optimizer's module Worker
 * (`asset-optimizer.worker.ts`), in a module of their own (no DOM, no
 * `new Worker`) so the worker, its client (`optimizer-client.ts`) and the
 * tests share one shape - and the Worker's check of what it receives
 * (`inboundOf`).
 *
 * @see optimizer-protocol.ts.md
 */

import type { TourAssetKind } from "gps-plus-slam-app-framework/ar/tour-manifest";

import type { OptimizerSettings } from "./optimizer-settings.js";

/** page to worker: optimize `payload` (a file's bytes, or what the page
 *  decoded from them) as `kind`. */
interface RunMessage {
  readonly type: "run";
  /** Correlation id, echoed by every answer. */
  readonly job: number;
  readonly kind: TourAssetKind;
  readonly payload: unknown;
  readonly settings: OptimizerSettings;
}

/** page to worker: stop job `job` (its asset left, the tour closed). */
interface CancelMessage {
  readonly type: "cancel";
  readonly job: number;
}

export type OptimizerInbound = RunMessage | CancelMessage;

/** Every asset kind, so a run of another kind is refused. */
const KINDS: Readonly<Record<TourAssetKind, true>> = {
  image: true,
  audio: true,
  video: true,
  model: true,
};

/** `data` as a message the Worker takes, or null for anything else (a
 *  non-object, an unknown type, a job that is no whole number, a run of no
 *  known kind or without settings): the Worker ignores those. */
export function inboundOf(data: unknown): OptimizerInbound | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Partial<Record<string, unknown>>;
  if (typeof m.job !== "number" || !Number.isSafeInteger(m.job)) return null;
  if (m.type === "cancel") return { type: "cancel", job: m.job };
  if (
    m.type !== "run" ||
    typeof m.kind !== "string" ||
    !Object.hasOwn(KINDS, m.kind) ||
    typeof m.settings !== "object" ||
    m.settings === null
  ) {
    return null;
  }
  return data as RunMessage;
}

interface ProgressMessage {
  readonly type: "progress";
  readonly job: number;
  /** 0..1. */
  readonly fraction: number;
}

/** The smaller file, its extension and an image's new size. */
interface DoneMessage {
  readonly type: "done";
  readonly job: number;
  readonly blob: Blob;
  readonly extension: string;
  readonly width?: number;
  readonly height?: number;
}

/** The original stays, for `reason` (plain words). */
interface KeptMessage {
  readonly type: "kept";
  readonly job: number;
  readonly reason: string;
}

interface FailedMessage {
  readonly type: "failed";
  readonly job: number;
  readonly reason: string;
}

export type OptimizerOutbound =
  ProgressMessage | DoneMessage | KeptMessage | FailedMessage;
