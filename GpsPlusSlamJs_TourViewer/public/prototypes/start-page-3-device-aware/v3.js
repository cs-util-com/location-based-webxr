// Start page V3, "device-aware front door": the page's behaviour.
// The film, story cards, use cases, setup map and the "Scan with your phone"
// code are the real modules (real/, generated copies). The editor entry, the
// storage steps, the link check and AR are faked: nothing is saved or sent.

import {
  isComputerScreen,
  linkQrSvg,
  mountLanding,
  wireSetupStage,
} from "./real/landing.js";

const root = document.documentElement;
const query = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Mark a goal reached, for the notes' measurements and the switches. */
function reach(goal) {
  root.dataset.v3Goal = goal;
  performance.mark(`v3-goal-${goal}`);
}

/** Say something in the status line next to a faked control. */
function say(node, text) {
  if (node !== null) {
    node.textContent = text;
    node.hidden = false;
  }
}

// ----- The AR check: the door of a phone waits for it ------------------

const delayMs = (() => {
  const asked = Number(query.get("delay"));
  return [0, 300, 2000].includes(asked) ? asked : 300;
})();

async function arSupported(device) {
  if (device === "ar") {
    return true;
  }
  if (device === "noar") {
    return false;
  }
  try {
    return (await navigator.xr?.isSessionSupported("immersive-ar")) === true;
  } catch {
    return false;
  }
}

async function runArCheck() {
  const state = $("v3-proto-state");
  const enter = $("enter-ar");
  if (root.dataset.v3Screen === "computer") {
    state.value = "AR check: not needed at a computer";
    return;
  }
  const [supported] = await Promise.all([
    arSupported(root.dataset.v3Device),
    new Promise((done) => {
      setTimeout(done, delayMs);
    }),
  ]);
  performance.mark("v3-ar-check");
  root.dataset.v3Door = supported ? "ar" : "noar";
  enter.dataset.arState = supported ? "ready" : "unsupported";
  enter.disabled = !supported;
  enter.textContent = supported ? "Start creating" : "AR is not available";
  state.value = `AR check: ${supported ? "AR" : "no AR"} after ${String(delayMs)} ms`;
}

// The page's own check of the screen, held to the first-paint guess.
if (query.get("device") === null && query.get("ar") === null) {
  const computer = isComputerScreen(window);
  if (computer !== (root.dataset.v3Screen === "computer")) {
    console.warn("v3: the screen guess differs from link-qr.ts");
  }
}

void runArCheck();

// ----- The real landing modules -----------------------------------------

mountLanding({
  mode: "creator",
  dom: {
    film: $("landing-film"),
    cards: document.querySelector(".landing-cards"),
    uses: $("landing-uses"),
  },
  reducedMotion: reducedMotion(),
  onArStarting: () => () => undefined,
});

const STEPS = ["host", "link", "print", "hang", "measure", "done"];
const stepNode = {
  host: $("step-host"),
  link: $("step-link"),
  print: $("print-panel"),
  hang: $("step-hang"),
  measure: $("step-measure"),
  done: $("step-done"),
};

function openStep(step) {
  for (const name of STEPS) {
    stepNode[name].open = name === step;
  }
}

wireSetupStage({
  dom: {
    steps: stepNode,
    summaries: Object.fromEntries(
      STEPS.map((name) => [
        name,
        stepNode[name].querySelector(":scope > summary") ?? undefined,
      ]),
    ),
    badge: $("setup-badge"),
    of: $("setup-of"),
    dots: $("setup-dots"),
    nav: $("setup-nav"),
    back: $("setup-back"),
    next: $("setup-next"),
    begins: Array.from(
      document.querySelectorAll('[data-act="begin"], #setup-begin'),
    ),
    stage: $("setup-stage"),
  },
  openStep,
  createElement: (tag) => document.createElement(tag),
  reducedMotion,
  map: {
    route: $("map-route"),
    reveal: $("map-route-reveal"),
    stations: $("map-stations"),
    start: $("map-start") ?? undefined,
    endFlag: $("map-end-flag") ?? undefined,
  },
});

// ----- Faked setup steps -------------------------------------------------

const HOST_STEPS = [
  "Download the empty starter tour below.",
  "Upload it to {host} and share it so anyone with the link can view it.",
  "Copy its share link: the next step asks for it.",
];

