/**
 * Shared "boxed field" builder: a label above the value, used for every
 * labeled value across the authoring composition (Tour Details, waypoint
 * radii, pack-and-share's link fields) so they all look and behave the same
 * way. Optionally carries a `(?)` hint button whose popover text shows on
 * hover or focus (tapping a focusable element focuses it, so this also
 * works on touch with no extra JS).
 *
 * The outer wrapper is a plain `<div>`, not a `<label>`: wrapping both the
 * hint button and the input in one `<label>` makes browsers apply `:hover`
 * to every labelable descendant whenever ANY of them is hovered, so the
 * popover would open just from hovering the input. Associating the label
 * text with the input via `for`/`id` instead keeps click-to-focus without
 * that cross-hover.
 */
export function buildLabeledField(
  labelText: string,
  input: HTMLElement,
  testid: string,
  hint?: string,
): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  wrapper.dataset["testid"] = `field-${testid}`;

  const inputId = `field-${testid}-input`;
  input.id = inputId;

  const row = document.createElement("span");
  const label = document.createElement("label");
  label.htmlFor = inputId;
  label.textContent = labelText;
  row.append(label);
  if (hint !== undefined) {
    row.appendChild(buildHintButton(hint, testid));
  }

  wrapper.append(row, input);
  return wrapper;
}

function buildHintButton(hint: string, testid: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hint-icon";
  button.dataset["testid"] = `hint-${testid}`;
  button.textContent = "?";

  const tip = document.createElement("span");
  tip.className = "hint-tip";
  tip.textContent = hint;
  button.appendChild(tip);

  return button;
}
