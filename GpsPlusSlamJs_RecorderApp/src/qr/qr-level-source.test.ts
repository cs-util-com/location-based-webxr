import { describe, it, expect, vi } from 'vitest';
import { createQrLevelSource } from './qr-level-source';

const HOSTS = ['gps.csutil.com'];
// On the configured asset-prefix host, because the resolved archive URL is
// allowlisted too - see the payload-host test below.
const ARCHIVE = 'https://assets.test/tour.zip';
const OURS = `https://gps.csutil.com/?qr=${encodeURIComponent(ARCHIVE)}`;

/**
 * Why this suite matters: this is the recorder's FIRST network call on a
 * session path, and its input is a sticker someone printed. Every test here
 * is about a failure that would otherwise be invisible on a phone — a request
 * that should never have been made, a code poisoned by one hiccup, or a hang
 * inside the detector's own await.
 */

type FakeOpen = () => Promise<{ source: unknown; dispose: () => void }>;

function sourceWith(open: FakeOpen) {
  const onState = vi.fn();
  const source = createQrLevelSource({
    allowedHosts: HOSTS,
    assetPrefix: 'https://assets.test/',
    onState,
    // The archive opener is injected so these tests never touch the network.
    openArchive: open,
  });
  return { source, onState };
}

describe('createQrLevelSource — what it refuses to fetch', () => {
  it('never opens anything for a code that is not ours', async () => {
    // Feeding raw decoded text to the payload decoder would send any text
    // containing a "/" to raw.githubusercontent.com and any http… text to
    // itself — an attacker-chosen address, reached from the frame path, by
    // pointing a phone at a sticker.
    const open = vi.fn();
    const { source } = sourceWith(open as never);
    for (const text of [
      'WIFI:S:CoffeeShop;T:WPA;P:hunter2;;',
      'https://evil.example/?qr=x',
      'user/repo/tour.zip',
      'https://raw.githubusercontent.com/user/repo/main/tour.zip',
    ]) {
      const level = await source.fetchLevel(text);
      expect(level.qr.geo, text).toBeUndefined();
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('never opens anything for our host without a payload', async () => {
    const open = vi.fn();
    const { source } = sourceWith(open as never);
    await source.fetchLevel('https://gps.csutil.com/');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('createQrLevelSource — never rejects', () => {
  it('resolves a geo-less placeholder when the archive cannot be opened', async () => {
    // A rejected fetchLevel drives the tracking controller into an
    // error↔scanning flap at the detection cadence. The placeholder never
    // solves and never votes, which is the honest "no".
    const { source } = sourceWith(() => Promise.reject(new Error('offline')));
    const level = await source.fetchLevel(OURS);
    expect(level).toEqual({ version: 1, qr: {} });
  });
});

describe('createQrLevelSource — caching', () => {
  it('asks once while a request is in flight, however many frames arrive', async () => {
    // The detector fires at ~8 Hz. Without this, every frame would open
    // another archive read while the first was still going.
    const pending = { finish: () => undefined as void };
    const open = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          pending.finish = () => {
            reject(new Error('done'));
          };
        })
    );
    const { source } = sourceWith(open);
    const first = source.fetchLevel(OURS);
    const second = source.fetchLevel(OURS);
    // Resolving the identity and the payload is async, so the open happens a
    // few microtasks in; the point is that it happens ONCE for both frames.
    await new Promise((r) => setTimeout(r, 0));
    expect(open).toHaveBeenCalledTimes(1);
    pending.finish();
    await Promise.all([first, second]);
  });

  it('retries a transport failure, but only after a backoff', async () => {
    // Why: one DNS hiccup at the first sighting must not poison that code for
    // the rest of the recording — but retrying on every frame would hammer.
    let clock = 0;
    const open = vi.fn(() => Promise.reject(new Error('offline')));
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      now: () => clock,
      openArchive: open,
    });
    await source.fetchLevel(OURS);
    expect(open).toHaveBeenCalledTimes(1);

    // Immediately after: still cached as failed.
    await source.fetchLevel(OURS);
    expect(open).toHaveBeenCalledTimes(1);

    clock += 10_000; // past the first backoff
    await source.fetchLevel(OURS);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('stops asking once it knows the archive has no level for this code', async () => {
    // "There is no level here" cannot change by asking again.
    const open = vi.fn(() =>
      Promise.resolve({ source: {}, dispose: vi.fn(), levels: new Map() })
    );
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: open,
      readLevels: () => Promise.resolve(new Map()),
    });
    await source.fetchLevel(OURS);
    await source.fetchLevel(OURS);
    await source.fetchLevel(OURS);
    expect(open).toHaveBeenCalledTimes(1);
    expect(source.stateFor(OURS)?.kind).toBe('absent');
  });
});

describe('createQrLevelSource — teardown', () => {
  it('answers with the placeholder and opens nothing after dispose', async () => {
    // The controller awaits this inside its detect step, so work that
    // outlives the session would stall the next one.
    const open = vi.fn();
    const { source } = sourceWith(open as never);
    source.dispose();
    const level = await source.fetchLevel(OURS);
    expect(level).toEqual({ version: 1, qr: {} });
    expect(open).not.toHaveBeenCalled();
  });
});

describe('createQrLevelSource — reading a real archive', () => {
  /** A ByteSource over bytes already in memory. */
  function bytesSource(bytes: Uint8Array) {
    return {
      size: bytes.length,
      read: (offset: number, length: number) =>
        Promise.resolve(bytes.slice(offset, offset + length)),
    };
  }

  async function zipWith(entries: Record<string, string>) {
    const { ZipWriter, TextReader, Uint8ArrayWriter } =
      await import('@zip.js/zip.js');
    const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
    for (const [name, text] of Object.entries(entries)) {
      await writer.add(name, new TextReader(text));
    }
    return writer.close();
  }

  it('finds THIS code\u2019s level inside a real zip, and ignores the others', async () => {
    // Why this test matters: everything else here injects the archive read.
    // This is the only proof that the recorder can actually get a level out
    // of a zip - which is the whole point of the mode - and that it picks the
    // entry matching the code's own identity rather than the first one.
    const { qrCodeId } =
      await import('gps-plus-slam-app-framework/utils/qr-payload/qr-code-id');
    const id = await qrCodeId(OURS);
    const level = {
      version: 1,
      qr: {
        physicalSizeM: 0.16,
        geo: { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 90 },
      },
    };
    const bytes = await zipWith({
      'session.json': '{"kind":"test"}',
      [`qr/${id}.json`]: JSON.stringify(level),
      'qr/0000deadbeef.json': JSON.stringify({ version: 1, qr: {} }),
    });

    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: () =>
        Promise.resolve({ source: bytesSource(bytes), dispose: vi.fn() }),
    });
    const found = await source.fetchLevel(OURS);
    expect(found.qr.geo?.lat).toBe(48.1);
    expect(source.stateFor(OURS)?.kind).toBe('level');
  });

  it('reports an archive that carries no level for this code', async () => {
    const bytes = await zipWith({ 'session.json': '{}' });
    const onState = vi.fn();
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      onState,
      openArchive: () =>
        Promise.resolve({ source: bytesSource(bytes), dispose: vi.fn() }),
    });
    await source.fetchLevel(OURS);
    expect(source.stateFor(OURS)?.kind).toBe('absent');
    // The HUD is told, so "this code has no level" is visible in the field
    // rather than being indistinguishable from "still looking".
    expect(onState).toHaveBeenCalled();
  });

  it('disposes the archive even when the read fails', async () => {
    const dispose = vi.fn();
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: () => Promise.resolve({ source: {}, dispose }),
      readLevels: () => Promise.reject(new Error('corrupt')),
    });
    await source.fetchLevel(OURS);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(source.stateFor(OURS)?.kind).toBe('failed');
  });
});

