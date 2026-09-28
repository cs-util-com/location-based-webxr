/**
 * The hosted file's name from a `content-disposition` header (RFC 6266,
 * with RFC 8187's `filename*`), and whether a phone keeps that name when it
 * saves the rebuilt zip (Drive replace plan §2 decision 3, §5 #7). Drive
 * offers "Replace" only for the SAME name, so the rebuilt zip must carry it
 * exactly - and a name the download would change is worth telling the
 * creator about before they upload a silent second file. Pure; never throws.
 */

/** Whether a name carries a path separator (a name must never steer the
 *  download elsewhere) or a control character. */
function hasUnsafeChar(name: string): boolean {
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === "/" || char === "\\") {
      return true;
    }
  }
  return false;
}

/** Characters a phone's file system refuses, which Chrome replaces on save. */
const RENAMED_ON_SAVE = /[<>:"|?*]/;

/** The file name the header carries, or null: none, empty, or unsafe.
 *  `filename*` wins over `filename`; a malformed or unsafe one falls back
 *  to the other. */
export function fileNameFromContentDisposition(
  header: string | null,
): string | null {
  if (header === null) return null;
  const params = parameters(header);
  const extended = params.get("filename*");
  const candidates = [
    extended === undefined ? null : decodeExtendedValue(extended),
    params.get("filename") ?? null,
  ];
  for (const name of candidates) {
    if (name !== null && name !== "" && !hasUnsafeChar(name)) return name;
  }
  return null;
}

/** Whether saving a file of this name on a phone keeps the name exactly:
 *  it must end in `.zip` (Chrome may append one) and carry none of the
 *  characters a file system refuses. */
export function nameSurvivesDownload(name: string): boolean {
  return /\.zip$/i.test(name) && !RENAMED_ON_SAVE.test(name);
}

/** The header's parameters, keys lower-cased, first occurrence kept;
 *  quoted strings unescaped. */
function parameters(header: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = header.indexOf(";");
  if (i < 0) return out;
  i += 1;
  while (i < header.length) {
    while (i < header.length && /[\s;]/.test(header.charAt(i))) i += 1;
    const eq = header.indexOf("=", i);
    if (eq < 0) break;
    const key = header.slice(i, eq).trim().toLowerCase();
    i = eq + 1;
    while (header.charAt(i) === " ") i += 1;
    let value = "";
    if (header.charAt(i) === '"') {
      i += 1;
      while (i < header.length && header.charAt(i) !== '"') {
        if (header.charAt(i) === "\\" && i + 1 < header.length) i += 1;
        value += header.charAt(i);
        i += 1;
      }
      i += 1; // the closing quote
    } else {
      const end = header.indexOf(";", i);
      value = header.slice(i, end < 0 ? header.length : end).trim();
      i = end < 0 ? header.length : end;
    }
    if (key !== "" && !out.has(key)) out.set(key, value);
  }
  return out;
}

/** An RFC 8187 `charset'language'percent-encoded` value, decoded; null for
 *  an unknown charset or a malformed encoding. */
function decodeExtendedValue(value: string): string | null {
  const match = /^([^']*)'[^']*'(.*)$/.exec(value);
  if (match === null) return null;
  const charset = (match[1] ?? "").toLowerCase();
  const encoded = match[2] ?? "";
  if (charset === "utf-8") {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  if (charset === "iso-8859-1") {
    if (/%(?![0-9a-f]{2})/i.test(encoded)) return null;
    return encoded.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
  return null;
}
