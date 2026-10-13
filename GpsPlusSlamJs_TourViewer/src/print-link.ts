/**
 * Which spelling of the tour link a printed code carries (r820 feedback R4,
 * R5). A code's identity is a hash of its full text, so two spellings of
 * one Drive file make two different codes: new codes print the trimmed
 * address (fewer characters, one QR version smaller for a link shared from
 * the phone app), and a tour's own measured codes keep the spelling they
 * were printed in, so a re-print matches the posters already hanging.
 *
 * @see print-link.ts.md
 */

import { driveFileId } from "gps-plus-slam-app-framework/utils/drive-file-id";
import { qrCodeId } from "gps-plus-slam-app-framework/utils/qr-payload/qr-code-id";
import { resolveQrPayload } from "gps-plus-slam-app-framework/utils/qr-payload/qr-launch-dispatch";

import { DEFAULT_ASSET_PREFIX, launchPayload } from "./code-tour.js";

/** The spelling a NEW code prints: a Drive file link trimmed to the file's
 *  address; any other link as it is. */
export function printableLink(url: string): string {
  const id = driveFileId(url);
  return id === null ? url : `https://drive.google.com/file/d/${id}`;
}

/**
 * The spellings a tour's measured codes may have been printed from: the
 * link as given first (a tour re-printed from the link it was printed from
 * is the common case, found in one round - M0c review), then the trimmed
 * address, Drive's own `/view` and its share tails - the desktop's
 * `sharing`, the phone app's `drivesdk`, the newer `drive_link` and
 * `share_link`. Each once; a link that is not a Drive file has one
 * spelling. A spelling outside the list stays a different code (follow-up
 * F2: store the printed spelling in the tour).
 */
export function linkSpellings(url: string): string[] {
  const printable = printableLink(url);
  const candidates =
    driveFileId(url) === null
      ? [url]
      : [
          url,
          printable,
          `${printable}/view`,
          ...["sharing", "drivesdk", "drive_link", "share_link"].map(
            (tail) => `${printable}/view?usp=${tail}`,
          ),
        ];
  return [...new Set(candidates)];
}

/**
 * The first free code number for a tour (polish round M0b): one more than
 * the highest number whose code the tour holds, 1 for a tour with none. A
 * tour files each code under a hash of its printed text (`qrCodeId`), so
 * the number cannot be read back - each number's id is computed
 * (`idOfCode`, a launch-URL build and a hash) and looked up, up to `limit`
 * (a gap below the highest is not reused). It stops once every id is
 * accounted for (PR #586 review): no higher number can match then, so the
 * common one-code tour costs one round.
 */
export async function nextCodeIndex(
  tourCodeIds: ReadonlySet<string>,
  idOfCode: (index: number) => Promise<string>,
  limit: number,
): Promise<number> {
  let highest = 0;
  let found = 0;
  for (let index = 1; index <= limit && found < tourCodeIds.size; index += 1) {
    // Sequential on purpose: a launch-URL build and a hash each, on the
    // main thread.
    // eslint-disable-next-line no-await-in-loop
    if (tourCodeIds.has(await idOfCode(index))) {
      highest = index;
      found += 1;
    }
  }
  return highest + 1;
}

/** A measured code read from the text on its level (follow-up F2). */
export interface PrintedCode {
  /** The level's id: the hash of the text. */
  readonly id: string;
  /** The tour link the code was built from, as it was spelled. */
  readonly link: string;
  /** Its code number (`n`; a code without one is number 1). */
  readonly index: number;
}

/** The link and number a launch URL was built from, or null. */
async function printedCodeOf(
  text: string,
): Promise<{ link: string; index: number } | null> {
  const payload = launchPayload(text);
  if (payload === null) return null;
  const n = new URL(text).searchParams.get("n");
  const index = n === null ? 1 : Number(n);
  if (!Number.isInteger(index) || index < 1) return null;
  try {
    const link = await resolveQrPayload(payload, DEFAULT_ASSET_PREFIX);
    return link === null ? null : { link, index };
  } catch {
    return null;
  }
}

/**
 * The measured codes whose level carries its printed text (`qr.printed`,
 * `level-printed.ts`), read back into link and number. A text counts only
 * when its hash is its level's id - one carried onto the wrong level, or
 * edited by hand, is ignored rather than believed.
 */
export async function printedCodes(
  levels: readonly { readonly id: string; readonly text: string }[],
  hash: (text: string) => Promise<string> = qrCodeId,
): Promise<PrintedCode[]> {
  const codes: PrintedCode[] = [];
  // One at a time: a hash and a decode each, on the main thread.
  for (const { id, text } of levels) {
    if ((await hash(text)) !== id) continue;
    const code = await printedCodeOf(text);
    if (code !== null) codes.push({ id, ...code });
  }
  return codes;
}

/** Whether `link` names the same tour as `url`: the same Drive file in
 *  any spelling, or the same link. */
function sameTour(link: string, url: string): boolean {
  const id = driveFileId(url);
  return id === null ? link === url : driveFileId(link) === id;
}

/** Among stored codes of this tour, the spelling with the most codes (ties:
 *  the higher number) and its highest number; null when none names it. */
function storedSpelling(
  url: string,
  printed: readonly PrintedCode[],
): { link: string; highest: number; ids: Set<string> } | null {
  const bySpelling = new Map<string, PrintedCode[]>();
  for (const code of printed) {
    if (!sameTour(code.link, url)) continue;
    bySpelling.set(code.link, [...(bySpelling.get(code.link) ?? []), code]);
  }
  let best: { link: string; highest: number; ids: Set<string> } | null = null;
  for (const [link, codes] of bySpelling) {
    const highest = Math.max(...codes.map((c) => c.index));
    if (
      best === null ||
      codes.length > best.ids.size ||
      (codes.length === best.ids.size && highest > best.highest)
    ) {
      best = { link, highest, ids: new Set(codes.map((c) => c.id)) };
    }
  }
  return best;
}

/**
 * The spelling a tour's measured codes were printed from, and the next free
 * number in it. The codes' stored texts decide first (`printed`, F2): any
 * spelling, even one outside `linkSpellings`. Codes without a text (printed
 * before F2) are still searched for in that spelling, and the higher next
 * wins - an old code 2 must not be printed again because only code 1 was
 * measured since. Without a stored text that names this tour: the first of
 * `linkSpellings` with a code the tour holds. None - a tour with no codes,
 * or codes from another link altogether - is the trimmed address from
 * number 1 (the panel's orphan warning speaks for the second case).
 */
export async function spellingOfRecord(
  url: string,
  measuredIds: ReadonlySet<string>,
  idOf: (link: string, index: number) => Promise<string>,
  limit: number,
  printed: readonly PrintedCode[] = [],
): Promise<{ link: string; next: number }> {
  const stored = storedSpelling(url, printed);
  if (stored !== null) {
    const textless = new Set(
      [...measuredIds].filter((id) => !printed.some((c) => c.id === id)),
    );
    const searched =
      textless.size === 0
        ? 1
        : await nextCodeIndex(
            textless,
            (index) => idOf(stored.link, index),
            limit,
          );
    return { link: stored.link, next: Math.max(stored.highest + 1, searched) };
  }
  if (measuredIds.size > 0) {
    for (const link of linkSpellings(url)) {
      // eslint-disable-next-line no-await-in-loop
      const next = await nextCodeIndex(
        measuredIds,
        (index) => idOf(link, index),
        limit,
      );
      if (next > 1) return { link, next };
    }
  }
  return { link: printableLink(url), next: 1 };
}
