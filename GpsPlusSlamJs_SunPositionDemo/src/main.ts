import { calculateSunPosition } from "gps-plus-slam-app-framework/geo";

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`Missing page element: #${id}`);
  return element;
}

const form = getElement<HTMLFormElement>("sun-form");
const latitudeInput = getElement<HTMLInputElement>("latitude");
const longitudeInput = getElement<HTMLInputElement>("longitude");
const dateInput = getElement<HTMLInputElement>("date");
const results = getElement<HTMLElement>("results");
const error = getElement<HTMLParagraphElement>("error");

function displaySunPosition(): void {
  try {
    const result = calculateSunPosition(
      new Date(dateInput.value),
      latitudeInput.valueAsNumber,
      longitudeInput.valueAsNumber,
    );
    const { x, y, z } = result.directionNue;

    getElement("azimuth").textContent = String(result.azimuthRad);
    getElement("altitude").textContent = String(result.altitudeRad);
    getElement("nue-x").textContent = String(x);
    getElement("nue-y").textContent = String(y);
    getElement("nue-z").textContent = String(z);
    getElement("vector-length").textContent = String(Math.hypot(x, y, z));
    getElement("above-horizon").textContent = String(result.isAboveHorizon);

    error.hidden = true;
    error.textContent = "";
    results.hidden = false;
  } catch (caught) {
    results.hidden = true;
    error.textContent =
      caught instanceof Error ? caught.message : "Unable to calculate position";
    error.hidden = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  displaySunPosition();
});

displaySunPosition();
