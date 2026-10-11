/**
 * Why these tests matter: trust on first use is the only memory a phone
 * has of who signed a tour before (tour kit plan K1, §8 D2). Keyed by
 * series alone it is bypassed by a fresh series or a stripped signature,
 * so it is keyed by SOURCE as well - the normalised link and the printed
 * code. Each warning below is a way an attacker who controls a link would
 * replace a creator's tour; each silence is a way an honest creator's
 * tour must keep opening without crying wolf.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  codeTrustKey,
  judgeTrust,
  linkTrustKey,
  loadTrustRecords,
  MAX_TRUST_RECORDS,
  saveTrustRecords,
  type TrustRecord,
  type TrustStorage,
} from "./tour-trust.js";

const A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const B = "did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP";
const LINK = "link:https://host/tour.zip";
const CODE = "code:a1b2c3d4e5f6";
const SERIES = "K7fQ2mX9pL4sT8vB1nR6wA";

const signedBy = (author: string, seriesId: string | null = SERIES) => ({
  author,
  seriesId,
});
const unsigned = (seriesId: string | null = null) => ({
  author: null,
  seriesId,
});

function after(
  first: { author: string | null; seriesId: string | null },
  sources: readonly string[] = [LINK],
): Map<string, TrustRecord> {
  return judgeTrust(new Map(), sources, first, 1000).records;
}

describe("judgeTrust", () => {
  it("remembers the first sight of a source and of a series, and warns about nothing", () => {
    const { warnings, records } = judgeTrust(
      new Map(),
      [LINK, CODE],
      signedBy(A),
      1000,
    );
    expect(warnings).toEqual([]);
    expect(records.get(LINK)).toMatchObject({ author: A });
    expect(records.get(CODE)).toMatchObject({ author: A });
    expect(records.get(`series:${SERIES}`)).toMatchObject({ author: A });
  });

  it("the same key again is silent", () => {
    const known = after(signedBy(A));
    expect(judgeTrust(known, [LINK], signedBy(A), 2000).warnings).toEqual([]);
  });

  it("a source that was signed and now serves ANOTHER key warns", () => {
    const known = after(signedBy(A, "OtherSeries123456789"));
    expect(judgeTrust(known, [LINK], signedBy(B, null), 2000).warnings).toEqual(
      [{ kind: "source-key-changed", source: "link", was: A, now: B }],
    );
  });

  it("a source that was signed and now serves NO signature warns (a stripped signature)", () => {
    const known = after(signedBy(A));
    expect(judgeTrust(known, [LINK], unsigned(), 2000).warnings).toEqual([
      { kind: "source-lost-signature", source: "link", was: A },
    ]);
  });

  it("the printed code is a source of its own: a code that now opens another key warns, though the link is new", () => {
    const known = after(signedBy(A, null), [CODE]);
    const { warnings } = judgeTrust(
      known,
      ["link:https://elsewhere/tour.zip", CODE],
      signedBy(B, null),
      2000,
    );
    expect(warnings).toEqual([
      { kind: "source-key-changed", source: "code", was: A, now: B },
    ]);
  });

  it("a fresh link carrying a KNOWN series under another key warns (a fork posing as an update)", () => {
    const known = after(signedBy(A), ["link:https://first/tour.zip"]);
    expect(judgeTrust(known, [LINK], signedBy(B), 2000).warnings).toEqual([
      { kind: "series-key-changed", seriesId: SERIES, was: A, now: B },
    ]);
  });

  it("a known series turning up unsigned warns", () => {
    const known = after(signedBy(A), ["link:https://first/tour.zip"]);
    expect(judgeTrust(known, [LINK], unsigned(SERIES), 2000).warnings).toEqual([
      { kind: "series-key-changed", seriesId: SERIES, was: A, now: null },
    ]);
  });

  it("keeps the FIRST key after a warning, so the warning repeats instead of being learned away", () => {
    let records = after(signedBy(A));
    for (const t of [2000, 3000]) {
      const judged = judgeTrust(records, [LINK], signedBy(B), t);
      expect(judged.warnings).toHaveLength(2);
      records = judged.records;
    }
    expect(records.get(LINK)?.author).toBe(A);
  });

  it("an unsigned source that later turns signed is silent, and the signature becomes its reference", () => {
    const known = after(unsigned());
    const judged = judgeTrust(known, [LINK], signedBy(A, null), 2000);
    expect(judged.warnings).toEqual([]);
    expect(judged.records.get(LINK)?.author).toBe(A);
    expect(
      judgeTrust(judged.records, [LINK], unsigned(), 3000).warnings,
    ).toHaveLength(1);
  });

  it("an unsigned source staying unsigned is silent", () => {
    expect(
      judgeTrust(after(unsigned()), [LINK], unsigned(), 2000).warnings,
    ).toEqual([]);
  });

  it("never changes the records it was given (a pure judgement)", () => {
    const known = after(signedBy(A));
    const before = JSON.stringify([...known]);
    judgeTrust(known, [LINK, CODE], signedBy(B), 2000);
    expect(JSON.stringify([...known])).toBe(before);
  });

  it("a key change on a source always warns, whatever was seen in between (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(A, null), { maxLength: 6 }),
        (between) => {
          let records = after(signedBy(A, null));
          for (const author of between) {
            records = judgeTrust(
              records,
              [LINK],
              { author, seriesId: null },
              2000,
            ).records;
          }
          const { warnings } = judgeTrust(
            records,
            [LINK],
            signedBy(B, null),
            3000,
          );
          expect(warnings).toContainEqual({
            kind: "source-key-changed",
            source: "link",
            was: A,
            now: B,
          });
        },
      ),
    );
  });
});

describe("the trust records on the device", () => {
  function memory(): TrustStorage & { value: string | null } {
    const box = {
      value: null as string | null,
      getItem: () => box.value,
      setItem: (_key: string, value: string) => {
        box.value = value;
      },
    };
    return box;
  }

  it("round-trips through the storage", () => {
    const storage = memory();
    const records = after(signedBy(A), [LINK, CODE]);
    saveTrustRecords(storage, records);
    expect(loadTrustRecords(storage)).toEqual(records);
  });

  it("reads nothing, never a failure, from missing, corrupt or throwing storage", () => {
    const corrupt = memory();
    corrupt.value = "{ not json";
    expect(loadTrustRecords(corrupt).size).toBe(0);
    expect(loadTrustRecords(undefined).size).toBe(0);
    const throwing: TrustStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadTrustRecords(throwing).size).toBe(0);
    expect(() => saveTrustRecords(throwing, after(signedBy(A)))).not.toThrow();
  });

  it("drops a record whose fields do not read, keeping the rest", () => {
    const storage = memory();
    storage.value = JSON.stringify({
      [LINK]: { author: A, seriesId: null, firstSeenMs: 1, lastSeenMs: 1 },
      [CODE]: { author: 42 },
    });
    expect([...loadTrustRecords(storage).keys()]).toEqual([LINK]);
  });

  it(`keeps at most ${String(MAX_TRUST_RECORDS)} records, forgetting the least recently seen`, () => {
    const storage = memory();
    const many = new Map<string, TrustRecord>();
    for (let i = 0; i < MAX_TRUST_RECORDS + 10; i++) {
      many.set(`link:${String(i)}`, {
        author: A,
        seriesId: null,
        firstSeenMs: i,
        lastSeenMs: i,
      });
    }
    saveTrustRecords(storage, many);
    const kept = loadTrustRecords(storage);
    expect(kept.size).toBe(MAX_TRUST_RECORDS);
    expect(kept.has("link:0")).toBe(false);
    expect(kept.has(`link:${String(MAX_TRUST_RECORDS + 9)}`)).toBe(true);
  });
});

describe("the source keys", () => {
  // Why this matters: the printed code is a source of its own (§8 D2). A
  // code is opened two ways - a scan reads the full printed URL, a ?qr=
  // launch hands over its payload - and both must name ONE source, or the
  // same code would be a first use twice and a swap behind it would pass.
  it("a scanned launch URL and its ?qr= payload name the same code source", () => {
    expect(codeTrustKey("https://site.example/tour/?qr=ABC123")).toBe(
      codeTrustKey("ABC123"),
    );
  });

  it("a code that is a plain link is named by its text", () => {
    expect(codeTrustKey("https://host/tour.zip")).toBe(
      "code:https://host/tour.zip",
    );
  });

  it("a link source and a code source never collide", () => {
    expect(linkTrustKey("x")).not.toBe(codeTrustKey("x"));
  });

  // Why this matters (K1 milestone review R5): a link keyed by its raw text
  // made a "new" source of every spelling - a fragment, the host in capitals,
  // the default port - so a stripped signature served under one of them
  // passed as a first use. The link is read as a URL instead; its query
  // stays, because another query can name another file.
  it("a link is one source however it is spelled: fragment, host case, default port", () => {
    const key = linkTrustKey("https://host.example/tour.zip?v=2");
    expect(linkTrustKey("https://host.example/tour.zip?v=2#start")).toBe(key);
    expect(linkTrustKey("https://HOST.Example/tour.zip?v=2")).toBe(key);
    expect(linkTrustKey("https://host.example:443/tour.zip?v=2")).toBe(key);
    expect(linkTrustKey("https://host.example/tour.zip?v=3")).not.toBe(key);
  });

  it("a relative link (the site's own Drive proxy route) drops its fragment too", () => {
    expect(linkTrustKey("/api/drive-proxy?id=X#again")).toBe(
      linkTrustKey("/api/drive-proxy?id=X"),
    );
  });

  it("no fragment ever makes another source (property)", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ withQueryParameters: true }),
        fc.webFragments(),
        (url, fragment) => {
          expect(linkTrustKey(`${url}#${fragment}`)).toBe(linkTrustKey(url));
        },
      ),
    );
  });
});