for (const tile of document.querySelectorAll(".host-tile")) {
  tile.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".host-tile")) {
      other.setAttribute("aria-pressed", String(other === tile));
    }
    const list = $("host-steps");
    list.replaceChildren(
      ...HOST_STEPS.map((text) => {
        const item = document.createElement("li");
        item.textContent = text.replace("{host}", tile.dataset.host);
        return item;
      }),
    );
    list.hidden = false;
    $("starter-zip").hidden = false;
    $("host-continue").hidden = false;
  });
}
$("starter-zip").addEventListener("click", (event) => {
  event.preventDefault();
  say($("host-steps"), "In the app, the empty starter tour downloads here.");
});
$("host-continue").addEventListener("click", () => {
  openStep("link");
});
$("open-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const link = $("link").value.trim();
  say(
    $("link-status"),
    link === ""
      ? "Paste the share link first."
      : "The link works (faked here). Next: print the posters.",
  );
});
$("hang-done").addEventListener("click", () => {
  openStep("measure");
});
$("enter-ar").addEventListener("click", () => {
  reach("creating");
  say(
    $("v3-ar-said"),
    "In the app, AR starts here and you place the stations.",
  );
});

// Buttons that only say what the app would do.
for (const button of document.querySelectorAll("[data-say]")) {
  button.addEventListener("click", () => {
    const line =
      button.closest(".v3-dialog")?.querySelector(".v3-said") ??
      button.parentElement.querySelector(".v3-said");
    say(line, button.dataset.say);
  });
}

// ----- "You already have a tour?" on a phone ----------------------------

function askAbout(name) {
  const playable = root.dataset.v3Door === "ar";
  $("have-tour-ask-text").textContent = playable
    ? `${name}: play it here, or go on setting it up.`
    : `${name}: this phone cannot play it in AR; you can go on setting it up.`;
  $("have-tour-play").hidden = !playable;
  $("have-tour-play").href = "#have-tour";
  $("have-tour-ask").hidden = false;
}

$("have-tour-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const link = $("have-tour-link").value.trim();
  if (link === "") {
    say($("have-tour-status"), "Paste the tour's link first.");
    return;
  }
  $("have-tour-status").hidden = true;
  askAbout("The tour from the link");
});
$("have-tour-file").addEventListener("click", () => {
  $("have-tour-input").click();
});
$("have-tour-input").addEventListener("change", () => {
  const file = $("have-tour-input").files?.[0];
  if (file !== undefined) {
    askAbout(file.name);
  }
});
$("have-tour-play").addEventListener("click", (event) => {
  event.preventDefault();
  reach("playing");
  $("have-tour-ask-text").textContent =
    "In the app, the tour plays here, in AR.";
});
$("have-tour-continue").addEventListener("click", () => {
  $("setup-stage").scrollIntoView({
    block: "start",
    behavior: reducedMotion() ? "instant" : "smooth",
  });
});

// ----- The doors' dialogs ------------------------------------------------

function openEditor(event) {
  event.preventDefault();
  $("v3-editor-said").textContent = "";
  $("v3-editor").showModal();
  reach("editor");
}

for (const door of document.querySelectorAll(
  '[data-act="editor"], a[href="edit.html"]',
)) {
  door.addEventListener("click", openEditor);
}

for (const door of document.querySelectorAll('[data-act="send"]')) {
  door.addEventListener("click", () => {
    const code = $("v3-send-code");
    if (code.childElementCount === 0) {
      code.innerHTML = linkQrSvg(`${location.origin}${location.pathname}`);
    }
    $("v3-send").showModal();
    reach("sent");
  });
}

for (const close of document.querySelectorAll('[data-act="close"]')) {
  close.addEventListener("click", () => {
    close.closest("dialog").close();
  });
}

// "Send this page to a computer": the share sheet, else the clipboard.
for (const door of document.querySelectorAll('[data-act="share"]')) {
  const label = door.textContent.trim();
  door.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}`;
    door.disabled = true;
    door.textContent = "Sending…";
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Make a tour", url });
        door.textContent = "Sent";
      } else {
        await navigator.clipboard.writeText(url);
        door.textContent = "Link copied";
      }
    } catch (error) {
      door.textContent =
        error instanceof DOMException && error.name === "AbortError"
          ? label
          : "Could not send: copy the address instead";
    } finally {
      door.disabled = false;
      setTimeout(() => {
        door.textContent = label;
      }, 2500);
    }
  });
}

// ----- Prototype switches -------------------------------------------------

const form = $("v3-proto-form");
form.elements.device.value = ["computer", "ar", "noar"].includes(
  root.dataset.v3Device,
)
  ? root.dataset.v3Device
  : "auto";
form.elements.returning.checked = query.get("returning") === "1";
form.elements.delay.value = String(delayMs);
form.addEventListener("change", () => {
  const next = new URLSearchParams();
  const device = form.elements.device.value;
  if (device !== "auto") {
    next.set("device", device);
  }
  if (form.elements.returning.checked) {
    next.set("returning", "1");
  }
  next.set("delay", form.elements.delay.value);
  location.search = next.toString();
});
