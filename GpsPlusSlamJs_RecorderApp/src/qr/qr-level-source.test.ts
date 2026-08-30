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

    // Wait for the CONDITION, not for a fixed tick. This used to be a single
    // `setTimeout(0)` on the reasoning that "the open happens a few microtasks
    // in" - but `fetchLevel` awaits `qrCodeId`, which is a real Web Crypto
    // digest, and one macrotask is not guaranteed to cover it on a loaded
    // machine. The assertion then read 0 instead of 1 and the test failed
    // having proved nothing about the behaviour it names. Measured at roughly
    // one run in five locally, and it is what reddened CI on PR #374.
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
    // The property is ONCE for two concurrent frames: having waited for the
    // first open, a second would already have happened if the dedupe were
    // broken, so this still discriminates.
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
  it('disposes an archive that arrives after the race was lost', async () => {
    // Why this test matters (PR #383 review): only the WINNER of the
    // deadline race reaches the `finally` that disposes the archive, so an
    // open that resolved late was dropped on the floor. `dispose()` is what
    // aborts what the open started (the warm download's AbortController), so
    // the leak is exactly the work the deadline exists to bound. Inert while
    // no `cacheStore` is wired, which is precisely why it needs a test: the
    // day one is threaded through, nothing else would notice.
    const archiveDispose = vi.fn();
    let settle: (() => void) | undefined;
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: () =>
        new Promise((resolve) => {
          settle = () => {
            resolve({ source: {}, dispose: archiveDispose });
          };
        }) as never,
    });

    const pending = source.fetchLevel(OURS);
    await Promise.resolve();
    // Lose the race the only way the suite can drive it: tear down, which
    // expires the deadline and rejects the pending open.
    source.dispose();
    await pending;
    // ...and only THEN does the underlying open succeed.
    settle?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(archiveDispose).toHaveBeenCalledTimes(1);
  });

  it('stops ANSWERING after dispose, not just opening', async () => {
    // Why this test matters (PR #382 review): the sidecar's dispose()
    // contract is "abort in-flight work and stop answering", and the second
    // half was not implemented. `dispose()` expires the deadlines, the
    // pending race rejects, the rejection lands in the catch, and that calls
    // `remember({kind: "failed"})` -> `deps.onState`. In the recorder that
    // reaches `onLevelState` and paints a "failed" level line for a session
    // that has already been torn down.
    const onState = vi.fn();
    let release: (() => void) | undefined;
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      onState,
      // Never settles on its own: the only way out is dispose().
      openArchive: () =>
        new Promise((_resolve, reject) => {
          release = () => {
            reject(new Error('torn down'));
          };
        }) as never,
    });

    const pending = source.fetchLevel(OURS);
    await Promise.resolve();
    source.dispose();
    release?.();
    await pending;

    // The state is still RECORDED (harmless, and it keeps the map honest);
    // what must not happen is reporting it to a HUD teardown just cleared.
    expect(onState).not.toHaveBeenCalled();
  });

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

  it('allows a share-page host our own encoder can name, via normalisation', async () => {
    // Why this test matters (PR #380 review): the gate ran on the payload AS
    // PRINTED, but `openRemoteArchive` normalises before fetching - so a
    // share PAGE link reached the network as a different host than the gate
    // inspected. Our own token table has entries for `https://github.com/`
    // and `https://drive.google.com/file/d/`, so every cloud-hosted tour was
    // refused here while the TourViewer (no such gate) accepted the same
    // printed code - and the refusal was cached `not-ours` for the session.
    //
    // A GitHub blob URL normalises to raw.githubusercontent.com, which the
    // allowlist already names; nothing about the allowed SET changed, only
    // which url is measured against it.
    const open = vi.fn(() =>
      Promise.resolve({ source: {}, dispose: () => undefined })
    );
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: open,
      readLevels: () => Promise.resolve(new Map()),
    });
    const blob = 'https://github.com/o/r/blob/main/tour.zip';
    const text = `https://gps.csutil.com/?qr=${encodeURIComponent(blob)}`;
    await source.fetchLevel(text);

    expect(source.stateFor(text)?.kind).not.toBe('not-ours');
    expect(open).toHaveBeenCalled();
  });

  it('refuses a PROTOCOL-RELATIVE payload, which resolves cross-origin', async () => {
    // Why this test matters (PR #381 review): the previous round widened this
    // gate to treat an unparseable url as same-origin, reasoning that a
    // relative address cannot leave our origin. That reasoning is WRONG for
    // the protocol-relative form: `new URL("//evil.example/x.zip")` throws
    // without a base, but `fetch()` resolves it against the document base and
    // lands on `https://evil.example/x.zip`. That reopened exactly the hole
    // this function exists to close - a ranged GET from the AR frame path to
    // an address a stranger printed on a sticker.
    //
    // Reachable end to end: the dictionary codec passes every byte >= 0x20
    // through as a literal, so the payload is fully attacker-controlled and
    // costs a few base64url characters. `\evil.example\x.zip` is the same
    // hole, because the URL parser maps backslashes to slashes.
    const { encodeDictionaryPayload } =
      await import('gps-plus-slam-app-framework/utils/qr-payload/codec-dictionary');
    const open = vi.fn();
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: open as never,
    });

    // Built from the char code so the literal survives every layer that
    // rewrites backslashes between here and the file on disk.
    const bs = String.fromCharCode(92);
    for (const evil of [
      '//evil.example/x.zip',
      `${bs}${bs}evil.example${bs}x.zip`,
    ]) {
      const encoded = await encodeDictionaryPayload(evil);
      const text = `https://gps.csutil.com/?qr=${encodeURIComponent(`~${encoded}`)}`;
      await source.fetchLevel(text);
      expect(source.stateFor(text)?.kind, evil).toBe('not-ours');
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses a payload that NAMES the sentinel origin', async () => {
    // Why this test matters (PR #383 review): the sentinel is a hard-coded
    // host name, and the payload is attacker-controlled. Resolving
    // `https://relative.invalid/x.zip` against the sentinel base yields
    // origin === the sentinel, so the "path-relative, therefore ours" branch
    // fired for an ABSOLUTE stranger URL and the address was fetched.
    //
    // The sentinel was safe in `share-link.ts` because that only ever parses
    // a CONFIGURED value. Here it is compared against a string that came off
    // a printed sticker. `.invalid` is RFC 2606 reserved and cannot resolve
    // in public DNS, so the practical reach is small - but "cannot resolve on
    // the networks we thought about" is a weaker property than the one the
    // gate claims, and a LAN wildcard resolver or captive portal resolves it.
    const open = vi.fn();
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: open as never,
    });
    const evil = 'https://relative.invalid/x.zip';
    const text = `https://gps.csutil.com/?qr=${encodeURIComponent(evil)}`;
    await source.fetchLevel(text);

    expect(source.stateFor(text)?.kind).toBe('not-ours');
    expect(open).not.toHaveBeenCalled();
  });

  it('still allows the configured RELATIVE proxy form', async () => {
    // The one relative case that genuinely is ours: the proxy option whose
    // own JSDoc names `/api/drive-proxy`. Distinguished by resolving against
    // the page origin and comparing origins - not by treating "unparseable"
    // as "ours".
    const open = vi.fn(() =>
      Promise.resolve({ source: {}, dispose: () => undefined })
    );
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      corsProxyBaseUrl: '/api/drive-proxy',
      openArchive: open,
      readLevels: () => Promise.resolve(new Map()),
    });
    const drive = 'https://drive.google.com/file/d/FILEID/view';
    const text = `https://gps.csutil.com/?qr=${encodeURIComponent(drive)}`;
    await source.fetchLevel(text);

    expect(source.stateFor(text)?.kind).not.toBe('not-ours');
    expect(open).toHaveBeenCalled();
  });

  it('still refuses a stranger that no normalisation rewrites', async () => {
    // The widened READ must not widen the gate: an address our normaliser
    // does not recognise passes through byte-identical and is still refused.
    const open = vi.fn();
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: open as never,
    });
    const evil = `https://gps.csutil.com/?qr=${encodeURIComponent('https://evil.example/deep/x.zip')}`;
    await source.fetchLevel(evil);
    expect(source.stateFor(evil)?.kind).toBe('not-ours');
    expect(open).not.toHaveBeenCalled();
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

