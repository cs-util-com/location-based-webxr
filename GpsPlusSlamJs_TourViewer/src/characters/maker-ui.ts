/**
 * Two small UI pieces of the character maker: a button's in-progress state
 * for the time an async action takes, and an "Undo" offer that lapses.
 */

const busyCount = new WeakMap<HTMLButtonElement, number>();
const idleLabel = new WeakMap<HTMLButtonElement, string>();

/**
 * Runs `work` while `button` shows `label`, is disabled and `aria-busy`.
 * Runs can overlap on one button: the idle label is taken from the first
 * and the button comes back when the last has settled, success or failure.
 */
export async function busy<T>(
  button: HTMLButtonElement | null,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  if (button) {
    const n = busyCount.get(button) ?? 0;
    if (n === 0) idleLabel.set(button, button.textContent ?? "");
    busyCount.set(button, n + 1);
    button.disabled = true;
    button.textContent = label;
    button.setAttribute("aria-busy", "true");
  }
  try {
    return await work();
  } finally {
    if (button) {
      const n = (busyCount.get(button) ?? 1) - 1;
      busyCount.set(button, n);
      if (n === 0) {
        button.disabled = false;
        button.textContent = idleLabel.get(button) ?? "";
        button.removeAttribute("aria-busy");
      }
    }
  }
}

const UNDO_LINGER_MS = 6000;

/**
 * Shows "`message` Undo" in `box` (replacing an earlier offer) for a few
 * seconds; pressing Undo runs `undo` once and removes the offer.
 */
export function offerUndo(
  box: HTMLElement,
  message: string,
  undo: () => void,
): void {
  box.replaceChildren();
  const offer = document.createElement("div");
  offer.className = "toast";
  offer.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Undo";
  const timer = setTimeout(() => offer.remove(), UNDO_LINGER_MS);
  button.addEventListener("click", () => {
    clearTimeout(timer);
    offer.remove();
    undo();
  });
  offer.append(text, button);
  box.append(offer);
}
