/**
 * The near clouds' bakes off the main thread: the worker's side (a shell
 * in each app hands it its `postMessage`, so a bundler sees a worker file
 * of its own) and the page's (one question, one answer, the worker ended).
 *
 * @see globe-cloud-bake-worker-core.ts.md
 */
import { type CloudBakes, bakeCloudTextures } from "./globe-cloud-bake.js";

/** Hands a reply to the page; `transfer` moves its buffers, not copies. */
type CloudBakePost = (
  message: unknown,
  transfer: readonly ArrayBufferLike[],
) => void;

interface CloudBakeWorkerCore {
  /** Takes a message from the page. */
  handle(message: unknown): void;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** The worker's side; `bake` is the real bake but for tests. */
export function createCloudBakeWorkerCore(
  post: CloudBakePost,
  bake: () => CloudBakes = bakeCloudTextures,
): CloudBakeWorkerCore {
  return {
    handle(message) {
      if (!isRecord(message) || message.kind !== "bake") return;
      try {
        const bakes = bake();
        const { shape, detail, domes, region, blue } = bakes;
        post({ kind: "bakes", bakes }, [
          shape.buffer,
          detail.buffer,
          domes.buffer,
          region.buffer,
          blue.buffer,
        ]);
      } catch (error) {
        post({ kind: "failed", message: String(error) }, []);
      }
    },
  };
}

/** What the page needs of a `Worker`. */
export interface CloudBakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

/**
 * Asks `worker` for the bakes and ends it. Rejects on a worker that cannot
 * run or a reply that is not the bakes; the sizes are the pass's to judge.
 */
export function requestCloudBakes(
  worker: CloudBakeWorker,
): Promise<CloudBakes> {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (isRecord(data) && data.kind === "bakes") {
        resolve(data.bakes as CloudBakes);
      } else if (isRecord(data) && data.kind === "failed") {
        reject(new Error(String(data.message)));
      } else {
        reject(new RangeError("the cloud bake worker sent no bakes"));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message ?? "the cloud bake worker did not run"));
    };
    worker.postMessage({ kind: "bake" });
  });
}
