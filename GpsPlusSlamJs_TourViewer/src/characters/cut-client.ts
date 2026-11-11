/**
 * The page's side of the character-sheet cut Worker: `cut` sends a picture
 * (or, with none, re-cuts the one the Worker kept, when an "Adjust the cut"
 * slider moved), forwards each phase, and resolves with the analysis. One
 * cut runs at a time; a newer request waiting behind it replaces an older
 * waiting one (latest wins, the replaced one rejects as aborted). After a
 * crash every held cut rejects and the next spawns a fresh Worker, which is
 * sent the last picture again. The transport is tested with a fake Worker; the page that uses it
 * constructs the real one with
 * `new Worker(new URL("./character-cut.worker.ts", import.meta.url), { type: "module" })`.
 *
 * @see cut-client.ts.md
 */

import type { CutSettings } from "./cut-settings.js";
import { answerOf, type CutRequest } from "./cut-protocol.js";
import type { PhaseListener, SheetAnalysis } from "./sheet-analyze.js";
import type { CutErrorCode, CutPhase } from "./sheet-cut.js";

/** The part of a `Worker` the client uses, so a test can fake it. */
export interface CutWorker {
  postMessage(message: CutRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

/** A cut that failed: the phase and the code say where and why, the
 *  message is in the author's words. */
export class CutFailed extends Error {
  readonly phase: CutPhase;
  readonly code: CutErrorCode | "failed" | "crashed";
  readonly detail: Readonly<Record<string, unknown>>;
  constructor(
    phase: CutPhase,
    code: CutErrorCode | "failed" | "crashed",
    message: string,
    detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "CutFailed";
    this.phase = phase;
    this.code = code;
    this.detail = detail;
  }
}

export interface CutClient {
  /** Cuts `picture`, or with null the last picture again. */
  cut(
    picture: Blob | null,
    settings: Partial<CutSettings>,
    onPhase?: PhaseListener,
  ): Promise<SheetAnalysis>;
  /** Rejects every held cut as aborted and ends the Worker. */
  close(): void;
}

interface Request {
  readonly picture: Blob | null;
  readonly settings: Partial<CutSettings>;
  readonly onPhase: PhaseListener;
  readonly resolve: (result: SheetAnalysis) => void;
  readonly reject: (error: unknown) => void;
}

function aborted(): DOMException {
  return new DOMException("a newer cut replaced this one", "AbortError");
}

export function createCutClient(spawn: () => CutWorker): CutClient {
  let worker: CutWorker | null = null;
  /** The Worker holds `lastPicture` (false after a spawn). */
  let workerHasPicture = false;
  let lastPicture: Blob | null = null;
  let running: { job: number; request: Request } | null = null;
  let waiting: Request | null = null;
  let seq = 0;

  function dropAll(error: () => unknown): void {
    const dead = worker;
    worker = null;
    workerHasPicture = false;
    const held = [running?.request, waiting];
    running = null;
    waiting = null;
    for (const r of held) {
      r?.reject(error());
    }
    dead?.terminate();
  }

  function onAnswer(event: MessageEvent): void {
    const answer = answerOf(event.data);
    if (answer === null || running === null || answer.job !== running.job) {
      return;
    }
    const { request } = running;
    if (answer.type === "phase") {
      request.onPhase(answer.phase, answer.state, answer.note);
      return;
    }
    running = null;
    if (answer.type === "done") {
      request.resolve(answer.result);
    } else {
      request.reject(
        new CutFailed(answer.phase, answer.code, answer.message, answer.detail),
      );
    }
    startNext();
  }

  function live(): CutWorker {
    if (worker !== null) {
      return worker;
    }
    const spawned = spawn();
    spawned.onmessage = onAnswer;
    spawned.onerror = () => {
      if (worker === spawned) {
        dropAll(
          () =>
            new CutFailed(
              "read",
              "crashed",
              "The cut stopped unexpectedly. Try again; a smaller picture needs less memory.",
            ),
        );
      }
    };
    worker = spawned;
    workerHasPicture = false;
    return spawned;
  }

  function startNext(): void {
    const request = waiting;
    if (request === null || running !== null) {
      return;
    }
    waiting = null;
    let target: CutWorker;
    try {
      target = live();
    } catch (err) {
      request.reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (request.picture !== null) {
      lastPicture = request.picture;
    }
    const send = request.picture ?? (workerHasPicture ? null : lastPicture);
    const job = ++seq;
    running = { job, request };
    workerHasPicture = true;
    target.postMessage({
      type: "cut",
      job,
      settings: request.settings,
      ...(send === null ? {} : { picture: send }),
    });
  }

  return {
    cut(picture, settings, onPhase = () => {}) {
      return new Promise<SheetAnalysis>((resolve, reject) => {
        const older = waiting;
        // A replaced request's new picture is carried over, so a slider
        // moved before the picture's cut began still cuts that picture.
        const carried = picture ?? older?.picture ?? null;
        waiting = { picture: carried, settings, onPhase, resolve, reject };
        older?.reject(aborted());
        startNext();
      });
    },
    close() {
      dropAll(aborted);
    },
  };
}
