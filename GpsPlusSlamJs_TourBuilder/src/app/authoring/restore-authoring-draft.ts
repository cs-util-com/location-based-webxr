/**
 * Durable authoring draft (plan
 * `plans/2026-08-14-authoring-composition-plan.md`, AC10 — redesigned during
 * review, see the plan's decision note).
 *
 * A real author walks a route for 10–30+ min; the authoring store is RAM-only
 * (no rehydration path — `src/store/authoring-store.ts`). This module writes
 * every `authoring/*` action to OPFS as it's dispatched, and can replay a
 * prior session's actions back into a live store after a crash/reload.
 *
 * Deliberately bypasses `OpfsStorageBackend` / `createAuthoringStore`'s
 * `storageBackend` option and the framework's `recording` slice + persistence
 * middleware: that machinery only persists while `recording.isRecording` is
 * true, and doing so would ALSO start writing unrelated framework actions
 * (e.g. raw `gpsData` GPS-fix events) to disk for the whole session — a
 * side effect with no relation to "keep my waypoint draft safe." Instead this
 * calls the same low-level OPFS primitives `OpfsStorageBackend` itself calls
 * (`initOpfsStorage`, `createSession`, `writeAction`, `listSessions`,
 * `getSessionsRootHandle`, `setSessionHandles`), scoped to exactly the
 * `authoring/*` actions this feature cares about.
 *
 * Feature-detected and non-fatal throughout (same philosophy as
 * `wake-lock.ts`): an unsupported/unavailable OPFS degrades to "no draft
 * durability," never a crash.
 */
import {
  createSession as opfsCreateSession,
  getSessionsRootHandle,
  initOpfsStorage,
  listSessions as opfsListSessions,
  setSessionHandles as opfsSetSessionHandles,
  writeAction as opfsWriteAction,
} from "gps-plus-slam-app-framework/storage/opfs-storage";
import { SESSION_IMAGES_DIR } from "gps-plus-slam-app-framework/storage/file-system-utils";

const AUTHORING_PREFIX = "authoring/";

/** The minimal shape every Redux action satisfies — real actions carry more. */
export interface ActionLike {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface DurableAuthoringSession {
  /** Empty string when OPFS is unsupported/unavailable (no-op session). */
  readonly sessionName: string;
  /**
   * Wraps `dispatch`: every call still goes straight through to it (so
   * behavior is unchanged), and every `authoring/*` action is additionally
   * written to this session's OPFS `actions/` directory, fire-and-forget.
   */
  wrapDispatch<A extends ActionLike>(
    dispatch: (action: A) => unknown,
  ): (action: A) => unknown;
  /** Resolves once every write enqueued so far has settled. */
  flush(): Promise<void>;
  /** Deletes this session's OPFS directory — nothing left to resume. */
  discard(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuthoringAction(action: unknown): action is ActionLike {
  return (
    isRecord(action) &&
    typeof action["type"] === "string" &&
    action["type"].startsWith(AUTHORING_PREFIX)
  );
}

async function countFiles(dir: FileSystemDirectoryHandle): Promise<number> {
  let count = 0;
  for await (const entry of dir.values()) {
    if (entry.kind === "file") count += 1;
  }
  return count;
}

/** Finds the most recently created leftover session, if any. Never throws. */
export async function findResumableDraft(): Promise<string | null> {
  try {
    await initOpfsStorage();
    const sessions = await opfsListSessions();
    return sessions.length > 0 ? (sessions[sessions.length - 1] ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Replays a session's `authoring/*` actions, in order, through `dispatch` —
 * reconstructing the draft exactly as it stood before the interruption.
 * Non-`authoring/*` actions in the log (there should be none, since this
 * module never writes any) are skipped defensively. No-op if the session or
 * OPFS itself is unavailable.
 */
export async function restoreAuthoringDraft(
  dispatch: (action: ActionLike) => unknown,
  sessionName: string,
): Promise<void> {
  const sessionsRoot = getSessionsRootHandle();
  if (!sessionsRoot) return;
  const sessionHandle = await sessionsRoot.getDirectoryHandle(sessionName);
  const actionsHandle = await sessionHandle.getDirectoryHandle("actions");

  const fileNames: string[] = [];
  for await (const entry of actionsHandle.values()) {
    if (entry.kind === "file") fileNames.push(entry.name);
  }
  fileNames.sort(); // zero-padded 6-digit names sort chronologically as strings

  for (const name of fileNames) {
    const fileHandle = await actionsHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    const action: unknown = JSON.parse(await file.text());
    if (isAuthoringAction(action)) dispatch(action);
  }
}

/** Deletes a session's OPFS directory. No-op (never throws) if it's gone. */
export async function discardDraft(sessionName: string): Promise<void> {
  const sessionsRoot = getSessionsRootHandle();
  if (!sessionsRoot) return;
  try {
    await sessionsRoot.removeEntry(sessionName, { recursive: true });
  } catch {
    // best-effort cleanup — a leftover directory is harmless
  }
}

const noopSession: DurableAuthoringSession = {
  sessionName: "",
  wrapDispatch: (dispatch) => dispatch,
  flush: () => Promise.resolve(),
  discard: () => Promise.resolve(),
};

/**
 * Starts (or resumes) durable writing of `authoring/*` actions to OPFS.
 * Pass `existingSessionName` to keep appending to a session found by
 * `findResumableDraft` (so a second interruption can still replay
 * everything from the start, not just what happened after resuming).
 */
export async function beginDurableAuthoringSession(
  existingSessionName?: string,
): Promise<DurableAuthoringSession> {
  try {
    await initOpfsStorage();

    let sessionName: string;
    let nextIndex: number;

    if (existingSessionName) {
      const sessionsRoot = getSessionsRootHandle();
      if (!sessionsRoot) throw new Error("OPFS sessions root unavailable");
      const sessionHandle =
        await sessionsRoot.getDirectoryHandle(existingSessionName);
      const actionsHandle = await sessionHandle.getDirectoryHandle("actions");
      const framesHandle = await sessionHandle.getDirectoryHandle(
        SESSION_IMAGES_DIR,
        { create: true },
      );
      opfsSetSessionHandles(sessionHandle, actionsHandle, framesHandle);
      sessionName = existingSessionName;
      nextIndex = (await countFiles(actionsHandle)) + 1;
    } else {
      const result = await opfsCreateSession(new Date());
      sessionName = result.sessionName;
      nextIndex = 1;
    }

    const pendingWrites = new Set<Promise<void>>();

    async function flush(): Promise<void> {
      await Promise.all(pendingWrites);
    }

    return {
      sessionName,
      wrapDispatch(dispatch) {
        return (action) => {
          const result = dispatch(action);
          if (isAuthoringAction(action)) {
            const index = nextIndex++;
            const write = opfsWriteAction(action, index)
              .catch(() => {
                // best-effort: a failed durability write must not break the
                // live session the author is actively working in
              })
              .finally(() => pendingWrites.delete(write));
            pendingWrites.add(write);
          }
          return result;
        };
      },
      flush,
      async discard() {
        await flush();
        await discardDraft(sessionName);
      },
    };
  } catch {
    return noopSession;
  }
}
