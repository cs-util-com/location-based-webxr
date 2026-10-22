/**
 * The 3D view's inspector dock, drawn from its model
 * (`inspector-model.ts`): the selection's name, what it is, and its
 * fields read-only, the position folded away under a disclosure. Text
 * only, never markup. Every value is an `<output>` tied to its label, so
 * a screen reader reads the two together. The head's fold and close
 * buttons and the disclosure carry `data-act` (`fold`, `close`,
 * `position`); the shell answers them.
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

/** A fresh id for a field's value: labels point at their value by it.
 *  Only one inspector exists, and each draw replaces every field. */
let fieldCount = 0;
function fieldId(): string {
  fieldCount += 1;
  return `inspector-field-${String(fieldCount)}`;
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

/** A row: `label` tied to the value `value` (given an id here), the row
 *  showing `shown` (the value, or a box holding it). */
function labelled(
  label: string,
  value: HTMLElement,
  shown: HTMLElement = value,
): HTMLElement {
  const row = el("div", "f");
  value.id = fieldId();
  const tag = el("label", "", label);
  tag.htmlFor = value.id;
  row.append(tag, shown);
  return row;
}

/** A read-only number: its label and its value (with a unit). */
function field(label: string, value: string, unit = ""): HTMLElement {
  const box = el("div", "num ro");
  const out = el("output", "val", value);
  box.append(out);
  if (unit !== "") box.append(el("span", "unit", unit));
  return labelled(label, out, box);
}

function textField(label: string, value: string): HTMLElement {
  const row = labelled(label, el("output", "ro-text", value));
  row.classList.add("top");
  return row;
}

/** A vector's axes in one row: the row's label names the group, and each
 *  axis is named by it ("Offset north"). */
function vectorField(
  label: string,
  axes: readonly (readonly [axis: string, name: string, value: string])[],
): HTMLElement {
  const row = el("div", "f");
  const tag = el("span", "flabel", label);
  tag.id = fieldId();
  const vec = el("div", `vec n${String(axes.length)}`);
  vec.setAttribute("role", "group");
  vec.setAttribute("aria-labelledby", tag.id);
  for (const [axis, name, value] of axes) {
    const box = el("div", "num ro");
    const out = el("output", "val", value);
    out.setAttribute("aria-label", `${label} ${name}`);
    box.append(el("span", `ax ${axis.toLowerCase()}`, axis), out);
    vec.append(box);
  }
  row.append(tag, vec);
  return row;
}

function headingText(deg: number | null): string {
  return deg === null ? "-" : fixed(deg, 0);
}

function positionFields(p: InspectorPosition): HTMLElement[] {
  return [
    vectorField("Anchor", [
      ["E", "east", fixed(p.eastM, 1)],
      ["N", "north", fixed(p.northM, 1)],
    ]),
    field("Height", fixed(p.altM, 1), "m"),
    field("Heading", headingText(p.headingDeg), "deg"),
    el(
      "div",
      "note",
      "Metres east / north of the tour's centre, where the 3D view is centred; the height over the ellipsoid, as the file writes it; the heading clockwise from north.",
    ),
  ];
}

/** The folded position's one-line summary, as the plan writes it. */
function positionSummary(p: InspectorPosition): string {
  const heading =
    p.headingDeg === null ? "" : `  ${fixed(p.headingDeg, 0)} deg`;
  return `E ${fixed(p.eastM, 1)}  N ${fixed(p.northM, 1)}${heading}`;
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

/** The position's disclosure, or a note when there is none to show. */
function positionPart(
  position: InspectorPosition | null,
  open: boolean,
  none: string,
): HTMLElement[] {
  if (position === null) return [el("div", "note pad", none)];
  return disclosure(open, positionSummary(position), positionFields(position));
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
    if (model.imagePath === null) {
      section.append(textField("Card image", "None"));
    } else {
      const thumb = el("output", "thumb");
      thumb.setAttribute("role", "img");
      pictures.show(thumb, model.imagePath);
      section.append(labelled("Card image", thumb));
    }
    section.append(
      field("Radius", fixed(model.foundRadiusM, 1), "m"),
      el(
        "div",
        "note",
        `Visitors who step inside this circle see the station's content; it starts loading ${fixed(model.activateRadiusM, 0)} m out.`,
      ),
    );
    parts.push(
      section,
      ...positionPart(
        model.position,
        state.positionOpen,
        "The file gives this station no position.",
      ),
    );
  } else if (model.kind === "item") {
    if (model.sizeM !== null) {
      section.append(field("Size", fixed(model.sizeM, 2), "m"));
    }
    const o = model.offset;
    const heading = headingText(model.headingDeg);
    parts.push(
      ...(section.childElementCount > 0 ? [section] : []),
      ...disclosure(
        state.positionOpen,
        `${fixed(o.upM, 1)} m up  ${heading} deg`,
        [
          vectorField("Offset", [
            ["N", "north", fixed(o.northM, 2)],
            ["U", "up", fixed(o.upM, 2)],
            ["E", "east", fixed(o.eastM, 2)],
          ]),
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
    parts.push(
      section,
      ...positionPart(
        model.position,
        state.positionOpen,
        "No position stored yet.",
      ),
    );
  }
  dock.body.replaceChildren(...parts);
}
