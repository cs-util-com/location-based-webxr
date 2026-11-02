/**
 * The parts of a long text visitors see as typed, in the creator's words:
 * the framework reader's own diagnostics (`diagnoseTourMarkdown`) given a
 * title, a reason and a fix, and the fix itself ("Make it plain text"),
 * which takes marks off and never removes a word the visitor reads.
 *
 * @see typed-parts.ts.md
 */
import {
  diagnoseTourMarkdown,
  type TourMdDiagnostic,
  type TourMdDiagnosticKind,
} from "gps-plus-slam-app-framework/ar/tour-markdown";

/** What the writer says about one kind of part. */
export interface TypedPartText {
  /** What the part is, e.g. "A table". */
  readonly title: string;
  /** The callout's heading, when "<title> is shown as typed" is not true. */
  readonly headline?: string;
  /** Why visitors do not see it formatted. */
  readonly why: string;
  /** The fix button's label, when it is not "Make it plain text". */
  readonly fix?: string;
  /** What the fix does. */
  readonly fixNote: string;
  /** Whether a tour picture can stand in for it. */
  readonly picture?: true;
}

const PICTURE_NOTE =
  "Keeps its description as text. Or put in one of the tour's pictures.";

/** Every kind's words; the prototype's where it has them. */
export const TYPED_PART_TEXT: Readonly<
  Record<TourMdDiagnosticKind, TypedPartText>
> = {
  heading: {
    title: "A heading too small",
    why: "Texts have two heading sizes; a line starting with four or more # signs is shown as typed.",
    fixNote:
      "Removes the # signs; the words stay. The Subheading button makes it a subheading.",
  },
  quote: {
    title: "A quote inside a quote",
    why: "A > inside a quote is shown as typed.",
    fixNote:
      "Removes the > signs; the words stay. Italic is a good way to show a quote.",
  },
  list: {
    title: "A list line",
    why: "Lists start with - or 1. and go two levels deep; other list lines are shown as typed.",
    fixNote:
      "A + becomes -, a 1) becomes 1., and a line three levels deep loses its mark. No words are removed.",
  },
  rule: {
    title: "A divider line",
    why: "A line like --- or === is shown as typed, not as a divider.",
    fix: "Remove the line",
    fixNote: "The line has no words in it.",
  },
  code: {
    title: "A code box",
    why: "The ``` lines are shown as typed; the lines between them show as ordinary text.",
    fixNote: "Removes the ``` marks only.",
  },
  icode: {
    title: "Code marks",
    why: "The ` signs around these words are shown as typed.",
    fixNote: "Removes the ` signs; the words stay.",
  },
  table: {
    title: "A table",
    why: "Tables are not drawn as tables: visitors see the | and - signs exactly as typed.",
    fixNote: "Each row becomes a list line. No words are removed.",
  },
  tabs: {
    title: "Columns from a spreadsheet",
    why: "The columns run together for visitors: the gaps between them are not kept.",
    fixNote: "Each row becomes a list line. No words are removed.",
  },
  html: {
    title: "Web page code",
    why: "Marks in <angle brackets> are shown as typed, brackets and all.",
    fixNote:
      "Removes the <...> marks and keeps every word; bold and italic stay bold and italic.",
  },
  entity: {
    title: "A web page sign",
    why: "A code like &amp; is shown as typed, not as the sign it stands for.",
    fixNote: "Puts in the sign itself.",
  },
  autolink: {
    title: "An address in < >",
    why: "The < and > around an address are shown as typed.",
    fixNote:
      "Removes the < and >; the address stays. The Link button makes words a link.",
  },
  strike: {
    title: "Crossed-out words",
    why: "Words cannot be crossed out: the ~~ signs are shown as typed.",
    fixNote: "Removes the ~~ signs; the words stay.",
  },
  fnref: {
    title: "A footnote",
    why: "Footnotes are not supported: the [^...] mark is shown as typed.",
    fixNote: 'Becomes "(note 1)" in the sentence.',
  },
  fndef: {
    title: "A footnote",
    why: "Footnotes are not supported: this line is shown as typed.",
    fixNote: 'Becomes an ordinary line starting with "Note 1:".',
  },
  refdef: {
    title: "A link address on its own line",
    why: "Links are written with the Link button; a [name]: address line is shown as typed.",
    fixNote: "Removes the [ ] signs; the words and the address stay.",
  },
  webpic: {
    title: "A picture from the web",
    why: "Only pictures from this tour's files are shown; visitors see only its description.",
    fixNote: PICTURE_NOTE,
    picture: true,
  },
  inlinepic: {
    title: "A picture inside a sentence",
    headline: "A picture inside a sentence shows only its description",
    why: "Pictures show on a line of their own; inside a sentence, visitors see only its description.",
    fix: "Put it on its own line",
    fixNote: "Moves the picture to a line of its own. No words are removed.",
  },
  manypic: {
    title: "A picture past the twentieth",
    headline: "A picture past the twentieth shows only its description",
    why: "A text shows at most 20 pictures; later ones show only their description.",
    fixNote: "Keeps its description as text.",
  },
  missingpic: {
    title: "A picture that is not in this tour",
    why: "No file of this tour has that name, so visitors see only its description.",
    fixNote: PICTURE_NOTE,
    picture: true,
  },
  link: {
    title: "A link that cannot open",
    why: "Links open web pages (https) or e-mail (mailto); this one is shown as plain words.",
    fixNote: "Keeps the link's words and removes the address.",
  },
};

