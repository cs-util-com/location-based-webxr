/**
 * The inspector's small pieces of DOM, shared by the dock
 * (`shell-inspector.ts`) and the kinds' own panels (`../kind-panels/`):
 * an element with its class, a number shown with its decimals, a field's
 * fresh id, an icon button, a labelled row, a field to type (`data-field`)
 * and a group of chips (`data-act`). Text only, never markup.
 *
 * @see inspector-fields.ts.md
 */
import { shellIcon, type ShellIcon } from "gps-plus-slam-editor-kit/chrome";

/** An element of `tag` with the class `className` and, given, its text. */
export function el<K extends keyof HTMLElementTagNameMap>(
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
export function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return Number(text) === 0 ? (0).toFixed(digits) : text;
}

/** A fresh id for a field's value: labels point at their value by it.
 *  Only one inspector exists, and each draw replaces every field. */
let fieldCount = 0;
export function fieldId(): string {
  fieldCount += 1;
  return `inspector-field-${String(fieldCount)}`;
}

/** A button showing `icon`, named `label`, acting as `act`. */
export function iconButton(
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
export function labelled(
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

/** Whether `value` holds a line break. */
export function severalLines(value: string): boolean {
  return /[\r\n]/.test(value);
}

/** A field to type in, named `field` (`data-field`), the tour's value
 *  `value` its default, so text that differs from it is typed. A text
 *  input drops line breaks: a value of several lines is shown, and taken
 *  as its default, on one line, so a field left untouched reads as
 *  untyped and is never written back flattened. */
export function typed(
  field: string,
  value: string,
  className: string,
): HTMLInputElement {
  const input = el("input", className);
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.dataset["field"] = field;
  input.defaultValue = severalLines(value)
    ? value.replace(/\s*[\r\n]+\s*/g, " ")
    : value;
  return input;
}

/** A number to type, in a box with its unit; read-only (`locked`) while
 *  a lock keeps it still. */
export function numberBox(
  field: string,
  value: string,
  unit: string,
  locked = false,
  axis?: string,
): { box: HTMLElement; input: HTMLInputElement } {
  const box = el("div", locked ? "num ro" : "num");
  const input = typed(field, value, "val");
  input.inputMode = "decimal";
  if (locked) {
    input.readOnly = true;
    input.title = "Unlock the position to type it";
  }
  if (axis !== undefined) {
    box.append(el("span", `ax ${axis.toLowerCase()}`, axis));
  }
  box.append(input);
  if (unit !== "") box.append(el("span", "unit", unit));
  return { box, input };
}

/** A labelled number to type, with its unit. */
export function numberField(
  label: string,
  field: string,
  value: string,
  unit: string,
  locked = false,
): HTMLElement {
  const { box, input } = numberBox(field, value, unit, locked);
  return labelled(label, input, box);
}

/** A line to type, named `field`, under its label. */
export function lineField(
  label: string,
  field: string,
  value: string,
  placeholder: string,
): HTMLElement {
  const input = typed(field, value, "tfield");
  input.placeholder = placeholder;
  return labelled(label, input);
}

/** A group of chips named `label`, one per choice, the one `on` pressed;
 *  each acts as `act:<value>`. */
export function chipGroup(
  label: string,
  act: string,
  choices: readonly { readonly value: string; readonly label: string }[],
  on: string,
): [HTMLElement, HTMLElement] {
  const tag = el("span", "flabel", label);
  tag.id = fieldId();
  const chips = el("div", "vchips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-labelledby", tag.id);
  for (const choice of choices) {
    const pressed = choice.value === on;
    const b = el("button", pressed ? "chip on" : "chip", choice.label);
    b.type = "button";
    b.dataset["act"] = `${act}:${choice.value}`;
    b.setAttribute("aria-pressed", String(pressed));
    chips.append(b);
  }
  return [tag, chips];
}
