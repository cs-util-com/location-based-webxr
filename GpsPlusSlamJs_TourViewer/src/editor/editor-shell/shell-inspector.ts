/**
 * The 3D view's inspector dock, drawn from its model
 * (`inspector-model.ts`): the selection's name, what it is, and its
 * fields read-only, the position folded away under a disclosure. Text
 * only, never markup. The head's fold and close buttons and the
 * disclosure carry `data-act` (`fold`, `close`, `position`); the shell
 * answers them.
 *
 * @see shell-inspector.ts.md
 */
import type { ShellPictures } from "./shell-pictures.js";
import { shellIcon, type ShellIcon } from "./shell-icons.js";
import type { InspectorModel, InspectorPosition } from "./inspector-model.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** `value` with `digits` decimals, "-0" shown as "0". */
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

function iconButton(
  icon: ShellIcon,
  label: string,
  act: string,
): HTMLButtonElement {
  const b = el("button", "ib");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.dataset["act"] = act;
  b.append(shellIcon(icon));
  return b;
}

/** A read-only field: its label and its value (with a unit). */
function field(label: string, value: string, unit = ""): HTMLElement {
  const row = el("div", "f");
  const box = el("div", "num ro");
  box.append(el("output", "val", value));
  if (unit !== "") box.append(el("span", "unit", unit));
  row.append(el("label", "", label), box);
  return row;
}

function textField(label: string, value: string): HTMLElement {
  const row = el("div", "f top");
  row.append(el("label", "", label), el("div", "ro-text", value));
  return row;
}

function positionFields(p: InspectorPosition): HTMLElement[] {
  return [
    field("Latitude", fixed(p.lat, 6), "deg"),
    field("Longitude", fixed(p.lon, 6), "deg"),
    field("Height", fixed(p.altM, 1), "m"),
    field(
      "Heading",
      p.headingDeg === null ? "-" : fixed(p.headingDeg, 0),
      "deg",
    ),
  ];
}

/** The folded position's one-line summary. */
function positionSummary(p: InspectorPosition): string {
  const heading =
    p.headingDeg === null ? "" : `  ${fixed(p.headingDeg, 0)} deg`;
  return `${fixed(p.lat, 5)}, ${fixed(p.lon, 5)}${heading}`;
}

function disclosure(
  open: boolean,
  summary: string,
  fields: readonly HTMLElement[],
): HTMLElement[] {
  const b = el("button", "disc");
  b.type = "button";
  b.dataset["act"] = "position";
  b.classList.toggle("open", open);
  b.setAttribute("aria-expanded", String(open));
  b.title = "Exact position and heading";
  b.append(
    shellIcon("right"),
    el("span", "lab", "Position"),
    el("span", "sum", summary),
  );
  if (!open) return [b];
  const body = el("div", "pos");
  body.append(...fields);
  return [b, body];
}

const KIND_ICON: Readonly<Record<string, ShellIcon>> = {
  station: "station",
  code: "qr",
  pin: "pin",
  photo: "photo",
  model: "model",
};

/**
 * The dock drawn from `model` (null: hidden), folded to its head or not,
 * its position disclosure open or not.
 */
export function drawInspector(
  dock: {
    readonly root: HTMLElement;
    readonly head: HTMLElement;
    readonly body: HTMLElement;
  },
  model: InspectorModel | null,
  state: { readonly folded: boolean; readonly positionOpen: boolean },
  pictures: ShellPictures,
): void {
  dock.root.hidden = model === null;
  if (model === null) {
    dock.head.replaceChildren();
    dock.body.replaceChildren();
    return;
  }
  dock.root.classList.toggle("collapsed", state.folded);
  const kind = model.kind === "item" ? model.itemKind : model.kind;
  const icon = el("span", `hic ic ${kind}`);
  icon.append(shellIcon(KIND_ICON[kind] ?? "station"));
  const title = el("span", "ttl", model.title);
  title.title = model.title;
  dock.head.replaceChildren(
    icon,
    title,
    iconButton(
      state.folded ? "down" : "up",
      state.folded ? "Show the details" : "Collapse the details",
      "fold",
    ),
    iconButton("close", "Deselect (Esc)", "close"),
  );
  const parts: HTMLElement[] = [el("div", "sub", model.sub)];
  const section = el("div", "isec");
  if (model.kind === "station") {
    section.append(textField("Description", model.description ?? "None"));
    const picture = el("div", "f");
    const thumb = el("div", "thumb");
    if (model.imagePath !== null) pictures.show(thumb, model.imagePath);
    picture.append(
      el("label", "", "Card image"),
      model.imagePath === null ? el("div", "ro-text", "None") : thumb,
    );
    section.append(
      picture,
      field("Radius", fixed(model.foundRadiusM, 1), "m"),
      el(
        "div",
        "note",
        `Visitors who step inside this circle see the station's content; it starts loading ${fixed(model.activateRadiusM, 0)} m out.`,
      ),
    );
    parts.push(
      section,
      ...disclosure(
        state.positionOpen,
        positionSummary(model.position),
        positionFields(model.position),
      ),
    );
  } else if (model.kind === "item") {
    if (model.sizeM !== null) {
      section.append(field("Size", fixed(model.sizeM, 2), "m"));
    }
    const o = model.offset;
    const offset = el("div", "f");
    const vec = el("div", "vec");
    for (const [axis, value] of [
      ["N", o.northM],
      ["U", o.upM],
      ["E", o.eastM],
    ] as const) {
      const box = el("div", "num ro");
      box.append(
        el("span", `ax ${axis.toLowerCase()}`, axis),
        el("output", "val", fixed(value, 2)),
      );
      vec.append(box);
    }
    offset.append(el("label", "", "Offset"), vec);
    const heading =
      model.headingDeg === null ? "-" : fixed(model.headingDeg, 0);
    parts.push(
      ...(section.childElementCount > 0 ? [section] : []),
      ...disclosure(
        state.positionOpen,
        `${fixed(o.upM, 1)} m up  ${heading} deg`,
        [
          offset,
          field("Heading", heading, "deg"),
          el(
            "div",
            "note",
            "Metres north, up and east of its station, in the station's frame; heading relative to the station.",
          ),
        ],
      ),
    );
  } else {
    section.append(
      field(
        "Print size",
        model.printSizeM === null ? "-" : fixed(model.printSizeM, 2),
        "m",
      ),
    );
    parts.push(section);
    if (model.position === null) {
      parts.push(el("div", "note pad", "No position stored yet."));
    } else {
      parts.push(
        ...disclosure(
          state.positionOpen,
          positionSummary(model.position),
          positionFields(model.position),
        ),
      );
    }
  }
  dock.body.replaceChildren(...parts);
}
