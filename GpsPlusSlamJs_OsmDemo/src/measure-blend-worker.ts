/**
 * The time-of-day blend spike's transfer probe: allocates `k` colour buffers
 * of `bytes` each and posts them back, copied or transferred, stamped with
 * the absolute time just before the post, so the page reads the post's own
 * cost (the copy's serialisation included) and not the allocation.
 *
 * @see measure-blend-worker.ts.md
 */

interface ProbeRequest {
  readonly bytes: number;
  readonly k: number;
  readonly transfer: boolean;
}

const post = self.postMessage.bind(self) as (
  message: unknown,
  transfer?: Transferable[],
) => void;

self.onmessage = (event: MessageEvent<ProbeRequest>) => {
  const { bytes, k, transfer } = event.data;
  if (!(
    Number.isInteger(bytes) &&
    bytes >= 0 &&
    Number.isInteger(k) &&
    k > 0
  )) {
    post({ error: `bad probe request: ${bytes} bytes x ${k}` });
    return;
  }
  const buffers: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    const buffer = new Uint8Array(bytes);
    // Written through, so the pages exist before the clock starts.
    for (let j = 0; j < bytes; j += 64) buffer[j] = (i + j) & 0xff;
    buffers.push(buffer);
  }
  const sentAt = performance.timeOrigin + performance.now();
  post(
    { buffers, sentAt },
    transfer ? buffers.map((b) => b.buffer as ArrayBuffer) : [],
  );
};
