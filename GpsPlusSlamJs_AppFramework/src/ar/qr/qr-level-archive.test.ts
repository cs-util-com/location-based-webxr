import { describe, it, expect, vi } from 'vitest';
import {
  qrLevelEntryName,
  qrLevelIdFromEntryName,
  parseQrLevelEntries,
} from './qr-level-archive.js';

const MINIMAL = JSON.stringify({ version: 1, qr: {} });
const WITH_GEO = JSON.stringify({
  version: 1,
  qr: {
    physicalSizeM: 0.16,
    geo: { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 90 },
  },
});

/** Build a reader over a fixed name→text map, so tests can assert WHICH
 *  entries were read as well as what came back. */
function readerFor(files: Record<string, string>) {
  return vi.fn((name: string): Promise<string> => {
    const text = files[name];
    return text === undefined
      ? Promise.reject(new Error(`no such entry: ${name}`))
      : Promise.resolve(text);
  });
}

describe('qrLevelEntryName', () => {
  it('places a level under the qr/ folder', () => {
    expect(qrLevelEntryName('9f2c1a0b4de7')).toBe('qr/9f2c1a0b4de7.json');
  });

  it('round-trips with the id reader', () => {
    // Why this test matters: the writer lives in the recorder and the reader
    // in the viewer. They agreed only by convention until this pair existed;
    // a drift between them makes levels invisible with no error raised.
    const id = 'abc123def456';
    expect(qrLevelIdFromEntryName(qrLevelEntryName(id))).toBe(id);
  });

  it('refuses an id that would escape the qr/ folder', () => {
    // Why this test matters: the id is interpolated straight into a zip path.
    // A caller passing something unexpected must fail loudly here rather than
    // write outside the folder the contributor owns.
    for (const bad of ['', '../evil', 'a/b', 'a\\b', 'a b', 'a?b']) {
      expect(() => qrLevelEntryName(bad), bad).toThrow(TypeError);
    }
    expect(() => qrLevelEntryName(undefined as unknown as string)).toThrow(
      TypeError
    );
  });
});

describe('qrLevelIdFromEntryName', () => {
  it('accepts only json files directly inside qr/', () => {
    expect(qrLevelIdFromEntryName('qr/abc.json')).toBe('abc');
    expect(qrLevelIdFromEntryName('qr/a.b-c_d.json')).toBe('a.b-c_d');
    for (const bad of [
      'qr/abc.txt',
      'qr/abc.json.bak',
      'other/abc.json',
      'qr/sub/abc.json',
      'qr/.json',
      'abc.json',
      'qr/',
    ]) {
      expect(qrLevelIdFromEntryName(bad), bad).toBeNull();
    }
  });
});

describe('parseQrLevelEntries', () => {
  it('reads zero, one and several levels', async () => {
    // Why this test matters: 0 levels is the normal case for a tour zip that
    // was never authored, and must not read as an error.
    expect((await parseQrLevelEntries([], readerFor({}))).size).toBe(0);

    const one = await parseQrLevelEntries(
      ['qr/aaa.json'],
      readerFor({ 'qr/aaa.json': MINIMAL })
    );
    expect([...one.keys()]).toEqual(['aaa']);

    const two = await parseQrLevelEntries(
      ['qr/aaa.json', 'qr/bbb.json'],
      readerFor({ 'qr/aaa.json': MINIMAL, 'qr/bbb.json': WITH_GEO })
    );
    expect([...two.keys()].sort()).toEqual(['aaa', 'bbb']);
    expect(two.get('bbb')?.qr.geo?.lat).toBe(48.1);
  });

  it('never reads an entry that is not a level file', async () => {
    // Why this test matters: a tour zip holds photos and an action log. If
    // this scanned their bytes it would cost the whole archive on every open.
    const read = readerFor({ 'qr/aaa.json': MINIMAL });
    await parseQrLevelEntries(
      ['images/frame-000001.jpg', 'actions/000001.json', 'qr/aaa.json'],
      read
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('qr/aaa.json');
  });

  it('skips a corrupt or unreadable level instead of failing the archive', async () => {
    // Why this test matters: one bad file means "this code has no level",
    // never "this tour is broken". The viewer must still open.
    const levels = await parseQrLevelEntries(
      [
        'qr/good.json',
        'qr/notjson.json',
        'qr/invalid.json',
        'qr/unreadable.json',
      ],
      readerFor({
        'qr/good.json': MINIMAL,
        'qr/notjson.json': 'this is not json',
        'qr/invalid.json': JSON.stringify({ version: 'one', qr: {} }),
        // 'qr/unreadable.json' deliberately absent → the reader throws
      })
    );
    expect([...levels.keys()]).toEqual(['good']);
  });
});
