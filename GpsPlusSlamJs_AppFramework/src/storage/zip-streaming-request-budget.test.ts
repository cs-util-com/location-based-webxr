import {
  BlobWriter,
  TextReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import { openRemoteArchive } from './open-remote-archive.js';
import type { FetchImpl } from './remote-range-byte-source.js';
import { ByteSourceReader } from './zip-byte-source-reader.js';

/**
 * Why this test matters (plan review #6): "streaming beats downloading" is
 * the premise of the whole transport, and without a measured ceiling it stays
 * a premise — a design doing hundreds of tiny round-trips would pass every
 * functional test while being SLOWER on mobile than downloading the archive
 * whole. This pins, against a real zip parsed by the real zip.js, (a) how
 * many HTTP range requests a metadata-and-few-entries session costs and (b)
 * that the bytes fetched stay a fraction of the archive. If a zip.js upgrade
 * or a reader change regresses either, this is the tripwire — and the
 * numbers double as the measurement the read-ahead decision was made on
 * (getEntries costs 3 requests; each entry read costs 3 — no read-ahead
 * needed at this scale).
 */

// 400 × 2 KB ≈ 850 KB: large enough that zip.js's FIXED tail read at open
// (2.9+ fetches one ≤ 65 557-byte end-of-central-directory window instead
// of a 22-byte probe, measured 2026-09-07 in the dependency sweep) is the
// small fraction it is on a real recording, not most of a toy archive —
// at 40 entries the same window was 76 % of the file and the ratio ceiling
// below tripped on a change that costs a headset nothing.
const ENTRY_COUNT = 400;
const ENTRY_SIZE = 2_000;
/** zip.js's end-of-central-directory search window (max comment + record). */
const EOCD_WINDOW = 65_557;

async function buildZip(): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    // Store mode mirrors production (frames are already-compressed JPEGs).
    level: 0,
  });
  for (let i = 0; i < ENTRY_COUNT; i += 1) {
    await writer.add(
      `images/frame-${String(i)}.txt`,
      new TextReader('x'.repeat(ENTRY_SIZE))
    );
  }
  return writer.close();
}

function rangeServer(bytes: Uint8Array): {
  fetchImpl: FetchImpl;
  stats: { requests: number; bytesServed: number };
} {
  const stats = { requests: 0, bytesServed: 0 };
  const fetchImpl: FetchImpl = (_input, init) => {
    const range = new Headers(init?.headers).get('range');
    const method = init?.method ?? 'GET';
    if (method === 'HEAD') {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(bytes.length) },
        })
      );
    }
    const m = range === null ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (m === null) throw new Error(`unexpected non-range GET (${range})`);
    const [start, end] = [Number(m[1]), Number(m[2])];
    const slice = bytes.slice(start, Math.min(end + 1, bytes.length));
    stats.requests += 1;
    stats.bytesServed += slice.length;
    return Promise.resolve(
      new Response(slice, {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${start + slice.length - 1}/${bytes.length}`,
        },
      })
    );
  };
  return { fetchImpl, stats };
}

describe('zip streaming request budget', () => {
  it('reads metadata + 3 entries within the pinned request/byte ceilings', async () => {
    const zipBytes = await buildZip();
    const { fetchImpl, stats } = rangeServer(zipBytes);
    const opened = await openRemoteArchive('https://x/archive.zip', {
      fetchImpl,
      warm: false,
    });

    const reader = new ZipReader(new ByteSourceReader(opened.source));
    const entries = await reader.getEntries();
    expect(entries.length).toBe(ENTRY_COUNT);
    const afterListing = { ...stats };

    for (const entry of entries.slice(0, 3)) {
      if (entry.directory || !entry.getData) {
        throw new Error(`entry ${entry.filename} is not readable`);
      }
      const data = await entry.getData(new BlobWriter());
      expect(data.size).toBe(ENTRY_SIZE);
    }
    await reader.close();

    // Measured 2026-08-25 (zip.js 2.8.x, 40 entries × 2 KB stored): listing =
    // 3 requests, each entry read = 3, bytes served = 10 638 of 88 642 (12%).
    // Re-measured 2026-09-07 (zip.js 2.11.2, 400 entries): listing = 2
    // requests reading the ≤ 65 557-byte tail window plus the central
    // directory; each entry read still = 3 requests of 30 + 9 + 2 000 bytes.
    // Ceilings carry one request of headroom for zip.js internals changing
    // slightly, but a linear blow-up (per-entry listing reads) must fail
    // here. At 3 requests per entry a read-ahead buffer was judged
    // unnecessary for v1 — revisit if a consumer reads many entries per
    // session.
    expect(afterListing.requests).toBeLessThanOrEqual(4);
    expect(stats.requests).toBeLessThanOrEqual(4 + 3 * 3);
    // The listing is bounded ABSOLUTELY: the tail window plus the central
    // directory (≤ ~120 bytes per entry here), never a re-read of the body.
    expect(afterListing.bytesServed).toBeLessThanOrEqual(
      EOCD_WINDOW + ENTRY_COUNT * 120
    );
    // The whole point: a fraction of the archive, not the archive.
    expect(stats.bytesServed).toBeLessThan(zipBytes.length / 4);
  });
});