// Added after the M-B…M-G review (blocker 5). `qrCodeIsOurs` says the LAUNCH
// url is ours; it does not say the payload inside it is, and the decoder
// returns a full-URL payload verbatim.
describe('createQrLevelSource — the payload names the fetch host', () => {
  it('refuses a payload pointing at someone else, on our own launch URL', async () => {
    // A sticker reading `https://ours.example/?qr=https://evil.example/x.zip`
    // passes the launch-URL check. Without a second check on the RESOLVED
    // address, looking at it would fire a ranged GET from the AR frame path
    // at an address a stranger chose — costing them nothing to print.
    const open = vi.fn();
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: open as never,
    });
    const evil = `https://gps.csutil.com/?qr=${encodeURIComponent('https://evil.example/x.zip')}`;
    const level = await source.fetchLevel(evil);
    expect(level).toEqual({ version: 1, qr: {} });
    expect(open).not.toHaveBeenCalled();
    expect(source.stateFor(evil)?.kind).toBe('not-ours');
  });

  it('allows the hosts our own encoder can name', async () => {
    // The GitHub-template form expands to raw.githubusercontent.com, so that
    // host is allowed — the repo and path within it stay attacker-controlled,
    // which is why this is a host allowlist and not a trust claim.
    const open = vi.fn(() => Promise.resolve({ source: {}, dispose: vi.fn() }));
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: open,
      readLevels: () => Promise.resolve(new Map()),
    });
    await source.fetchLevel(
      'https://gps.csutil.com/?qr=user%2Frepo%2Ftour.zip'
    );
    expect(open).toHaveBeenCalledTimes(1);
  });
});