/** One part shown as typed, with its text and whether it is kept. */
export interface TypedPart extends TourMdDiagnostic {
  /** The body's text of the part. */
  readonly text: string;
  /** Kind and text: the same part keeps its key while the text around it
   *  changes. */
  readonly key: string;
  /** Whether the creator chose "Keep as typed" for it. */
  readonly kept: boolean;
}

/** The parts of `body` shown as typed, in order. */
export function typedParts(
  body: string,
  options: {
    readonly assetExists?: (id: string) => boolean;
    readonly kept?: ReadonlySet<string>;
  } = {},
): TypedPart[] {
  if (typeof body !== "string") return [];
  const diagnostics = diagnoseTourMarkdown(
    body,
    options.assetExists === undefined
      ? {}
      : { assetExists: options.assetExists },
  );
  return diagnostics.map((d) => {
    const text = body.slice(d.from, d.to);
    const key = `${d.kind}:${text}`;
    return { ...d, text, key, kept: options.kept?.has(key) ?? false };
  });
}

/** A replacement of `[from, to)` in the body by `text`. */
export interface PartEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** A code box's fence marks at a line's start. */
const FENCE = /^\s*(?:`{3,}|~{3,})/;

/** A picture line. Its description may hold brackets of its own (a
 *  footnote mark), so it runs to the last "](". */
const PICTURE = /^!\[([^\n]*)\]\(([^)\s]*)\)$/;

/** A picture part's description (its alt text), "" for none. */
export function pictureAlt(part: Pick<TypedPart, "text">): string {
  return PICTURE.exec(part.text.trim())?.[1]?.trim() ?? "";
}

/** Table rows (cells) as list lines, the first of several as a lead-in. */
function rowsToList(rows: readonly (readonly string[])[]): string {
  const filled = rows.filter((cells) => cells.length > 0);
  return filled
    .map((cells, k) =>
      k === 0 && filled.length > 1
        ? `${cells.join(", ")}:`
        : `- ${cells.length > 1 ? `${cells[0] ?? ""}: ${cells.slice(1).join(", ")}` : (cells[0] ?? "")}`,
    )
    .join("\n");
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** An entity's sign; one it cannot read as it was typed. */
function decodeEntity(entity: string): string {
  const name = entity.replace(/^&|;$/g, "");
  const num = /^#(x[0-9a-f]+|\d+)$/i.exec(name);
  if (num !== null) {
    const raw = num[1] ?? "";
    const code =
      raw[0] === "x" || raw[0] === "X"
        ? Number.parseInt(raw.slice(1), 16)
        : Number(raw);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : entity;
  }
  return ENTITIES[name.toLowerCase()] ?? entity;
}

/** Web page code without its marks: bold and italic kept as the
 *  writer's marks, a line break as a line break, comments' words kept. */
function htmlToText(text: string): string {
  return text
    .replace(/<!--\s*([\s\S]*?)\s*-->/g, "$1")
    .replace(/<\s*(b|strong)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, "**$2**")
    .replace(/<\s*(i|em)\s*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, "*$2*")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, "");
}

/** `text` as a paragraph of its own where `[from, to)` was: the spaces
 *  beside it taken, blank lines put where it was inside a line. */
function ownLine(
  body: string,
  from: number,
  to: number,
  text: string,
): PartEdit {
  let a = from;
  let b = to;
  while (a > 0 && (body[a - 1] === " " || body[a - 1] === "\t")) a--;
  while (b < body.length && (body[b] === " " || body[b] === "\t")) b++;
  const pre = a === 0 || body[a - 1] === "\n" ? "" : "\n\n";
  const post = b === body.length || body[b] === "\n" ? "" : "\n\n";
  return { from: a, to: b, text: pre + text + post };
}

/** The list part's fix: a `+` as `-`, a `1)` as `1.`, a third level's
 *  mark taken off. */
function listFix(text: string): string {
  const m = /^(\s*)([-*+]|\d{1,3}[.)])(\s+)/.exec(text);
  if (m === null) return text;
  const [whole, indent = "", mark = ""] = m;
  const rest = text.slice(whole.length);
  if (mark === "+") return `${indent}- ${rest}`;
  if (mark.endsWith(")")) return `${indent}${mark.slice(0, -1)}. ${rest}`;
  return indent + rest;
}

/** Whether "Make it plain text" changes `part` of `body` at all: not for
 *  an entity it cannot read, which stays as typed. */
export function hasPlainTextFix(
  body: string,
  part: Pick<TypedPart, "kind" | "from" | "to">,
): boolean {
  return plainTextEdit(body, part).text !== body.slice(part.from, part.to);
}

/**
 * "Make it plain text" for `part` of `body`: the marks that keep it from
 * being formatted taken off (or, for a picture inside a sentence, the
 * picture moved to a line of its own). The words visitors read all stay;
 * a picture's web address is not read, so it goes with its marks. A
 * divider takes its line break with it.
 */
export function plainTextEdit(
  body: string,
  part: Pick<TypedPart, "kind" | "from" | "to">,
): PartEdit {
  const t = body.slice(part.from, part.to);
  const at = (text: string): PartEdit => ({
    from: part.from,
    to: part.to,
    text,
  });
  switch (part.kind) {
    case "table":
      return at(
        rowsToList(
          t
            .split("\n")
            .filter((l) => !(/^[\s|:-]*$/.test(l) && l.includes("-")))
            .map((l) =>
              l
                .split("|")
                .map((c) => c.trim())
                .filter(Boolean),
            ),
        ),
      );
    case "tabs":
      return at(
        rowsToList(
          t.split("\n").map((l) =>
            l
              .split("\t")
              .map((c) => c.trim())
              .filter(Boolean),
          ),
        ),
      );
    case "html":
      return at(htmlToText(t));
    case "code":
      // A fence line goes; any words after its marks (a language name)
      // stay as a line of their own.
      return at(
        t
          .split("\n")
          .flatMap((l) => {
            if (!FENCE.test(l)) return [l];
            const rest = l.replace(FENCE, "").trim();
            return rest === "" ? [] : [rest];
          })
          .join("\n"),
      );
    case "icode":
      return at(t.replace(/`/g, ""));
    case "quote":
      return at(
        t
          .split("\n")
          .map((l) => l.replace(/^(\s*>\s?)+/, ""))
          .join("\n"),
      );
    case "rule":
      return {
        from: part.from,
        to: body[part.to] === "\n" ? part.to + 1 : part.to,
        text: "",
      };
    case "heading":
      return at(t.replace(/^\s*#+\s*/, ""));
    case "list":
      return at(listFix(t));
    case "entity":
      return at(decodeEntity(t));
    case "autolink":
      return at(t.replace(/^<|>$/g, ""));
    case "strike":
      return at(t.replace(/^~~|~~$/g, ""));
    case "fnref":
      // No second space where one already stands before the mark.
      return at(
        `${/\s/.test(body[part.from - 1] ?? "") ? "" : " "}(note ${t.replace(/^\[\^|\]$/g, "")})`,
      );
    case "fndef":
      return at(t.replace(/^\s*\[\^([^\]\s]+)\]:\s*/, "Note $1: "));
    case "refdef":
      return at(t.replace(/^(\s*)\[([^\]]*)\]:/, "$1$2:"));
    case "webpic":
    case "missingpic":
    case "manypic":
      // Its description in its place; a mark that does not read as a
      // picture keeps its words without the marks around them.
      return at(
        pictureAlt({ text: t }) || t.trim().replace(/^!\[|\]\([^)]*\)$/g, ""),
      );
    case "inlinepic":
      return ownLine(body, part.from, part.to, t.trim());
    case "link": {
      // Its words may hold brackets of their own: they run to the last
      // "](", where the address starts.
      const end = t.lastIndexOf("](");
      return at(t.startsWith("[") && end > 0 ? t.slice(1, end) : t);
    }
  }
}

/**
 * "Use a tour picture" for a picture part: the tour's picture `assetId`
 * in its place, on a line of its own, its description kept (or `alt`).
 */
export function tourPictureEdit(
  body: string,
  part: Pick<TypedPart, "from" | "to">,
  assetId: string,
  alt?: string,
): PartEdit {
  const text = body.slice(part.from, part.to);
  const words = (alt ?? pictureAlt({ text })).replace(/[[\]\n]/g, " ").trim();
  return ownLine(body, part.from, part.to, `![${words}](asset:${assetId})`);
}