// The three mechanisms the M-B…M-G review found built-but-unproven. Each is
// documented as protective, and a mechanism nobody exercises is worse than an
// absent one: the docs then assert a guarantee nobody has.
describe('createQrLevelSource — the mechanisms that bound a bad sticker', () => {
  it('tells the controller to cache only a real level', async () => {
    // The tracking controller has its own cache. If it caches the geo-less
    // placeholder, the first failure sticks for the whole session and the
    // retry backoff below is unreachable — which is exactly what happened
    // before `shouldCacheLevel` was wired.
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      openArchive: () => Promise.reject(new Error('offline')),
    });

    const placeholder = await source.fetchLevel(OURS);

    expect(source.shouldCacheLevel(placeholder)).toBe(false);
    expect(
      source.shouldCacheLevel({
        version: 1,
        qr: { geo: { latitude: 1, longitude: 2, altitude: 3 } },
      } as never)
    ).toBe(true);
  });

  it('gives up on an archive that never answers', async () => {
    // Without the deadline the detector awaits a hung request forever: no
    // level, no vote, and no second attempt — a single stalled connection
    // ends QR levels for the session with no visible symptom.
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      timeoutMs: 5,
      openArchive: () => new Promise(() => undefined),
    });

    const level = await source.fetchLevel(OURS);

    expect(level).toEqual({ version: 1, qr: {} });
    expect(source.stateFor(OURS)?.kind).toBe('failed');
  });

  it('stops waiting on everything in flight when the session ends', async () => {
    // `dispose()` cannot cancel the requests themselves, so what it must
    // guarantee is that nothing keeps awaiting them. A pending promise that
    // never settles after teardown holds the whole session's closure alive.
    const source = createQrLevelSource({
      allowedHosts: HOSTS,
      assetPrefix: 'https://assets.test/',
      timeoutMs: 60_000,
      openArchive: () => new Promise(() => undefined),
    });

    const pending = source.fetchLevel(OURS);
    source.dispose();

    await expect(pending).resolves.toEqual({ version: 1, qr: {} });
    // And a lookup started after teardown never reaches the network at all.
    await expect(source.fetchLevel(OURS)).resolves.toEqual({
      version: 1,
      qr: {},
    });
  });
});
