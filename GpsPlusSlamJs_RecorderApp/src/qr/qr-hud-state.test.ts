import { describe, it, expect, vi } from 'vitest';

import { createQrHudState } from './qr-hud-state';

const TEXT = 'https://gps.csutil.com/?qr=tour';
const OTHER = 'https://gps.csutil.com/?qr=tour&n=2';

function stateWith(
  hashId = vi.fn((_text: string) => Promise.resolve('abc123def456'))
) {
  return { hud: createQrHudState({ hashId }), hashId };
}

describe('createQrHudState', () => {
  it('reports nothing before a code has been seen', () => {
    // Why this test matters: this is the line the row must show at the start
    // of every session - `qrStatusLine` renders "scanning, no code seen yet"
    // for a null text, and that is the honest state on session two as much as
    // on session one.
    const { hud } = stateWith();
    expect(hud.snapshot()).toEqual({ latestText: null, latestId: null });
  });

  it('records the newest code and resolves its short id', async () => {
    const { hud, hashId } = stateWith();
    hud.noteNewest(TEXT);

    // The id is not awaited - the row renders immediately with a neutral
    // label rather than blocking a frame callback.
    expect(hud.snapshot()).toEqual({ latestText: TEXT, latestId: null });

    await vi.waitFor(() => {
      expect(hud.snapshot().latestId).toBe('abc123def456');
    });
    expect(hashId).toHaveBeenCalledTimes(1);
  });

  it('hashes once per code, not once per detection', async () => {
    // Why this test matters: `noteNewest` runs from a frame callback at the
    // detection cadence. Re-hashing the same text every frame would be a
    // needless crypto call several times a second.
    const { hud, hashId } = stateWith();
    for (let i = 0; i < 10; i += 1) hud.noteNewest(TEXT);
    await vi.waitFor(() => {
      expect(hud.snapshot().latestId).not.toBeNull();
    });
    expect(hashId).toHaveBeenCalledTimes(1);
  });

  it('forgets everything on reset', () => {
    // Why this test matters: THE regression. These three values used to be
    // module-level in main.ts with nothing clearing them, so the second AR
    // session of a page load opened showing the first session's code against
    // a fresh, empty accumulator - the row read "visit 0" for a poster this
    // session had never seen.
    const { hud } = stateWith();
    hud.noteNewest(TEXT);
    hud.noteLevelState(TEXT, { kind: 'absent', id: 'x' });
    expect(hud.snapshot().latestText).toBe(TEXT);

    hud.reset();

    expect(hud.snapshot()).toEqual({ latestText: null, latestId: null });
  });

  it('drops the level states too, not just the text', () => {
    // Why this test matters: the stale level state was the worse half of the
    // bug. It made the row append "using its saved position" for a code the
    // new session had not looked up - a claim about data that was not there.
    const { hud } = stateWith();
    hud.noteLevelState(TEXT, { kind: 'absent', id: 'x' });
    hud.reset();
    hud.noteNewest(TEXT);

    expect(hud.snapshot().levelState).toBeUndefined();
  });

  it('does not let an id resolving after a reset write into the new session', async () => {
    // Why this test matters: the hash is async and a session can end while it
    // is in flight. Without a generation guard the old session's id would
    // land on the new session's state, which is the same class of bug as the
    // stale text - just harder to see.
    // Both calls' resolvers are kept: the point is to settle the FIRST one -
    // the one armed before the reset - while the second is still pending.
    const releases: Array<(id: string) => void> = [];
    const hashId = vi.fn(
      (_text: string) =>
        new Promise<string>((resolve) => {
          releases.push(resolve);
        })
    );
    const { hud } = stateWith(hashId);

    hud.noteNewest(TEXT);
    hud.reset();
    hud.noteNewest(TEXT); // same text, new session
    expect(releases).toHaveLength(2);

    releases[0]?.('stale-id'); // the previous session's hash lands late
    await Promise.resolve();
    await Promise.resolve();

    expect(hud.snapshot().latestId).toBeNull();
  });

  it('replaces the id when the newest code changes', async () => {
    // Why this test matters: two posters in view means the newest code
    // changes mid-session, and the label must not keep the other one's id.
    const ids = new Map([
      [TEXT, 'aaaaaaaaaaaa'],
      [OTHER, 'bbbbbbbbbbbb'],
    ]);
    const { hud } = stateWith(
      vi.fn((t: string) => Promise.resolve(ids.get(t) ?? ''))
    );

    hud.noteNewest(TEXT);
    await vi.waitFor(() => {
      expect(hud.snapshot().latestId).toBe('aaaaaaaaaaaa');
    });

    hud.noteNewest(OTHER);
    expect(hud.snapshot().latestId).toBeNull();
    await vi.waitFor(() => {
      expect(hud.snapshot().latestId).toBe('bbbbbbbbbbbb');
    });
  });
});
